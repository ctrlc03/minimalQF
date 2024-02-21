// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import { InitialVoiceCreditProxy } from "maci-contracts/contracts/initialVoiceCreditProxy/InitialVoiceCreditProxy.sol";

/// @title ERC20InitialVoiceCreditProxy
/// @notice This contract is a voice credit proxy contract for
/// MACI. It allows to set a custom initial voice
/// credit balance based on the amount of tokens transferred
contract ERC20InitialVoiceCreditProxy is InitialVoiceCreditProxy {
    /// @notice a customizable factor to divide the ERC20 token balance by
    uint256 public immutable factor;

    /// @notice creates a new ERC20InitialVoiceCreditProxy
    /// @param _factor a customizable factor to divide the ERC20 token balance by
    constructor(uint256 _factor) payable {
        factor = _factor;
    }

    /// @notice Returns the initial voice credit balance for a new MACI's voter
    /// @param _data additional data
    /// @return the balance
    function getVoiceCredits(address _user, bytes memory _data) public view override returns (uint256) {
        // decode the amount
        uint256 amount = abi.decode(_data, (uint256));

        // the voice credits will be the amount divided by the factor
        return amount / factor;
    }
}
