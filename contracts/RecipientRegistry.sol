// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

/// @title RecipientRegistry
/// @notice This contract is a simple registry of recipients
/// @dev it allows the owner to overwrite the recipients
/// use with caution.
contract RecipientRegistry is Ownable {
    // simple storage of recipients (id => address)
    mapping(uint256 => address) public recipients;

    constructor() payable {}

    /// @notice Add a recipient to the registry
    /// @param index The index of the recipient
    function addRecipient(uint256 index, address recipient) external onlyOwner {
        recipients[index] = recipient;
    }

    /// @notice Add multiple recipients to the registry
    /// @param _recipients The addresses of the recipients to add
    function addRecipients(address[] calldata _recipients) external onlyOwner {
        uint256 len = _recipients.length;
        for (uint256 i = 0; i < len; ) {
            recipients[i] = _recipients[i];

            unchecked {
                i++;
            }
        }
    }
}
