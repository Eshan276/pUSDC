// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {ProtectedWrapper} from "../ProtectedWrapper.sol";

/// @title DemoFastProtectedWrapper
/// @notice TESTNET / DEMO ONLY. Identical to ProtectedWrapper except the time limits are shortened to minutes,
///         so every rule can be watched end to end in a live demo:
///           - hold window, off-delay and lock duration: 1 minute to their normal maximums
///           - the daily-limit window: 10 minutes instead of 24 hours
/// @dev The real minimums (1 day hold, 7 day off-delay, 1 day lock) are what stop a thief who holds your key from
///      setting the delays to zero. With minute-level minimums that protection is mostly gone, so never deploy
///      this for real funds. The name and symbol are prefixed "Demo" so it can't be mistaken for the real token.
contract DemoFastProtectedWrapper is ProtectedWrapper {
    uint64 public constant DEMO_MIN = 1 minutes;
    uint64 public constant DEMO_LIMIT_PERIOD = 10 minutes;

    constructor(IERC20Metadata underlying_, string memory name_, string memory symbol_)
        ProtectedWrapper(underlying_, name_, symbol_)
    {}

    function paramBounds(Param param) public view override returns (uint64 lo, uint64 hi) {
        (, hi) = super.paramBounds(param);
        lo = DEMO_MIN;
    }

    function limitPeriod() public pure override returns (uint64) {
        return DEMO_LIMIT_PERIOD;
    }
}
