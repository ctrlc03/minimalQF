import { expect } from "chai"
import { ethers } from "hardhat"
import { MinimalQF, RecipientRegistry } from "../typechain-types"
import {
    ERC20,
    MessageProcessor,
    MessageProcessor__factory,
    MockVerifier,
    Poll__factory,
    Verifier,
    VkRegistry,
} from "maci-contracts"
import { AbiCoder, Signer, ZeroAddress, type BigNumberish } from "ethers"
import { Keypair, Message, PCommand, PubKey } from "maci-domainobjs"
import { MinimalQFInterface } from "../typechain-types/contracts/MinimalQf.sol/MinimalQF"
import { STATE_TREE_DEPTH, deployTestContracts, maxValues, messageBatchSize, timeTravel, treeDepths } from "./utils"
import { EthereumProvider } from "hardhat/types"
import { ITallyCircuitInputs, MaciState, Poll } from "maci-core"
import { genTreeCommitment } from "maci-crypto"

describe("e2e", function test() {
    this.timeout(90000000)

    let minimalQF: MinimalQF
    let minimalQFAddress: string
    let recipientRegistry: RecipientRegistry
    let token: ERC20

    let owner: Signer
    let user: Signer
    let ownerAddress: string

    // create a new user keypair
    const keypair = new Keypair()
    const coordinatorKeypair = new Keypair()

    let iface: MinimalQFInterface

    let verifierContract: MockVerifier
    let vkRegistryContract: VkRegistry

    const signupAmount = 100_000_000_000_000n

    before(async () => {
        ;[owner, user] = await ethers.getSigners()

        ownerAddress = await owner.getAddress()

        const contracts = await deployTestContracts()

        minimalQF = contracts.minimalQF
        verifierContract = contracts.verifierContract
        vkRegistryContract = contracts.vkRegistryContract
        token = contracts.token
        recipientRegistry = contracts.recipientRegistry

        minimalQFAddress = await minimalQF.getAddress()

        iface = minimalQF.interface
    })

    describe("deployment", function () {
        it("should have deployed a new MinimalQf instance", async () => {
            expect(await minimalQF.getAddress()).to.not.be.undefined
            expect(await minimalQF.stateTreeDepth()).to.eq(6n)
        })
    })

    describe("addFundingSource", () => {
        it("should allow the admin to add a funding source and emit an event", async () => {
            await expect(minimalQF.addFundingSource(ownerAddress))
                .to.emit(minimalQF, "FundingSourceAdded")
                .withArgs(ownerAddress)
        })

        it("should throw if the caller is not the admin", async () => {
            await expect(minimalQF.connect(user).addFundingSource(ownerAddress)).to.be.revertedWith(
                "Ownable: caller is not the owner",
            )
        })
    })

    describe("signup", () => {
        it("should allow to signup a user", async () => {
            const userBalanceBefore = await token.balanceOf(ownerAddress)
            await token.connect(owner).approve(minimalQFAddress, signupAmount)
            const tx = await minimalQF
                .connect(owner)
                .signUp(
                    keypair.pubKey.asContractParam(),
                    AbiCoder.defaultAbiCoder().encode(["uint256"], [1n]),
                    AbiCoder.defaultAbiCoder().encode(["uint256"], [signupAmount]),
                )

            // balance check
            const userBalanceAfter = await token.balanceOf(ownerAddress)
            expect(userBalanceBefore - userBalanceAfter).to.eq(signupAmount)

            const receipt = await tx.wait()

            expect(receipt?.status).to.eq(1)

            // Store the state index
            const log = receipt!.logs[receipt!.logs.length - 1]
            const event = iface.parseLog(log as unknown as { topics: string[]; data: string }) as unknown as {
                args: {
                    _stateIndex: BigNumberish
                    _voiceCreditBalance: BigNumberish
                }
            }

            expect(event.args._stateIndex).to.eq(1n)
            expect(event.args._voiceCreditBalance).to.eq(signupAmount / BigInt(10e8))
        })
    })

    describe("deployPoll", () => {
        it("should deploy a new QF round and related contracts", async () => {
            await minimalQF.deployPoll(
                100n,
                treeDepths,
                coordinatorKeypair.pubKey.asContractParam(),
                await verifierContract.getAddress(),
                await vkRegistryContract.getAddress(),
                false,
            )
        })

        it("should prevent from init tally again", async () => {
            const tally = await minimalQF.tally()
            const contract = await ethers.getContractAt("MinimalQFTally", tally)

            await expect(contract.initialize(ZeroAddress, ZeroAddress, ZeroAddress)).to.be.revertedWithCustomError(
                contract,
                "AlreadyInit",
            )
        })
    })

    describe("publish message", () => {
        it("should allow to publish a message", async () => {
            const roundAddr = await minimalQF.polls(0)

            const round = Poll__factory.connect(roundAddr, owner)

            const keypair = new Keypair()

            const command = new PCommand(1n, keypair.pubKey, 0n, 9n, 1n, 0n, 0n)

            const signature = command.sign(keypair.privKey)
            const sharedKey = Keypair.genEcdhSharedKey(keypair.privKey, coordinatorKeypair.pubKey)
            const message = command.encrypt(signature, sharedKey)
            await round.publishMessage(message, keypair.pubKey.asContractParam())
        })

        it("should allow to publish a batch of messages", async () => {
            const roundAddr = await minimalQF.polls(0)
            const round = Poll__factory.connect(roundAddr, owner)

            const keypair = new Keypair()

            const command = new PCommand(1n, keypair.pubKey, 0n, 9n, 1n, 0n, 0n)

            const signature = command.sign(keypair.privKey)
            const sharedKey = Keypair.genEcdhSharedKey(keypair.privKey, coordinatorKeypair.pubKey)
            const message = command.encrypt(signature, sharedKey)

            const messages = new Array(84).fill(message.asContractParam())
            const keys = new Array(84).fill(keypair.pubKey.asContractParam())

            await round.publishMessageBatch(messages, keys, { gasLimit: 30000000 })
        })
    })

    describe("recipientRegistry", () => {
        it("should allow the owner to add a recipient", async () => {
            await recipientRegistry.addRecipient(0n, ownerAddress)
        })
        it("should allow the owner to add multiple recipients", async () => {
            await recipientRegistry.addRecipients([ownerAddress, ownerAddress, ownerAddress])
        })
        it("should throw if the caller is not the owner", async () => {
            await expect(recipientRegistry.connect(user).addRecipient(0n, ownerAddress)).to.be.revertedWith(
                "Ownable: caller is not the owner",
            )
        })
    })

    describe("getMatchingFunds", () => {
        it("should return the correct amount of matching funds (amount in the contract)", async () => {
            const funds = await minimalQF.getMatchingFunds()
            expect(funds).to.eq(signupAmount)
        })

        it("should return the correct amount of matching funds (amount in the contract + approved tokens by funding source)", async () => {
            await token.connect(owner).approve(minimalQFAddress, signupAmount)
            const funds = await minimalQF.getMatchingFunds()
            expect(funds).to.eq(signupAmount * 2n)
        })
    })

    describe("cancelRound", () => {
        it("should prevent a non owner from cancelling a round", async () => {
            const tally = await minimalQF.tally()
            const contract = await ethers.getContractAt("MinimalQFTally", tally)
            await expect(contract.connect(user).cancelRound()).to.be.revertedWith("Ownable: caller is not the owner")
        })
        it("should allow the owner to cancel a round", async () => {
            const tally = await minimalQF.tally()
            const contract = await ethers.getContractAt("MinimalQFTally", tally)
            await contract.cancelRound()

            expect(await contract.isCancelled()).to.eq(true)
        })
    })

    describe("finalize", () => {
        let newMinimalQf: MinimalQF
        let newToken: ERC20
        let mpContract: MessageProcessor

        let tallyData: ITallyCircuitInputs

        const maciState = new MaciState(STATE_TREE_DEPTH)
        let poll: Poll

        before(async () => {
            const c = await deployTestContracts()
            newMinimalQf = c.minimalQF
            newToken = c.token

            const tx = await newMinimalQf.deployPoll(
                100n,
                treeDepths,
                coordinatorKeypair.pubKey.asContractParam(),
                await verifierContract.getAddress(),
                await vkRegistryContract.getAddress(),
                false,
            )

            const receipt = await tx.wait()
            const logs = receipt!.logs[receipt!.logs.length - 1]
            const event = iface.parseLog(logs as unknown as { topics: string[]; data: string }) as unknown as {
                args: {
                    _pollId: bigint
                    pollAddr: {
                        poll: string
                        messageProcessor: string
                        tally: string
                    }
                }
                name: string
            }
            expect(event.name).to.eq("DeployPoll")

            const block = await owner.provider!.getBlock(receipt!.blockHash)
            const deployTime = block!.timestamp

            const pollId = maciState.deployPoll(
                BigInt(deployTime) + 100n,
                maxValues,
                {
                    ...treeDepths,
                    intStateTreeDepth: treeDepths.intStateTreeDepth,
                },
                messageBatchSize,
                coordinatorKeypair,
            )

            poll = maciState.polls.get(pollId)!

            mpContract = MessageProcessor__factory.connect(event.args.pollAddr.messageProcessor, owner)

            // signup
            await newToken.connect(owner).approve(newMinimalQf.getAddress(), signupAmount)
            const timestamp = Math.floor(Date.now() / 1000)
            await newMinimalQf
                .connect(owner)
                .signUp(
                    keypair.pubKey.asContractParam(),
                    AbiCoder.defaultAbiCoder().encode(["uint256"], [1n]),
                    AbiCoder.defaultAbiCoder().encode(["uint256"], [signupAmount]),
                )

            maciState.signUp(keypair.pubKey, signupAmount / BigInt(10e8), BigInt(timestamp))

            // create 1 message
            const command = new PCommand(1n, keypair.pubKey, 0n, 9n, 1n, 0n, 0n)
            const signature = command.sign(keypair.privKey)
            const sharedKey = Keypair.genEcdhSharedKey(keypair.privKey, coordinatorKeypair.pubKey)
            const message = command.encrypt(signature, sharedKey)
            const messageContractParam = message.asContractParam()

            // update the poll state
            poll.updatePoll(BigInt(maciState.stateLeaves.length))

            // merge the trees
            const pollAddr = await newMinimalQf.polls(0)
            const pollContract = Poll__factory.connect(pollAddr, owner)

            // publish message on chain and locally
            const nothing = new Message(1n, [
                8370432830353022751713833565135785980866757267633941821328460903436894336785n,
                0n,
                0n,
                0n,
                0n,
                0n,
                0n,
                0n,
                0n,
                0n,
            ])

            const encP = new PubKey([
                10457101036533406547632367118273992217979173478358440826365724437999023779287n,
                19824078218392094440610104313265183977899662750282163392862422243483260492317n,
            ])
            poll.publishMessage(nothing, encP)
            poll.publishMessage(message, keypair.pubKey)
            await pollContract.publishMessage(messageContractParam, keypair.pubKey.asContractParam())

            await timeTravel(owner.provider as unknown as EthereumProvider, 300)

            await pollContract.mergeMaciStateAqSubRoots(0n, 0n)
            await pollContract.mergeMaciStateAq(0n)

            await pollContract.mergeMessageAqSubRoots(0n)
            await pollContract.mergeMessageAq()

            const processMessagesInputs = poll.processMessages(pollId)

            await mpContract.processMessages(processMessagesInputs.newSbCommitment, [0, 0, 0, 0, 0, 0, 0, 0])
        })

        it("should throw when not called by the MinimalQF contract", async () => {
            const tally = await minimalQF.tally()
            const contract = await ethers.getContractAt("MinimalQFTally", tally, user)
            await expect(contract.finalize(5, 5, 5, 5)).to.be.revertedWithCustomError(contract, "OnlyMinimalQF")
        })

        it("should throw when the round is cancelled", async () => {
            const tally = await minimalQF.tally()
            const contract = await ethers.getContractAt("MinimalQFTally", tally, user)
            await expect(minimalQF.transferMatchingFunds(5, 5, 5, 5)).to.be.revertedWithCustomError(
                contract,
                "RoundCancelled",
            )
        })

        it("should throw when the ballots have not been tallied yet", async () => {
            const tally = await newMinimalQf.tally()
            const contract = await ethers.getContractAt("MinimalQFTally", tally, user)
            expect(await contract.isTallied()).to.eq(false)

            await expect(newMinimalQf.transferMatchingFunds(5, 5, 5, 5)).to.be.revertedWithCustomError(
                contract,
                "BallotsNotTallied",
            )
        })

        it("should throw when the spent voice credit proof is wrong", async () => {
            // tally the ballots

            const tally = await newMinimalQf.tally()
            const contract = await ethers.getContractAt("MinimalQFTally", tally, owner)

            tallyData = poll.tallyVotes()
            await contract.tallyVotes(tallyData.newTallyCommitment, [0, 0, 0, 0, 0, 0, 0, 0])

            expect(await contract.isTallied()).to.eq(true)

            await expect(newMinimalQf.transferMatchingFunds(5, 5, 5, 5)).to.be.revertedWithCustomError(
                contract,
                "InvalidSpentVoiceCreditsProof",
            )
        })

        it("should allow the MinimalQF contract to finalize the round", async () => {
            // compute newResultsCommitment
            const newResultsCommitment = genTreeCommitment(
                poll.tallyResult.map((x) => BigInt(x)),
                BigInt(tallyData.newResultsRootSalt),
                treeDepths.voteOptionTreeDepth,
            )

            const newPerVOSpentVoiceCreditsCommitment = genTreeCommitment(
                poll.perVOSpentVoiceCredits.map((x) => BigInt(x)),
                BigInt(tallyData.newPerVOSpentVoiceCreditsRootSalt!),
                treeDepths.voteOptionTreeDepth,
            )

            await newMinimalQf.transferMatchingFunds(
                poll.totalSpentVoiceCredits,
                tallyData.newSpentVoiceCreditSubtotalSalt,
                newResultsCommitment,
                newPerVOSpentVoiceCreditsCommitment,
            )
        })

        it("should not allow to finalize twice", async () => {
            const tally = await newMinimalQf.tally()
            const contract = await ethers.getContractAt("MinimalQFTally", tally, user)
            await expect(newMinimalQf.transferMatchingFunds(5, 5, 5, 5)).to.be.revertedWithCustomError(
                contract,
                "AlreadyFinalized",
            )
        })
    })
})
