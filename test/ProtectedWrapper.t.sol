// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ProtectedERC20} from "../src/ProtectedERC20.sol";
import {ProtectedWrapper} from "../src/ProtectedWrapper.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

contract ProtectedWrapperTest is Test {
    MockERC20 usdc;
    ProtectedWrapper pusdc;

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");
    address mallory = makeAddr("mallory");

    uint256 constant LIMIT = 100e6;
    uint64 constant HOLD = 3 days;
    uint64 constant OFF = 7 days;
    uint64 constant LOCK = 14 days;
    uint256 constant START = 1_700_000_000;

    function setUp() public {
        vm.warp(START);
        usdc = new MockERC20("USD Coin", "USDC", 6);
        pusdc = new ProtectedWrapper(usdc, "Protected USDC", "pUSDC", ProtectedERC20.Minimums(1 days, 7 days, 1 days));
        usdc.mint(alice, 1_000e6);
        vm.startPrank(alice);
        usdc.approve(address(pusdc), type(uint256).max);
        pusdc.deposit(1_000e6);
        vm.stopPrank();
    }

    function _protect() internal {
        vm.prank(alice);
        pusdc.protect(bob, LIMIT, HOLD, OFF, LOCK, false);
    }

    function test_Metadata() public view {
        assertEq(pusdc.decimals(), 6);
        assertEq(pusdc.symbol(), "pUSDC");
        assertEq(address(pusdc.underlying()), address(usdc));
    }

    function test_Constructor_RejectsZeroUnderlying() public {
        vm.expectRevert(ProtectedWrapper.InvalidUnderlying.selector);
        new ProtectedWrapper(MockERC20(address(0)), "x", "x", ProtectedERC20.Minimums(1 days, 7 days, 1 days));
    }

    function test_DepositWithdraw_OneToOne() public {
        assertEq(pusdc.balanceOf(alice), 1_000e6);
        assertEq(usdc.balanceOf(address(pusdc)), 1_000e6);
        assertEq(pusdc.totalSupply(), 1_000e6);

        vm.prank(alice);
        pusdc.withdraw(400e6);
        assertEq(usdc.balanceOf(alice), 400e6);
        assertEq(pusdc.totalSupply(), 600e6);
    }

    function test_DepositFor_ProtectedAccountIsInstant() public {
        _protect();
        usdc.mint(carol, 5_000e6);
        vm.startPrank(carol);
        usdc.approve(address(pusdc), type(uint256).max);
        pusdc.depositFor(alice, 5_000e6);
        vm.stopPrank();
        assertEq(pusdc.balanceOf(alice), 6_000e6);
    }

    function test_Deposit_RejectsBadInput() public {
        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(ProtectedERC20.InvalidRecipient.selector, address(pusdc)));
        pusdc.depositFor(address(pusdc), 1);
        vm.expectRevert(ProtectedERC20.ZeroAmount.selector);
        pusdc.deposit(0);
        vm.stopPrank();
    }

    function test_Withdraw_FollowsDailyLimit() public {
        _protect();
        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(ProtectedERC20.ExceedsDailyLimit.selector, alice, 500e6, LIMIT));
        pusdc.withdraw(500e6);
        vm.expectRevert(abi.encodeWithSelector(ProtectedERC20.ExceedsDailyLimit.selector, alice, 500e6, LIMIT));
        pusdc.withdrawTo(mallory, 500e6);
        pusdc.withdraw(LIMIT);
        vm.stopPrank();
        assertEq(usdc.balanceOf(alice), LIMIT);
    }

    function test_TransferToWrapper_Unwraps() public {
        vm.prank(alice);
        pusdc.transfer(address(pusdc), 300e6);
        assertEq(usdc.balanceOf(alice), 300e6);
        assertEq(pusdc.balanceOf(address(pusdc)), 0);
        assertEq(pusdc.totalSupply(), 700e6);
    }

    function test_TransferToWrapper_FollowsDailyLimit() public {
        _protect();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ProtectedERC20.ExceedsDailyLimit.selector, alice, 300e6, LIMIT));
        pusdc.transfer(address(pusdc), 300e6);
    }

    function test_QueuedUnwrap_PaysUnderlyingToOwnerAfterHold() public {
        _protect();
        vm.prank(alice);
        uint256 id = pusdc.queueTransfer(address(pusdc), 900e6);

        vm.warp(START + HOLD);
        pusdc.executeTransfer(id);
        assertEq(usdc.balanceOf(alice), 900e6);
        assertEq(pusdc.balanceOf(alice), 100e6);
        assertEq(pusdc.totalSupply(), 100e6);
    }

    function test_QueuedUnwrap_CancelledByBackup() public {
        _protect();
        vm.prank(alice);
        uint256 id = pusdc.queueTransfer(address(pusdc), 900e6);
        vm.prank(bob);
        pusdc.cancelTransfer(id);
        vm.warp(START + HOLD);
        vm.expectRevert(abi.encodeWithSelector(ProtectedERC20.TransferNotPending.selector, id));
        pusdc.executeTransfer(id);
        assertEq(usdc.balanceOf(alice), 0);
    }

    function test_LockedBackupCannotUnwrapUntilExpiry() public {
        _protect();
        vm.prank(bob);
        pusdc.stress(alice);

        vm.startPrank(bob);
        vm.expectRevert(abi.encodeWithSelector(ProtectedERC20.InsufficientUnlockedBalance.selector, bob, 1_000e6, 0));
        pusdc.withdraw(1_000e6);
        vm.expectRevert(abi.encodeWithSelector(ProtectedERC20.InsufficientUnlockedBalance.selector, bob, 1, 0));
        pusdc.transfer(address(pusdc), 1);
        vm.stopPrank();

        vm.warp(START + LOCK);
        vm.prank(bob);
        pusdc.withdraw(1_000e6);
        assertEq(usdc.balanceOf(bob), 1_000e6);
        assertEq(pusdc.totalSupply(), 0);
    }

    function test_AutoQueue_WalletSendToWrapperSchedulesUnwrap() public {
        _protect();
        vm.prank(alice, alice); // "Send pUSDC to the pUSDC contract" from a wallet app
        pusdc.transfer(address(pusdc), 900e6);
        assertEq(usdc.balanceOf(alice), 0);
        assertEq(pusdc.reservedOf(alice), 900e6);
        uint256 id = pusdc.pendingTransferIds(alice)[0];
        vm.warp(START + HOLD);
        pusdc.executeTransfer(id);
        assertEq(usdc.balanceOf(alice), 900e6);
    }

    // ═════════════ per-deployment minimums (minutes for demos, days for production) ═════════════

    function test_Minimums_ConstructorRejectsZeroOrAboveMax() public {
        vm.expectRevert(ProtectedERC20.InvalidMinimums.selector);
        new ProtectedWrapper(usdc, "x", "x", ProtectedERC20.Minimums(0, 7 days, 1 days));
        vm.expectRevert(ProtectedERC20.InvalidMinimums.selector);
        new ProtectedWrapper(usdc, "x", "x", ProtectedERC20.Minimums(1 days, 366 days, 1 days));
        vm.expectRevert(ProtectedERC20.InvalidMinimums.selector);
        new ProtectedWrapper(usdc, "x", "x", ProtectedERC20.Minimums(31 days, 7 days, 1 days));
    }

    function test_Minimums_DefaultsExposed() public view {
        assertEq(pusdc.MIN_HOLD_WINDOW(), pusdc.DEFAULT_MIN_HOLD_WINDOW());
        assertEq(pusdc.MIN_OFF_DELAY(), 7 days);
        assertEq(pusdc.MIN_LOCK_DURATION(), 1 days);
    }

    function test_Minimums_MinuteDeploymentWorksEndToEnd() public {
        ProtectedWrapper fast = new ProtectedWrapper(
            usdc, "Protected USDC", "pUSDC", ProtectedERC20.Minimums(1 minutes, 2 minutes, 1 minutes)
        );
        usdc.mint(alice, 1_000e6);
        vm.startPrank(alice);
        usdc.approve(address(fast), type(uint256).max);
        fast.deposit(1_000e6);

        // Below this deployment's minimums is still rejected.
        vm.expectRevert(
            abi.encodeWithSelector(ProtectedERC20.InvalidParam.selector, ProtectedERC20.Param.HoldWindow, 30)
        );
        fast.protect(bob, LIMIT, 30 seconds, 2 minutes, 1 minutes, false);

        fast.protect(bob, LIMIT, 5 minutes, 2 minutes, 1 minutes, false);
        uint256 id = fast.queueTransfer(carol, 500e6);
        fast.requestFlagOff();
        vm.stopPrank();

        vm.warp(START + 5 minutes - 1);
        vm.expectRevert(abi.encodeWithSelector(ProtectedERC20.HoldNotExpired.selector, id, uint64(START + 5 minutes)));
        fast.executeTransfer(id);
        vm.warp(START + 5 minutes);
        fast.executeTransfer(id);
        assertEq(fast.balanceOf(carol), 500e6);
        assertFalse(fast.isProtected(alice)); // flag-off matured after 2 minutes

        // The stress lock works in minutes too.
        vm.prank(alice);
        fast.protect(bob, LIMIT, 1 minutes, 2 minutes, 3 minutes, false);
        vm.prank(bob);
        fast.stress(alice);
        (uint256 locked, uint64 until) = fast.lockOf(bob);
        assertEq(locked, 500e6);
        assertEq(until, START + 5 minutes + 3 minutes);
    }
}

