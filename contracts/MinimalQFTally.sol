// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import { Tally } from "maci-contracts/contracts/Tally.sol";

import { IRecipientRegistry } from "./interfaces/IRecipientRegistry.sol";

import "hardhat/console.sol";

/// @title MinimalQFTally
/// @notice This contract is a minimal implementation of a Quadratic Funding
/// Tally contract
contract MinimalQFTally is Tally {
    using SafeERC20 for IERC20;

    // The alpha used in quadratic funding formula
    uint256 public alpha;

    // whether the round is finalized
    bool public isFinalized;
    // whether the round is cancelled
    bool public isCancelled;

    // should be good for all tokens
    uint256 internal constant VOICE_CREDIT_FACTOR = 10e6;
    uint256 internal constant ALPHA_PRECISION = 10e18;

    // used to fetch the recipients of the round
    IRecipientRegistry public recipientRegistry;

    // store the recipients that have claimed their funds
    mapping(address => bool) public hasClaimedFunds;

    // the total amount of spent voice credits
    uint256 public totalSpent;
    // the matching pool size
    uint256 public matchingPoolSize;

    // the minimal QF contract
    address public minimalQF;

    // the native token
    IERC20 public nativeToken;

    // whether the contract was init or not
    bool internal isInit;

    // the link to the tally result json file
    string public tallyResultLink;

    // custom errors
    error AlreadyInit();
    error RoundCancelled();
    error BallotsNotTallied();
    error InvalidBudget();
    error NoProjectHasMoreThanOneVote();
    error InvalidSpentVoiceCreditsProof();
    error InvalidPerVOSpentVoiceCreditsProof();
    error NoVotes();
    error AlreadyFinalized();
    error OnlyMinimalQF();
    error AlreadyClaimedFunds();

    /// @notice creates a new MinimalQFTally
    /// @param _verifier the address of the Verifier contract
    /// @param _vkRegistry the address of the VerifyingKeyRegistry contract
    /// @param _poll the address of the Poll contract
    /// @param _mp the address of the MinimalQF contract
    constructor(
        address _verifier,
        address _vkRegistry,
        address _poll,
        address _mp,
        address _tallyOwner,
        Mode _mode
    ) payable Tally(_verifier, _vkRegistry, _poll, _mp, _tallyOwner, _mode) {}

    /// @notice Initialize the contract
    /// @param _nativeToken the native token
    /// @param _recipientRegistry the recipient registry
    /// @param _minimalQF the minimal QF
    function initialize(address _nativeToken, address _recipientRegistry, address _minimalQF) external {
        if (isInit) revert AlreadyInit();

        isInit = true;
        nativeToken = IERC20(_nativeToken);
        recipientRegistry = IRecipientRegistry(_recipientRegistry);
        minimalQF = _minimalQF;
    }

    /// @notice Cancel current round.
    function cancelRound() external onlyOwner {
        if (isFinalized) revert AlreadyFinalized();

        isCancelled = true;
    }

    /// @notice Publish the tally result link
    /// @param _tallyResultLink the link to the tally result json file
    function publishTallyResultLink(string calldata _tallyResultLink) external onlyOwner {
        tallyResultLink = _tallyResultLink;
    }

    /// @notice Verify the per vote option spent voice credits proof and claim funds
    /// @dev funds will be sent to the recipient from the recipient registry
    /// @param _voteOptionIndex the index of the vote option
    /// @param _spent the amount of spent voice credits
    /// @param _proof the proof
    /// @param _spentSalt the salt used in the spent voice credits commitment
    /// @param _resultsCommitment the results commitment
    /// @param _spentVoiceCreditsCommitment the spent voice credits commitment
    /// @param _resultsCommitment the results commitment
    function claimFunds(
        uint256 _voteOptionIndex,
        uint256 _spent,
        uint256[][] calldata _proof,
        uint256 _spentSalt,
        uint256 _resultsCommitment,
        uint256 _spentVoiceCreditsCommitment
    ) external {
        // we check that the poll is not cancelled
        if (isCancelled) revert RoundCancelled();

        // the ballots must have been tallied first
        if (!isTallied()) revert BallotsNotTallied();

        (, , , uint8 voteOptionTreeDepth) = poll.treeDepths();

        // verify perVOProof
        if (
            !verifyPerVOSpentVoiceCredits(
                _voteOptionIndex,
                _spent,
                _proof,
                _spentSalt,
                voteOptionTreeDepth,
                _spentVoiceCreditsCommitment,
                _resultsCommitment
            )
        ) revert InvalidPerVOSpentVoiceCreditsProof();

        // get the recipient address
        address recipient = recipientRegistry.getRecipient(_voteOptionIndex);
        // check that the recipient has not received their funds already
        if (hasClaimedFunds[recipient]) revert AlreadyClaimedFunds();
        // set so they cannot claim anymore
        hasClaimedFunds[recipient] = true;

        if (recipient == address(0)) {
            // send funds back to the MinimalQF contract
            // as that's where users have been depositing tokens
            // @todo what to do with those tokens?
            nativeToken.safeTransfer(minimalQF, _spent);
        }

        // calculate the matching funds
        uint256 allocatedAmount = getAllocatedAmount(_spent);

        // transfer the token to the recipient
        nativeToken.safeTransfer(recipient, allocatedAmount);
    }

    /// @notice Finalize the round
    /// @param _totalSpent the total amount of spent voice credits
    /// @param _totalSpentSalt the salt used in the total spent voice credits commitment
    /// @param _newResultCommitment the new results commitment
    /// @param _perVOSpentVoiceCreditsHash the hash of the per vote option spent voice credits
    function finalize(
        uint256 _totalSpent,
        uint256 _totalSpentSalt,
        uint256 _newResultCommitment,
        uint256 _perVOSpentVoiceCreditsHash
    ) external {
        // check that this is called by MinimalQF
        if (msg.sender != minimalQF) revert OnlyMinimalQF();

        // cannot be cancelled
        if (isCancelled) revert RoundCancelled();

        // cannot finalize twice
        if (isFinalized) revert AlreadyFinalized();
        isFinalized = true;

        // check that all ballots have been tallied
        if (!isTallied()) revert BallotsNotTallied();

        // there must be at least one vote
        if (_totalSpent == 0) revert NoVotes();

        // verify proof
        if (!verifySpentVoiceCredits(_totalSpent, _totalSpentSalt, _newResultCommitment, _perVOSpentVoiceCreditsHash)) {
            revert InvalidSpentVoiceCreditsProof();
        }

        // store the total spent
        totalSpent = _totalSpent;

        // get balance and calculate matching pool size
        uint256 budget = nativeToken.balanceOf(address(this));
        matchingPoolSize = budget - totalSpent * VOICE_CREDIT_FACTOR;

        alpha = calcAlpha(budget, _totalSpent * _totalSpent, _totalSpent);
    }

    /// @notice Calculate the amount to distribute to a certain project
    /// @param _spent the amount of spent voice credits
    function getAllocatedAmount(uint256 _spent) public view returns (uint256) {
        // amount = ( alpha * (quadratic votes)^2 + (precision - alpha) * totalSpent ) / precision
        uint256 quadratic = alpha * VOICE_CREDIT_FACTOR * _spent;
        uint256 totalSpentCredits = VOICE_CREDIT_FACTOR * _spent;
        uint256 linearPrecision = ALPHA_PRECISION * totalSpentCredits;
        uint256 linearAlpha = alpha * totalSpentCredits;

        return ((quadratic + linearPrecision) - linearAlpha) / ALPHA_PRECISION;
    }

    /// @dev Calculate the alpha for the capital constrained quadratic formula
    /// in page 17 of https://arxiv.org/pdf/1809.06421.pdf
    /// @param _budget Total budget of the round to be distributed
    /// @param _totalVotesSquares Total of the squares of votes
    /// @param _totalSpent Total amount of spent voice credits
    function calcAlpha(
        uint256 _budget,
        uint256 _totalVotesSquares,
        uint256 _totalSpent
    ) public pure returns (uint256 _alpha) {
        // make sure budget = contributions + matching pool
        uint256 contributions = _totalSpent * VOICE_CREDIT_FACTOR;

        if (_budget < contributions) {
            revert InvalidBudget();
        }

        // guard against division by zero.
        // This happens when no project receives more than one vote
        if (_totalVotesSquares <= _totalSpent) {
            revert NoProjectHasMoreThanOneVote();
        }

        return ((_budget - contributions) * 10e18) / (VOICE_CREDIT_FACTOR * (_totalVotesSquares - _totalSpent));
    }
}
