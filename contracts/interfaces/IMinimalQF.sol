// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import { IMACI } from "maci-contracts/contracts/interfaces/IMACI.sol";

/// @title IMinimalQF
/// @notice This contract is a minimal implementation of a Quadratic Funding
/// protocol.
interface IMinimalQF is IMACI {
    function contributors(address) external view returns (uint256);
}
