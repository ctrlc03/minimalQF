// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import { Poll } from "maci-contracts/contracts/Poll.sol";

/// @title MinimalFundingRound
/// @notice This contract is a minimal implementation of a Quadratic Funding
/// protocol funding round.
contract MinimalFundingRound is Poll {
    /// @notice custom errors
    error InvalidBatchLength();

    /// @notice creates a new MinimalFundingRound
    /// @param _duration the duration of the round
    /// @param _maxValues the maximum values for the round
    /// @param _treeDepths the tree depths for the round
    /// @param _coordinatorPubKey the public key of the coordinator
    /// @param _extContracts the external contracts
    constructor(
        uint256 _duration,
        MaxValues memory _maxValues,
        TreeDepths memory _treeDepths,
        PubKey memory _coordinatorPubKey,
        ExtContracts memory _extContracts
    ) payable Poll(_duration, _maxValues, _treeDepths, _coordinatorPubKey, _extContracts) {}

    /// @notice submit a message batch
    /// @dev Can only be submitted before the voting deadline
    /// @param _messages the messages
    /// @param _encPubKeys the encrypted public keys
    function submitBatch(Message[] calldata _messages, PubKey[] calldata _encPubKeys) external isWithinVotingDeadline {
        if (_messages.length != _encPubKeys.length) {
            revert InvalidBatchLength();
        }

        uint256 len = _messages.length;
        for (uint256 i = 0; i < len; ) {
            // an event will be published by this function already
            super.publishMessage(_messages[i], _encPubKeys[i]);

            unchecked {
                i++;
            }
        }
    }
}
