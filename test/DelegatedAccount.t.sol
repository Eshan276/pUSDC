// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ProtectedERC20} from "../src/ProtectedERC20.sol";
import {TestProtectedToken} from "./mocks/TestProtectedToken.sol";

/// @dev Test-only delegation target. The holder or a fixed test operator may execute calls.
contract TestAccountExecutor {
    address immutable operator;

    constructor(address operator_) {
        operator = operator_;
    }

    modifier authorized() {
        require(msg.sender == operator || msg.sender == address(this), "unauthorized test caller");
        _;
    }

    function execute(address target, bytes calldata data) external authorized returns (bytes memory) {
        return _call(target, data);
    }

    function batch(address target, bytes[] calldata calls) external authorized {
        for (uint256 i; i < calls.length; ++i) {
            _call(target, calls[i]);
        }
    }

    function _call(address target, bytes memory data) internal returns (bytes memory result) {
        bool ok;
        (ok, result) = target.call(data);
        if (!ok) {
            assembly ("memory-safe") {
                revert(add(result, 32), mload(result))
            }
        }
    }
}

/// @notice Characterizes design note 15 using signed delegation designators and delegated execution.
/// @dev Foundry stages the delegation; this suite does not claim mined type-4 transaction coverage.
contract DelegatedAccountTest is Test {
    TestProtectedToken token;
    TestAccountExecutor implementation;
    address holder;
    uint256 holderKey;
    address backup = makeAddr("delegation backup");
    address recipient = makeAddr("delegation recipient");
    address operator = makeAddr("delegation operator");

    uint256 constant BALANCE = 1_000e18;
    uint256 constant LIMIT = 100e18;
    uint64 constant HOLD = 3 days;

    function setUp() public {
        // Keep the repository's 0.8.28/Cancun build; enable delegation semantics for these tests only.
        vm.setEvmVersion("prague");
        vm.warp(1_700_000_000);
        (holder, holderKey) = makeAddrAndKey("delegated protected holder");
        token = new TestProtectedToken();
        implementation = new TestAccountExecutor(operator);
        token.mint(holder, BALANCE);
        vm.prank(holder);
        token.protect(backup, LIMIT, HOLD, 7 days, 14 days, false);
    }

    function _delegate(address target) internal {
        vm.attachDelegation(vm.signDelegation(target, holderKey));
        if (target == address(0)) assertEq(holder.code.length, 0);
        else assertEq(holder.code, abi.encodePacked(hex"ef0100", target));
    }

    function _execute(bytes memory data) internal returns (bytes memory result) {
        vm.prank(operator, operator);
        return TestAccountExecutor(holder).execute(address(token), data);
    }

    function _limitError(uint256 amount, uint256 remaining) internal view returns (bytes memory) {
        return abi.encodeWithSelector(ProtectedERC20.ExceedsDailyLimit.selector, holder, amount, remaining);
    }

    function _assertUntouched(uint256 queueCount) internal view {
        assertEq(token.balanceOf(holder), BALANCE);
        assertEq(token.balanceOf(recipient), 0);
        assertEq(token.dailyLimitRemaining(holder), LIMIT);
        assertEq(token.reservedOf(holder), 0);
        assertEq(token.availableBalanceOf(holder), BALANCE);
        assertEq(token.queuedTransferCount(), queueCount);
        assertEq(token.pendingTransferIds(holder).length, 0);
    }

    function test_PlainSendQueuesButDelegatedDirectSendReverts() public {
        vm.prank(holder, holder);
        assertTrue(token.transfer(recipient, 500e18));
        assertEq(token.balanceOf(recipient), 0);
        assertEq(token.reservedOf(holder), 500e18);
        vm.prank(holder);
        token.cancelTransfer(1);
        _delegate(address(implementation));

        vm.expectRevert(_limitError(500e18, LIMIT));
        vm.prank(holder, holder);
        token.transfer(recipient, 500e18);
        _assertUntouched(1);
    }

    function test_DelegatedExecutionWithinLimitMovesFunds() public {
        _delegate(address(implementation));
        bytes memory result = _execute(abi.encodeCall(token.transfer, (recipient, 60e18)));
        assertTrue(abi.decode(result, (bool)));
        assertEq(token.balanceOf(holder), BALANCE - 60e18);
        assertEq(token.balanceOf(recipient), 60e18);
        assertEq(token.dailyLimitRemaining(holder), 40e18);
        assertEq(token.reservedOf(holder), 0);
        assertEq(token.queuedTransferCount(), 0);
    }

    function test_SameOriginDelegateExecutionCannotAutoQueue() public {
        _delegate(address(implementation));
        vm.expectRevert(_limitError(500e18, LIMIT));
        vm.prank(holder, holder);
        TestAccountExecutor(holder).execute(address(token), abi.encodeCall(token.transfer, (recipient, 500e18)));
        _assertUntouched(0);
    }

    function _overLimitBatch(uint256 first, uint256 second) internal {
        bytes[] memory calls = new bytes[](2);
        calls[0] = abi.encodeCall(token.transfer, (recipient, first));
        calls[1] = abi.encodeCall(token.transfer, (recipient, second));
        vm.expectRevert(_limitError(second, LIMIT - first));
        vm.prank(holder, holder);
        TestAccountExecutor(holder).batch(address(token), calls);
        // The first successful subcall must also roll back; no second-call reservation can survive.
        _assertUntouched(0);
    }

    function test_DelegatedBatchRollsBackWhenCombinedSpendExceedsLimit() public {
        _delegate(address(implementation));
        _overLimitBatch(60e18, 60e18);
    }

    function testFuzz_DelegatedBatchSharesOneDailyLimit(uint256 first, uint256 second) public {
        _delegate(address(implementation));
        first = bound(first, 1, LIMIT - 1);
        second = bound(second, LIMIT - first + 1, BALANCE - first);
        _overLimitBatch(first, second);
    }

    function test_ExplicitQueueSurvivesDelegateReplacement() public {
        _delegate(address(implementation));
        uint256 id = abi.decode(_execute(abi.encodeCall(token.queueTransfer, (recipient, 500e18))), (uint256));
        (ProtectedERC20.QueuedTransfer memory q,) = token.getQueuedTransfer(id);
        _delegate(address(new TestAccountExecutor(operator)));
        assertEq(token.reservedOf(holder), 500e18);
        assertEq(token.availableBalanceOf(holder), BALANCE - 500e18);

        vm.warp(q.executableAt - 1);
        vm.expectRevert(abi.encodeWithSelector(ProtectedERC20.HoldNotExpired.selector, id, q.executableAt));
        token.executeTransfer(id);
        vm.warp(q.executableAt);
        vm.prank(operator);
        token.executeTransfer(id);
        assertEq(token.balanceOf(recipient), 500e18);
        assertEq(token.balanceOf(holder), BALANCE - 500e18);
        assertEq(token.reservedOf(holder), 0);
        assertEq(token.dailyLimitRemaining(holder), LIMIT);
        (q,) = token.getQueuedTransfer(id);
        assertEq(uint256(q.status), uint256(ProtectedERC20.TransferStatus.Executed));
    }

    function test_BackupCanCancelAfterDelegateReplacement() public {
        _delegate(address(implementation));
        uint256 id = abi.decode(_execute(abi.encodeCall(token.queueTransfer, (recipient, 500e18))), (uint256));
        _delegate(address(new TestAccountExecutor(operator)));
        vm.prank(backup);
        token.cancelTransfer(id);
        _assertUntouched(1);
        vm.warp(block.timestamp + HOLD);
        vm.expectRevert(abi.encodeWithSelector(ProtectedERC20.TransferNotPending.selector, id));
        token.executeTransfer(id);
    }

    function test_TransferFromRevertsAtomicallyWithAllowanceUnchanged() public {
        _delegate(address(implementation));
        _execute(abi.encodeCall(token.approve, (operator, 500e18)));
        vm.expectRevert(_limitError(500e18, LIMIT));
        vm.prank(operator, operator);
        token.transferFrom(holder, recipient, 500e18);
        assertEq(token.allowance(holder, operator), 500e18);
        _assertUntouched(0);

        vm.prank(operator, operator);
        assertTrue(token.transferFrom(holder, recipient, 40e18));
        assertEq(token.balanceOf(recipient), 40e18);
        assertEq(token.allowance(holder, operator), 460e18);
        assertEq(token.dailyLimitRemaining(holder), 60e18);
    }

    function test_RevokingDelegationRestoresAutoQueueWithoutResettingSpend() public {
        _delegate(address(implementation));
        _execute(abi.encodeCall(token.transfer, (recipient, 60e18)));
        _delegate(address(0));
        assertTrue(token.isProtected(holder));
        assertEq(token.dailyLimitRemaining(holder), 40e18);

        vm.prank(holder, holder);
        assertTrue(token.transfer(recipient, 60e18));
        assertEq(token.balanceOf(recipient), 60e18); // the second payment is only reserved
        assertEq(token.balanceOf(holder), BALANCE - 60e18);
        assertEq(token.reservedOf(holder), 60e18);
        assertEq(token.availableBalanceOf(holder), BALANCE - 120e18);
        assertEq(token.dailyLimitRemaining(holder), 40e18);
        assertEq(token.queuedTransferCount(), 1);
    }
}
