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
        pusdc = new ProtectedWrapper(usdc, "Protected USDC", "pUSDC");
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
        new ProtectedWrapper(MockERC20(address(0)), "x", "x");
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
}

