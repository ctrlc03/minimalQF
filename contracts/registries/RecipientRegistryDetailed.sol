// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

/// @title SimpleRecipientRegistry
/// @notice This contract is a simple registry of recipients
/// @dev it allows the owner to overwrite the recipients
/// use with caution.
/// @dev Also this does not constrain the number of recipients
/// which might be > vote options
contract RecipientRegistry is Ownable {
    /// @notice The recipient struct
    struct Recipient {
        address recipientAddress;
        string img;
        string name;
        string description;
    }
    
    // simple storage of recipients (id => Recipient)
    // leaving public so one can get a full recipient by index
    // used on frontends
    mapping(uint256 => Recipient) public recipients;

    constructor() payable {}

    /// @notice Add a recipient to the registry
    /// @param index The index of the recipient
    function addRecipient(uint256 index, Recipient calldata recipient) external onlyOwner {
        recipients[index] = recipient;
    }

    /// @notice Add multiple recipients to the registry
    /// @param _recipients The addresses of the recipients to add
    function addRecipients(Recipient[] calldata _recipients) external onlyOwner {
        uint256 len = _recipients.length;
        for (uint256 i = 0; i < len; ) {
            recipients[i] = _recipients[i];

            unchecked {
                i++;
            }
        }
    }

    /// @notice Get a recipient from the registry
    /// @param index The index of the recipient
    /// @return The address of the recipient
    function getRecipientAddress(uint256 index) external view returns (address) {
        return recipients[index].recipientAddress;
    }
}
