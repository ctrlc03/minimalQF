// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @dev Interface of the recipient registry.
interface IRecipientRegistry {
    /// @notice Get the recipient at a given index
    function getRecipient(uint256 _index) external view returns (address);
}
