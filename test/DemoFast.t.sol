// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ProtectedERC20} from "../src/ProtectedERC20.sol";
import {ProtectedWrapper} from "../src/ProtectedWrapper.sol";
import {DemoFastProtectedWrapper} from "../src/demo/DemoFastProtectedWrapper.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

contract DemoFastTest is Test {
    MockERC20 usdc;
    DemoFastProtectedWrapper fast;
    ProtectedWrapper real;
    address alice = makeAddr("alice");
    address backup = makeAddr("backup");
    address bob = makeAddr("bob");
    uint256 constant START = 1_000_000;

    function setUp() public {
        vm.warp(START);
        usdc = new MockERC20("USD Coin", "USDC", 6);
        fast = new DemoFastProtectedWrapper(usdc, "Demo Protected USDC", "dpUSDC");
        real = new ProtectedWrapper(usdc, "Protected USDC", "pUSDC");
        usdc.mint(alice, 11_000e6);
        vm.startPrank(alice);
        usdc.approve(address(fast), type(uint256).max);
        usdc.approve(address(real), type(uint256).max);
        fast.deposit(10_000e6);
        real.deposit(1_000e6);
        vm.stopPrank();
    }

    function test_Real_RejectsMinuteValues() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ProtectedERC20.InvalidParam.selector, ProtectedERC20.Param.HoldWindow, 60));
        real.protect(backup, 100e6, 60, 7 days, 1 days);
        (uint64 lo,) = real.paramBounds(ProtectedERC20.Param.HoldWindow);
        assertEq(lo, 1 days);
        assertEq(real.limitPeriod(), 1 days);
    }

    function test_Fast_AcceptsMinutesButNotSeconds() public {
        vm.startPrank(alice);
        vm.expectRevert();
        fast.protect(backup, 100e6, 30, 60, 60); // 30s hold is below 1 minute
        fast.protect(backup, 100e6, 60, 60, 60);
        vm.stopPrank();
        assertTrue(fast.isProtected(alice));
    }

    function test_Fast_QueueExecutesAfterOneMinute() public {
        vm.startPrank(alice);
        fast.protect(backup, 100e6, 60, 60, 60);
        uint256 id = fast.queueTransfer(bob, 5_000e6);
        vm.expectRevert();
        fast.executeTransfer(id); // too early
        vm.stopPrank();
        vm.warp(START + 61);
        fast.executeTransfer(id);
        assertEq(fast.balanceOf(bob), 5_000e6);
    }

    function test_Fast_DailyLimitResetsAfterTenMinutes() public {
        vm.startPrank(alice);
        fast.protect(backup, 100e6, 60, 60, 60);
        fast.transfer(bob, 100e6);
        vm.expectRevert();
        fast.transfer(bob, 1e6); // limit used up
        vm.stopPrank();
        vm.warp(START + 10 minutes + 1);
        vm.prank(alice);
        fast.transfer(bob, 100e6);
        assertEq(fast.balanceOf(bob), 200e6);
    }

    function test_Fast_FlagOffAfterOneMinute() public {
        vm.startPrank(alice);
        fast.protect(backup, 100e6, 60, 60, 60);
        fast.requestFlagOff();
        vm.stopPrank();
        assertTrue(fast.isProtected(alice));
        vm.warp(START + 61);
        assertFalse(fast.isProtected(alice));
    }

    function test_Fast_StressLocksForMinute() public {
        vm.startPrank(alice);
        fast.protect(backup, 100e6, 60, 60, 60);
        fast.stress(alice);
        vm.stopPrank();
        (uint256 locked, uint64 until) = fast.lockOf(backup);
        assertEq(locked, 10_000e6);
        assertEq(until, START + 60);
    }
}
