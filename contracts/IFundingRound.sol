// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

/// @title IFundingRound
/// @notice This is the interface to a minimal implementation of a Quadratic Funding
/// round.
interface IFundingRound {
    function isCancelled() external view returns (bool);
    function isFinalized() external view returns (bool);
}
