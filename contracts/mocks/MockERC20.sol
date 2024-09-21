// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockERC20
/// @notice This contract is a mock ERC20 token
contract MockERC20 is ERC20 {
    /// @notice creates a new MockERC20
    /// @param name the name of the token
    /// @param symbol the symbol of the token
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {
        _mint(msg.sender, 100_000_000_000e18);
    }
}
