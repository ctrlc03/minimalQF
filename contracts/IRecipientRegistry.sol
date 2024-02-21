// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

/// @dev Interface of the recipient registry.
interface IRecipientRegistry {
    /// @notice Get the recipient at a given index
    function recipients(uint256 _index) external view returns (address);
}
