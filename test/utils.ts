import {
    IVerifyingKeyStruct,
    MessageProcessorFactory,
    PollFactory,
    TallyFactory,
    VkRegistry,
    deployPoseidonContracts,
    deployTopupCredit,
    deployVkRegistry,
    linkPoseidonLibraries,
    deployContractWithLinkedLibraries,
    deployMockVerifier,
    MockVerifier,
} from "maci-contracts"
import { MaxValues, TreeDepths } from "maci-core"
import { G1Point, G2Point } from "maci-crypto"
import { VerifyingKey } from "maci-domainobjs"
import { ethers } from "hardhat"
import { ERC20, MinimalQF, SimpleRecipientRegistry } from "../typechain-types"
import { EthereumProvider } from "hardhat/types"

export const duration = 20

export const STATE_TREE_DEPTH = 6
export const STATE_TREE_ARITY = 5
export const MESSAGE_TREE_DEPTH = 8
export const MESSAGE_TREE_SUBDEPTH = 2
export const messageBatchSize = STATE_TREE_ARITY ** MESSAGE_TREE_SUBDEPTH

export const testProcessVk = new VerifyingKey(
    new G1Point(BigInt(0), BigInt(1)),
    new G2Point([BigInt(2), BigInt(3)], [BigInt(4), BigInt(5)]),
    new G2Point([BigInt(6), BigInt(7)], [BigInt(8), BigInt(9)]),
    new G2Point([BigInt(10), BigInt(11)], [BigInt(12), BigInt(13)]),
    [new G1Point(BigInt(14), BigInt(15)), new G1Point(BigInt(16), BigInt(17))],
)

export const testTallyVk = new VerifyingKey(
    new G1Point(BigInt(0), BigInt(1)),
    new G2Point([BigInt(2), BigInt(3)], [BigInt(4), BigInt(5)]),
    new G2Point([BigInt(6), BigInt(7)], [BigInt(8), BigInt(9)]),
    new G2Point([BigInt(10), BigInt(11)], [BigInt(12), BigInt(13)]),
    [new G1Point(BigInt(14), BigInt(15)), new G1Point(BigInt(16), BigInt(17))],
)

export const initialVoiceCreditBalance = 100
export const maxValues: MaxValues = {
    maxMessages: STATE_TREE_ARITY ** MESSAGE_TREE_DEPTH,
    maxVoteOptions: 125,
}

export const treeDepths: TreeDepths = {
    intStateTreeDepth: 1,
    messageTreeDepth: MESSAGE_TREE_DEPTH,
    messageTreeSubDepth: MESSAGE_TREE_SUBDEPTH,
    voteOptionTreeDepth: 3,
}

export const tallyBatchSize = STATE_TREE_ARITY ** treeDepths.intStateTreeDepth

export interface ITestContracts {
    minimalQF: MinimalQF
    vkRegistryContract: VkRegistry
    verifierContract: MockVerifier
    token: ERC20
    recipientRegistry: SimpleRecipientRegistry
}

export const deployTestContracts = async (): Promise<ITestContracts> => {
    const verifierContract = await deployMockVerifier(undefined, true)
    const vkRegistryContract = await deployVkRegistry(undefined, true)

    // deploy factories
    const recipientRegistryFactory = await ethers.getContractFactory("SimpleRecipientRegistry")
    const recipientRegistry = await recipientRegistryFactory.deploy()

    const tokenFactory = await ethers.getContractFactory("MockERC20")
    const token = (await tokenFactory.deploy("Test Token", "TST")) as unknown as ERC20

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

    const contractsToLink = ["MinimalQF", "PollFactory", "MessageProcessorFactory", "MinimalQFTallyFactory"]

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

    const pollFactoryContract = await deployContractWithLinkedLibraries<PollFactory>(
        pollFactoryContractFactory,
        "",
        true,
    )

    const messageProcessorFactoryContract = await deployContractWithLinkedLibraries<MessageProcessorFactory>(
        messageProcessorFactory,
        "",
        true,
    )

    const tallyFactoryContract = await deployContractWithLinkedLibraries<TallyFactory>(tallyFactory, "", true)

    const [pollAddr, mpAddr, tallyAddr] = await Promise.all([
        pollFactoryContract.getAddress(),
        messageProcessorFactoryContract.getAddress(),
        tallyFactoryContract.getAddress(),
    ])

    const minimalQF = await deployContractWithLinkedLibraries<MinimalQF>(
        minimalQFFactory,
        "MinimalQF",
        true,
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

    // set the verification keys on the vk smart contract
    await vkRegistryContract.setVerifyingKeys(
        STATE_TREE_DEPTH,
        treeDepths.intStateTreeDepth,
        treeDepths.messageTreeDepth,
        treeDepths.voteOptionTreeDepth,
        messageBatchSize,
        testProcessVk.asContractParam() as IVerifyingKeyStruct,
        testTallyVk.asContractParam() as IVerifyingKeyStruct
    )

    return {
        minimalQF,
        vkRegistryContract,
        verifierContract,
        token,
        recipientRegistry,
    }
}

/**
 * Travel in time in a local blockchain node
 * @param provider the provider to use
 * @param seconds the number of seconds to travel for
 */
export async function timeTravel(provider: EthereumProvider, seconds: number): Promise<void> {
    await provider.send("evm_increaseTime", [Number(seconds)])
    await provider.send("evm_mine", [])
}
