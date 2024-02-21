// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import { TallyFactory } from "maci-contracts/contracts/TallyFactory.sol";

import { MinimalQFTally } from "./MinimalQFTally.sol";

/// @title MinimalQFTallyFactory
/// @notice This contract is a MinimalQFTally Factory
contract MinimalQFTallyFactory is TallyFactory {
    /// @notice The MinimalQFTallyFactory constructor
    // solhint-disable-next-line no-empty-blocks
    constructor() payable {}

    /// @inheritdoc TallyFactory
    function deploy(
        address _verifier,
        address _vkRegistry,
        address _poll,
        address _messageProcessor,
        address _owner
    ) public override returns (address tallyAddr) {
        // deploy Tally for this Poll
        MinimalQFTally tally = new MinimalQFTally(_verifier, _vkRegistry, _poll, _messageProcessor);

        tally.transferOwnership(_owner);

        tallyAddr = address(tally);
    }
}
