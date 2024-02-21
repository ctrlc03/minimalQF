// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title IFundingRoundTally
/// @notice This is the interface to a minimal implementation of a Quadratic Funding
/// round Tally contract.
interface IFundingRoundTally {
    function initialize(address _nativeToken, address _recipientRegistry, address _minimalQF) external;
    function finalize(
        uint256 _totalSpent,
        uint256 _totalSpentSalt,
        uint256 _newResultCommitment,
        uint256 _perVOSpentVoiceCreditsHash
    ) external;
    function isCancelled() external view returns (bool);
}
