// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ProtectedERC20} from "../../src/ProtectedERC20.sol";

/// @dev Concrete ProtectedERC20 with an open mint, for unit tests only.
contract TestProtectedToken is ProtectedERC20 {
    constructor() ProtectedERC20("Test Protected", "tPT") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }
}
