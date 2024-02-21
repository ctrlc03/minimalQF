// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

import { MACI } from "maci-contracts/contracts/MACI.sol";
import { IPollFactory } from "maci-contracts/contracts/interfaces/IPollFactory.sol";
import { IMessageProcessorFactory } from "maci-contracts/contracts/interfaces/IMPFactory.sol";
import { ITallySubsidyFactory } from "maci-contracts/contracts/interfaces/ITallySubsidyFactory.sol";
import { SignUpGatekeeper } from "maci-contracts/contracts/gatekeepers/SignUpGatekeeper.sol";
import { InitialVoiceCreditProxy } from "maci-contracts/contracts/initialVoiceCreditProxy/InitialVoiceCreditProxy.sol";
import { TopupCredit } from "maci-contracts/contracts/TopupCredit.sol";

import { IRecipientRegistry } from "./IRecipientRegistry.sol";
import { IFundingRound } from "./IFundingRound.sol";
import { IFundingRoundTally } from "./IFundingRoundTally.sol";

/// @title MinimalQF
/// @notice This contract is a minimal implementation of a Quadratic Funding
/// protocol.
contract MinimalQF is Ownable, MACI {
    using SafeERC20 for IERC20;

    // the round token
    IERC20 public nativeToken;

    // store the contributors
    mapping(address => uint256) public contributors;

    // contract to store the recipient registry
    IRecipientRegistry public recipientRegistry;

    // the tally contract
    IFundingRoundTally public tally;

    // the funding sources
    address[] public fundingSources;

    // events
    event FundingSourceAdded(address _source);
    event RoundFinalized(address _round);

    // custom errors
    error RoundNotCancelled();

    /// @notice Create a new instance of MinimalQF
    /// @param _fundingRoundFacotory The address of the funding round factory
    /// @param _messageProcessorFactory The address of the message processor factory
    /// @param _tallyFactory The address of the tally factory
    /// @param _subsidyFactory The address of the subsidy factory
    /// @param _signUpGatekeeper The address of the sign up gatekeeper
    /// @param _initialVoiceCreditProxy The address of the initial voice credit proxy
    /// @param _topupCredit The address of the topup credit
    /// @param _stateTreeDepth The depth of the state tree
    /// @param _token The address of the token
    /// @param _recipientRegistry The address of the recipient registry
    constructor(
        IPollFactory _fundingRoundFacotory,
        IMessageProcessorFactory _messageProcessorFactory,
        ITallySubsidyFactory _tallyFactory,
        ITallySubsidyFactory _subsidyFactory,
        SignUpGatekeeper _signUpGatekeeper,
        InitialVoiceCreditProxy _initialVoiceCreditProxy,
        TopupCredit _topupCredit,
        uint8 _stateTreeDepth,
        address _token,
        address _recipientRegistry
    )
        MACI(
            _fundingRoundFacotory,
            _messageProcessorFactory,
            _tallyFactory,
            _subsidyFactory,
            _signUpGatekeeper,
            _initialVoiceCreditProxy,
            _topupCredit,
            _stateTreeDepth
        )
    {
        nativeToken = IERC20(_token);
        recipientRegistry = IRecipientRegistry(_recipientRegistry);
    }

    /// @notice Deploy a Poll (Funding round) and related contracts
    /// @param _duration The duration of the poll
    /// @param _treeDepths The tree depths
    /// @param _coordinatorPubKey The public key of the coordinator
    /// @param _verifier The address of the verifier contract
    /// @param _vkRegistry The address of the Verifying Key registry
    /// @param useSubsidy Whether to use the subsidy feature
    function deployPoll(
        uint256 _duration,
        TreeDepths memory _treeDepths,
        PubKey memory _coordinatorPubKey,
        address _verifier,
        address _vkRegistry,
        bool useSubsidy
    ) public override onlyOwner returns (PollContracts memory pollAddr) {
        // deploy the poll
        pollAddr = super.deployPoll(_duration, _treeDepths, _coordinatorPubKey, _verifier, _vkRegistry, useSubsidy);

        // store the contracts
        tally = IFundingRoundTally(pollAddr.tally);

        // init the tally contract
        IFundingRoundTally(pollAddr.tally).initialize(address(nativeToken), address(recipientRegistry), address(this));
    }

    /// @notice Sign up to the MACI system
    /// @param _pubKey The public key of the user
    /// @param _signUpGatekeeperData The data for the sign up gatekeeper
    /// @param _initialVoiceCreditProxyData The data for the initial voice credit proxy
    function signUp(
        PubKey memory _pubKey,
        bytes memory _signUpGatekeeperData,
        bytes memory _initialVoiceCreditProxyData
    ) public override {
        // the amount must be set in the initial voice credit proxy data
        uint256 amount = abi.decode(_initialVoiceCreditProxyData, (uint256));

        // transfer tokens to this contract
        nativeToken.safeTransferFrom(msg.sender, address(this), amount);

        // the voice credits will be the amount divided by the factor
        // the factor should be decimals of the token
        // normal signup
        super.signUp(_pubKey, _signUpGatekeeperData, _initialVoiceCreditProxyData);

        // store the address of the user signing up and amount so they can be refunded just in case
        // the round is cancelled
        // they will be able to vote from different addresses though
        contributors[msg.sender] = amount;
    }

    /// @notice Withdraw funds
    /// @dev only if the round was cancelled
    function withdraw() external {
        // check if the round was cancelled
        if (!tally.isCancelled()) {
            revert RoundNotCancelled();
        }

        // cache so we can delete before sending
        uint256 amount = contributors[msg.sender];

        // reset to zero
        contributors[msg.sender] = 0;

        // transfer tokens back to the user
        nativeToken.safeTransfer(msg.sender, amount);
    }

    /// @notice Add matching funds source.
    /// @dev Cannot remove a funding source.
    /// @param _source Address of a funding source.
    function addFundingSource(address _source) external onlyOwner {
        fundingSources.push(_source);
        emit FundingSourceAdded(_source);
    }

    /// @notice Get amount of matching funds.
    /// @return matchingPoolSize The amount of matching funds.
    function getMatchingFunds() external view returns (uint256 matchingPoolSize) {
        // get balance of current contract
        matchingPoolSize = nativeToken.balanceOf(address(this));

        uint256 len = fundingSources.length;
        for (uint256 index = 0; index < len; ) {
            address fundingSource = fundingSources[index];

            // get both allowance or balance
            uint256 allowance = nativeToken.allowance(fundingSource, address(this));
            uint256 balance = nativeToken.balanceOf(fundingSource);

            unchecked {
                // cannot overflow uint256 with a ERC20 total supply
                matchingPoolSize += allowance < balance ? allowance : balance;
                index++;
            }
        }
    }

    /// @dev Transfer funds from matching pool to current funding round and finalize it.
    /// @param _totalSpent Total amount of spent voice credits.
    /// @param _totalSpentSalt The salt.
    function transferMatchingFunds(
        uint256 _totalSpent,
        uint256 _totalSpentSalt,
        uint256 _newResultCommitment,
        uint256 _perVOSpentVoiceCreditsHash
    ) external onlyOwner {
        // cache the native token
        IERC20 _nativeToken = nativeToken;

        uint256 matchingPoolSize = _nativeToken.balanceOf(address(this));

        // cache tally address
        address currentRoundTally = address(tally);

        if (matchingPoolSize > 0) {
            _nativeToken.safeTransfer(currentRoundTally, matchingPoolSize);
        }

        // Pull funds from other funding sources
        uint256 len = fundingSources.length;
        for (uint256 index = 0; index < len; ) {
            address fundingSource = fundingSources[index];
            uint256 allowance = _nativeToken.allowance(fundingSource, address(this));
            uint256 balance = _nativeToken.balanceOf(fundingSource);
            uint256 contribution = allowance < balance ? allowance : balance;

            // if > 0 then transfer
            if (contribution > 0) {
                _nativeToken.safeTransferFrom(fundingSource, currentRoundTally, contribution);
            }

            unchecked {
                index++;
            }
        }

        // finalize the round
        IFundingRoundTally(currentRoundTally).finalize(
            _totalSpent,
            _totalSpentSalt,
            _newResultCommitment,
            _perVOSpentVoiceCreditsHash
        );

        // emit event so we know the round is finished
        emit RoundFinalized(currentRoundTally);
    }
}
