// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

import { PollFactory } from "maci-contracts/contracts/PollFactory.sol";
import { IMACI } from "maci-contracts/contracts/interfaces/IMACI.sol";
import { TopupCredit } from "maci-contracts/contracts/TopupCredit.sol";
import { AccQueue } from "maci-contracts/contracts/trees/AccQueue.sol";
import { AccQueueQuinaryMaci } from "maci-contracts/contracts/trees/AccQueueQuinaryMaci.sol";

import { MinimalFundingRound } from "./FundingRound.sol";
import { IMinimalQF } from "./IMinimalQF.sol";

/// @title FundingRoundFactory
/// @notice This contract is a funding round factory
contract FundingRoundFactory is PollFactory {
    /// @notice The PollFactory constructor
    // solhint-disable-next-line no-empty-blocks
    constructor() payable {}

    function deploy(
        uint256 _duration,
        MaxValues calldata _maxValues,
        TreeDepths calldata _treeDepths,
        PubKey calldata _coordinatorPubKey,
        address _maci,
        TopupCredit _topupCredit,
        address _pollOwner
    ) public override(PollFactory) returns (address pollAddr) {
        /// @notice Validate _maxValues
        /// maxVoteOptions must be less than 2 ** 50 due to circuit limitations;
        /// it will be packed as a 50-bit value along with other values as one
        /// of the inputs (aka packedVal)
        if (_maxValues.maxVoteOptions >= (2 ** 50)) {
            revert InvalidMaxValues();
        }

        /// @notice deploy a new AccQueue contract to store messages
        AccQueue messageAq = new AccQueueQuinaryMaci(_treeDepths.messageTreeSubDepth);

        /// @notice the smart contracts that a Poll would interact with
        ExtContracts memory extContracts = ExtContracts({
            maci: IMACI(_maci),
            messageAq: messageAq,
            topupCredit: _topupCredit
        });

        // deploy the fundingRound
        MinimalFundingRound fundingRound = new MinimalFundingRound(
            _duration,
            _maxValues,
            _treeDepths,
            _coordinatorPubKey,
            extContracts
        );

        // Make the Poll contract own the messageAq contract, so only it can
        // run enqueue/merge
        messageAq.transferOwnership(address(fundingRound));

        // init Poll
        fundingRound.init();

        fundingRound.transferOwnership(_pollOwner);

        pollAddr = address(fundingRound);
    }
}
