import { expect } from "chai"
import { ethers } from "hardhat"
import { MinimalQF } from "../typechain-types"
import {
    ERC20,
    IVerifyingKeyStruct,
    MessageProcessorFactory,
    PollFactory,
    Poll__factory,
    TallyFactory,
    Verifier,
    VkRegistry,
    deployPoseidonContracts,
    deployTopupCredit,
    deployVerifier,
    deployVkRegistry,
    linkPoseidonLibraries,
} from "maci-contracts"
import { AbiCoder, Signer, ZeroAddress, type BigNumberish } from "ethers"
import { Keypair, PCommand } from "maci-domainobjs"
import { MinimalQFInterface } from "../typechain-types/contracts/MinimalQf.sol/MinimalQF"
import { STATE_TREE_DEPTH, messageBatchSize, testProcessVk, testTallyVk, treeDepths } from "./utils"

/**
 * Deploy a contract with linked libraries
 * @param contractFactory - the contract factory to use
 * @param name - the name of the contract
 * @param quiet - whether to suppress console output
 * @param args - the constructor arguments of the contract
 * @returns the deployed contract instance
 */
export const deployContractWithLinkedLibraries = async <T extends any>(
    contractFactory: any,
    ...args: unknown[]
): Promise<T> => {
    const contract = await contractFactory.deploy(...args)
    await contract.deploymentTransaction()!.wait()

    return contract as T
}

describe("e2e", function test() {
    this.timeout(90000000)

    let minimalQF: MinimalQF
    let minimalQFAddress: string
    let token: ERC20

    let owner: Signer
    let user: Signer
    let ownerAddress: string

    // create a new user keypair
    const keypair = new Keypair()
    const coordinatorKeypair = new Keypair()

    let iface: MinimalQFInterface

    let verifierContract: Verifier
    let vkRegistryContract: VkRegistry

    before(async () => {
        ;[owner, user] = await ethers.getSigners()

        ownerAddress = await owner.getAddress()

        verifierContract = await deployVerifier(undefined, true);
        vkRegistryContract = await deployVkRegistry(undefined, true)

        // deploy factories
        const recipientRegistryFactory = await ethers.getContractFactory("RecipientRegistry")
        const recipientRegistry = await recipientRegistryFactory.deploy()

        const tokenFactory = await ethers.getContractFactory("MockERC20")
        token = (await tokenFactory.deploy("Test Token", "TST")) as unknown as ERC20

        const signupGatekeeperFactory = await ethers.getContractFactory("FreeForAllGatekeeper")
        const signupGatekeeper = await signupGatekeeperFactory.deploy()

        const initialVoiceCreditProxyFactory = await ethers.getContractFactory("ERC20InitialVoiceCreditProxy")
        const initialVoiceCreditsProxy = await initialVoiceCreditProxyFactory.deploy(10e8)
        const topupcredit = await deployTopupCredit(undefined, true)

        const { PoseidonT3Contract, PoseidonT4Contract, PoseidonT5Contract, PoseidonT6Contract } =
            await deployPoseidonContracts(undefined, undefined, true)

        const poseidonAddrs = await Promise.all([
            PoseidonT3Contract.getAddress(),
            PoseidonT4Contract.getAddress(),
            PoseidonT5Contract.getAddress(),
            PoseidonT6Contract.getAddress(),
        ]).then(([poseidonT3, poseidonT4, poseidonT5, poseidonT6]) => ({
            poseidonT3,
            poseidonT4,
            poseidonT5,
            poseidonT6,
        }))

        const contractsToLink = [
            "MinimalQF",
            "PollFactory",
            "MessageProcessorFactory",
            "MinimalQFTallyFactory",
        ]

        // Link Poseidon contracts to MACI
        const linkedContractFactories = await Promise.all(
            contractsToLink.map(async (contractName: string) =>
                linkPoseidonLibraries(
                    contractName,
                    poseidonAddrs.poseidonT3,
                    poseidonAddrs.poseidonT4,
                    poseidonAddrs.poseidonT5,
                    poseidonAddrs.poseidonT6,
                    undefined,
                    true,
                ),
            ),
        )

        const [minimalQFFactory, pollFactoryContractFactory, messageProcessorFactory, tallyFactory] =
            await Promise.all(linkedContractFactories)

        const pollFactoryContract =
            await deployContractWithLinkedLibraries<PollFactory>(pollFactoryContractFactory)

        const messageProcessorFactoryContract =
            await deployContractWithLinkedLibraries<MessageProcessorFactory>(messageProcessorFactory)

        const tallyFactoryContract = await deployContractWithLinkedLibraries<TallyFactory>(tallyFactory)

        const [pollAddr, mpAddr, tallyAddr] = await Promise.all([
            pollFactoryContract.getAddress(),
            messageProcessorFactoryContract.getAddress(),
            tallyFactoryContract.getAddress(),
        ])

        minimalQF = await deployContractWithLinkedLibraries<MinimalQF>(
            minimalQFFactory,
            pollAddr,
            mpAddr,
            tallyAddr,
            await topupcredit.getAddress(),
            await signupGatekeeper.getAddress(),
            await initialVoiceCreditsProxy.getAddress(),
            await topupcredit.getAddress(),
            STATE_TREE_DEPTH,
            await token.getAddress(),
            await recipientRegistry.getAddress(),
        )

        minimalQFAddress = await minimalQF.getAddress()

        iface = minimalQF.interface

        // set the verification keys on the vk smart contract
        await vkRegistryContract.setVerifyingKeys(
            STATE_TREE_DEPTH,
            treeDepths.intStateTreeDepth,
            treeDepths.messageTreeDepth,
            treeDepths.voteOptionTreeDepth,
            messageBatchSize,
            testProcessVk.asContractParam() as IVerifyingKeyStruct,
            testTallyVk.asContractParam() as IVerifyingKeyStruct,
            { gasLimit: 1000000 },
        );
    })

    describe("deployment", function () {
        it("should have deployed a new MinimalQf instance", async () => {
            expect(await minimalQF.getAddress()).to.not.be.undefined
            expect(await minimalQF.stateTreeDepth()).to.eq(10n)
        })
    })

    describe("fundingSources", () => {
        it("should allow the admin to add a funding source", async () => {
            await minimalQF.addFundingSource(ownerAddress)
        })

        it("should throw if the caller is not the admin", async () => {
            await expect(minimalQF.connect(user).addFundingSource(ownerAddress)).to.be.revertedWith("Ownable: caller is not the owner")
        })
    })

    describe("signup", () => {
        it("should allow to signup a user", async () => {
            const userBalanceBefore = await token.balanceOf(ownerAddress)
            await token.connect(owner).approve(minimalQFAddress, 100_000_000_000_000n)
            const tx = await minimalQF
                .connect(owner)
                .signUp(
                    keypair.pubKey.asContractParam(),
                    AbiCoder.defaultAbiCoder().encode(["uint256"], [1n]),
                    AbiCoder.defaultAbiCoder().encode(["uint256"], [100_000_000_000_000n]),
                )

            // balance check
            const userBalanceAfter = await token.balanceOf(ownerAddress)
            expect(userBalanceBefore - userBalanceAfter).to.eq(100_000_000_000_000n)

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
            expect(event.args._voiceCreditBalance).to.eq(100_000_000_000_000n / BigInt(10e8))
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

    describe("complete round", () => {

    })
})
