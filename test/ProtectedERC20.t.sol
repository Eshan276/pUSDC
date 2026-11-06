// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {ProtectedERC20} from "../src/ProtectedERC20.sol";
import {TestProtectedToken} from "./mocks/TestProtectedToken.sol";

contract ProtectedERC20Test is Test {
    TestProtectedToken token;

    address alice; // protected holder
    uint256 aliceKey;
    address bob = makeAddr("bob"); // alice's backup wallet
    address carol = makeAddr("carol"); // ordinary recipient / spender
    address mallory = makeAddr("mallory"); // attacker / stranger

    uint256 constant LIMIT = 100e18;
    uint64 constant HOLD = 3 days;
    uint64 constant OFF = 7 days;
    uint64 constant LOCK = 14 days;
    uint256 constant START = 1_700_000_000;

    function setUp() public {
        vm.warp(START);
        (alice, aliceKey) = makeAddrAndKey("alice");
        token = new TestProtectedToken();
        token.mint(alice, 1_000e18);
    }

    // ───────────── helpers ─────────────

    function _protect() internal {
        vm.prank(alice);
        token.protect(bob, LIMIT, HOLD, OFF, LOCK);
    }

    function _queue(uint256 amount) internal returns (uint256 id) {
        vm.prank(alice);
        id = token.queueTransfer(mallory, amount);
    }

    function _errLimit(uint256 amount, uint256 remaining) internal view returns (bytes memory) {
        return abi.encodeWithSelector(ProtectedERC20.ExceedsDailyLimit.selector, alice, amount, remaining);
    }

    function _errLocked(address who, uint256 amount, uint256 available) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(ProtectedERC20.InsufficientUnlockedBalance.selector, who, amount, available);
    }

    // ═════════════ rule 7: unflagged = plain ERC-20 ═════════════

    function test_Unflagged_BehavesLikeERC20() public {
        assertFalse(token.isProtected(alice));
        assertEq(token.dailyLimitRemaining(alice), type(uint256).max);

        vm.prank(alice);
        token.transfer(carol, 900e18);
        assertEq(token.balanceOf(carol), 900e18);

        vm.prank(alice);
        token.approve(carol, 100e18);
        vm.prank(carol);
        token.transferFrom(alice, carol, 100e18);
        assertEq(token.balanceOf(alice), 0);
    }

    function test_Unflagged_OverBalanceRevertsWithStandardError() public {
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, alice, 1_000e18, 1_001e18)
        );
        token.transfer(carol, 1_001e18);
    }

    // ═════════════ rule 1: flag on is instant ═════════════

    function test_Protect_IsInstant() public {
        vm.expectEmit(address(token));
        emit ProtectedERC20.FlagOn(alice, bob, LIMIT, HOLD, OFF, LOCK);
        _protect();

        assertTrue(token.isProtected(alice));
        ProtectedERC20.ProtectionView memory v = token.protectionOf(alice);
        assertEq(v.backup, bob);
        assertEq(v.dailyLimit, LIMIT);
        assertEq(v.holdWindow, HOLD);
        assertEq(v.offDelay, OFF);
        assertEq(v.lockDuration, LOCK);
        assertEq(v.flagOffAt, 0);
    }

    function test_Protect_RevertsOnBadBackup() public {
        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(ProtectedERC20.InvalidBackup.selector, address(0)));
        token.protect(address(0), LIMIT, HOLD, OFF, LOCK);
        vm.expectRevert(abi.encodeWithSelector(ProtectedERC20.InvalidBackup.selector, alice));
        token.protect(alice, LIMIT, HOLD, OFF, LOCK);
        vm.expectRevert(abi.encodeWithSelector(ProtectedERC20.InvalidBackup.selector, address(token)));
        token.protect(address(token), LIMIT, HOLD, OFF, LOCK);
        vm.stopPrank();
    }

    function test_Protect_RevertsOnOutOfBoundsParams() public {
        vm.startPrank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(ProtectedERC20.InvalidParam.selector, ProtectedERC20.Param.HoldWindow, 1 hours)
        );
        token.protect(bob, LIMIT, 1 hours, OFF, LOCK);
        vm.expectRevert(
            abi.encodeWithSelector(ProtectedERC20.InvalidParam.selector, ProtectedERC20.Param.OffDelay, 6 days)
        );
        token.protect(bob, LIMIT, HOLD, 6 days, LOCK);
        vm.expectRevert(
            abi.encodeWithSelector(ProtectedERC20.InvalidParam.selector, ProtectedERC20.Param.LockDuration, 366 days)
        );
        token.protect(bob, LIMIT, HOLD, OFF, 366 days);
        vm.stopPrank();
    }

    function test_Protect_RevertsIfAlreadyProtected() public {
        _protect();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ProtectedERC20.AlreadyProtected.selector, alice));
        token.protect(carol, LIMIT, HOLD, OFF, LOCK);
    }

    // ═════════════ rule 1: flag off is delayed ═════════════

    function test_FlagOff_TakesFullDelay() public {
        _protect();
        vm.expectEmit(address(token));
        emit ProtectedERC20.FlagOffRequested(alice, uint64(START + OFF));
        vm.prank(alice);
        token.requestFlagOff();
        assertEq(token.flagOffTime(alice), START + OFF);

        // One second before the delay ends: still fully protected.
        vm.warp(START + OFF - 1);
        assertTrue(token.isProtected(alice));
        vm.prank(alice);
        vm.expectRevert(_errLimit(500e18, LIMIT));
        token.transfer(carol, 500e18);

        // Delay over: views flip immediately and a large transfer goes through (FlagOff emitted lazily).
        vm.warp(START + OFF);
        assertFalse(token.isProtected(alice));
        assertEq(token.dailyLimitRemaining(alice), type(uint256).max);
        vm.expectEmit(address(token));
        emit ProtectedERC20.FlagOff(alice);
        vm.prank(alice);
        token.transfer(carol, 500e18);
        assertEq(token.balanceOf(carol), 500e18);
    }

    function test_FlagOff_CanBeCancelledInstantly() public {
        _protect();
        vm.startPrank(alice);
        token.requestFlagOff();
        token.cancelFlagOff();
        vm.stopPrank();
        vm.warp(START + OFF + 1);
        assertTrue(token.isProtected(alice));
        assertEq(token.flagOffTime(alice), 0);
    }

    function test_FlagOff_SyncCallableByAnyone() public {
        _protect();
        vm.prank(alice);
        token.requestFlagOff();
        vm.warp(START + OFF);
        vm.expectEmit(address(token));
        emit ProtectedERC20.FlagOff(alice);
        vm.prank(mallory);
        token.sync(alice);
    }

    function test_FlagOff_ThenReprotectWithNewConfigIsInstant() public {
        _protect();
        vm.prank(alice);
        token.requestFlagOff();
        vm.warp(START + OFF);
        vm.prank(alice);
        token.protect(carol, 1e18, HOLD, OFF, LOCK);
        assertTrue(token.isProtected(alice));
        assertEq(token.protectionOf(alice).backup, carol);
    }

    function test_BackupCannotCancelFlagOff() public {
        _protect();
        vm.prank(alice);
        token.requestFlagOff();
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(ProtectedERC20.NotProtected.selector, bob));
        token.cancelFlagOff(); // acts on bob's own (unprotected) account, never alice's
    }

    // ═════════════ rule 1: protection-decreasing changes are delayed ═════════════

    function test_Params_IncreasesAreInstant() public {
        _protect();
        vm.startPrank(alice);
        token.setParam(ProtectedERC20.Param.DailyLimit, 10e18);
        token.setParam(ProtectedERC20.Param.HoldWindow, 5 days);
        token.setParam(ProtectedERC20.Param.OffDelay, 30 days);
        token.setParam(ProtectedERC20.Param.LockDuration, 60 days);
        vm.stopPrank();

        ProtectedERC20.ProtectionView memory v = token.protectionOf(alice);
        assertEq(v.dailyLimit, 10e18);
        assertEq(v.holdWindow, 5 days);
        assertEq(v.offDelay, 30 days);
        assertEq(v.lockDuration, 60 days);
    }

    function test_Params_DecreasesAreDelayed() public {
        _protect();
        vm.startPrank(alice);
        token.setParam(ProtectedERC20.Param.DailyLimit, 1_000e18); // raise = weaker
        token.setParam(ProtectedERC20.Param.HoldWindow, 1 days); // shorter = weaker
        token.setParam(ProtectedERC20.Param.LockDuration, 1 days); // shorter = weaker
        vm.stopPrank();

        (uint256 val, uint64 at) = token.pendingParamChange(alice, ProtectedERC20.Param.DailyLimit);
        assertEq(val, 1_000e18);
        assertEq(at, START + OFF);

        vm.warp(START + OFF - 1);
        ProtectedERC20.ProtectionView memory v = token.protectionOf(alice);
        assertEq(v.dailyLimit, LIMIT);
        assertEq(v.holdWindow, HOLD);
        assertEq(v.lockDuration, LOCK);
        vm.prank(alice);
        vm.expectRevert(_errLimit(500e18, LIMIT));
        token.transfer(carol, 500e18);

        vm.warp(START + OFF);
        v = token.protectionOf(alice);
        assertEq(v.dailyLimit, 1_000e18);
        assertEq(v.holdWindow, 1 days);
        assertEq(v.lockDuration, 1 days);
        vm.prank(alice);
        token.transfer(carol, 500e18);
    }

    function test_Params_ShorteningOffDelayWaitsForOldDelay() public {
        _protect();
        vm.startPrank(alice);
        token.setParam(ProtectedERC20.Param.OffDelay, 30 days); // instant
        token.setParam(ProtectedERC20.Param.OffDelay, 7 days); // waits 30 days
        vm.stopPrank();
        (, uint64 at) = token.pendingParamChange(alice, ProtectedERC20.Param.OffDelay);
        assertEq(at, START + 30 days);

        vm.warp(START + 29 days);
        assertEq(token.protectionOf(alice).offDelay, 30 days);
        vm.warp(START + 30 days);
        assertEq(token.protectionOf(alice).offDelay, 7 days);
    }

    function test_Params_InstantIncreaseClearsPendingDecrease() public {
        _protect();
        vm.startPrank(alice);
        token.setParam(ProtectedERC20.Param.DailyLimit, 1_000e18); // pending
        token.setParam(ProtectedERC20.Param.DailyLimit, 50e18); // instant, clears pending
        vm.stopPrank();
        vm.warp(START + OFF + 1);
        assertEq(token.protectionOf(alice).dailyLimit, 50e18);
    }

    function test_Params_CancelPendingDecrease() public {
        _protect();
        vm.startPrank(alice);
        token.setParam(ProtectedERC20.Param.HoldWindow, 1 days);
        token.cancelParamChange(ProtectedERC20.Param.HoldWindow);
        vm.expectRevert(ProtectedERC20.NothingPending.selector);
        token.cancelParamChange(ProtectedERC20.Param.HoldWindow);
        vm.stopPrank();
        vm.warp(START + OFF + 1);
        assertEq(token.protectionOf(alice).holdWindow, HOLD);
    }

    function test_Params_RequireProtection() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ProtectedERC20.NotProtected.selector, alice));
        token.setParam(ProtectedERC20.Param.DailyLimit, 1);
    }

    function test_BackupChange_IsDelayed() public {
        _protect();
        vm.prank(alice);
        token.requestBackupChange(carol);
        (address nb, uint64 at) = token.pendingBackupChange(alice);
        assertEq(nb, carol);
        assertEq(at, START + OFF);

        // During the delay the OLD backup keeps its powers, the new one has none.
        uint256 id = _queue(500e18);
        vm.prank(carol);
        vm.expectRevert(abi.encodeWithSelector(ProtectedERC20.Unauthorized.selector, carol));
        token.cancelTransfer(id);
        vm.prank(bob);
        token.cancelTransfer(id);

        vm.warp(START + OFF);
        assertEq(token.protectionOf(alice).backup, carol);
        id = _queue(500e18);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(ProtectedERC20.Unauthorized.selector, bob));
        token.cancelTransfer(id);
        vm.prank(carol);
        token.cancelTransfer(id);
    }

    function test_BackupChange_Cancel() public {
        _protect();
        vm.startPrank(alice);
        token.requestBackupChange(carol);
        token.cancelBackupChange();
        vm.stopPrank();
        vm.warp(START + OFF + 1);
        assertEq(token.protectionOf(alice).backup, bob);
    }

    // ═════════════ rules 2 + 5: daily limit ═════════════

    function test_DailyLimit_SmallTransferPasses() public {
        _protect();
        vm.prank(alice);
        token.transfer(carol, LIMIT);
        assertEq(token.balanceOf(carol), LIMIT);
        assertEq(token.dailyLimitRemaining(alice), 0);
    }

    function test_DailyLimit_LargePlainTransferReverts() public {
        _protect();
        vm.prank(alice);
        vm.expectRevert(_errLimit(LIMIT + 1, LIMIT));
        token.transfer(carol, LIMIT + 1);
        assertEq(token.balanceOf(alice), 1_000e18); // never silently held
    }

    function test_DailyLimit_AccumulatesAndResetsAfter24h() public {
        _protect();
        vm.startPrank(alice);
        token.transfer(carol, 60e18);
        vm.warp(START + 12 hours);
        token.transfer(carol, 40e18);
        vm.expectRevert(_errLimit(1, 0));
        token.transfer(carol, 1);

        vm.warp(START + 1 days - 1); // window opened at START, still open
        vm.expectRevert(_errLimit(1, 0));
        token.transfer(carol, 1);
        assertEq(token.dailyLimitRemaining(alice), 0);

        vm.warp(START + 1 days); // window over
        assertEq(token.dailyLimitRemaining(alice), LIMIT);
        token.transfer(carol, LIMIT);
        vm.stopPrank();
    }

    function test_DailyLimit_LoweringMidWindowAppliesInstantly() public {
        _protect();
        vm.startPrank(alice);
        token.transfer(carol, 30e18);
        token.setParam(ProtectedERC20.Param.DailyLimit, 40e18);
        assertEq(token.dailyLimitRemaining(alice), 10e18);
        vm.expectRevert(_errLimit(11e18, 10e18));
        token.transfer(carol, 11e18);
        vm.stopPrank();
    }

    function test_DailyLimit_BurnCounts() public {
        _protect();
        vm.prank(alice);
        vm.expectRevert(_errLimit(LIMIT + 1, LIMIT));
        token.burn(LIMIT + 1);
    }

    function testFuzz_DailyLimit(uint256 amount) public {
        amount = bound(amount, 0, 1_000e18);
        _protect();
        vm.prank(alice);
        if (amount > LIMIT) vm.expectRevert(_errLimit(amount, LIMIT));
        token.transfer(carol, amount);
    }

    // ═════════════ rule 8: transferFrom + permit go through the same checks ═════════════

    function test_TransferFrom_CountsAsOutgoingFromOwner() public {
        _protect();
        vm.prank(alice);
        token.approve(carol, type(uint256).max); // approving is not restricted

        vm.startPrank(carol);
        vm.expectRevert(_errLimit(500e18, LIMIT));
        token.transferFrom(alice, carol, 500e18);
        token.transferFrom(alice, carol, 70e18);
        vm.expectRevert(_errLimit(31e18, 30e18));
        token.transferFrom(alice, carol, 31e18);
        vm.stopPrank();
        assertEq(token.dailyLimitRemaining(alice), 30e18);
    }

    function test_Permit_SpendGoesThroughChecks() public {
        _protect();
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
                alice,
                carol,
                type(uint256).max,
                token.nonces(alice),
                deadline
            )
        );
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(aliceKey, keccak256(abi.encodePacked("\x19\x01", token.DOMAIN_SEPARATOR(), structHash)));
        token.permit(alice, carol, type(uint256).max, deadline, v, r, s);
        assertEq(token.allowance(alice, carol), type(uint256).max);

        vm.startPrank(carol);
        vm.expectRevert(_errLimit(1_000e18, LIMIT));
        token.transferFrom(alice, carol, 1_000e18);
        token.transferFrom(alice, carol, LIMIT);
        vm.stopPrank();
    }

    function test_TransferFrom_CannotSpendReserved() public {
        _protect();
        _queue(950e18);
        vm.prank(alice);
        token.approve(carol, type(uint256).max);
        vm.prank(carol);
        vm.expectRevert(_errLocked(alice, 60e18, 50e18));
        token.transferFrom(alice, carol, 60e18);
    }

    // ═════════════ rule 6: incoming always instant ═════════════

    function test_Incoming_AlwaysInstant() public {
        _protect();
        token.mint(carol, 10_000e18);
        vm.prank(carol);
        token.transfer(alice, 10_000e18);
        assertEq(token.balanceOf(alice), 11_000e18);
        assertEq(token.availableBalanceOf(alice), 11_000e18);
        assertEq(token.dailyLimitRemaining(alice), LIMIT); // incoming does not touch the limit
    }

    function test_Incoming_ToLockedAccountIsSpendable() public {
        _protect();
        vm.prank(alice);
        token.stress(alice);
        token.mint(carol, 5e18);
        vm.prank(carol);
        token.transfer(bob, 5e18);
        vm.prank(bob);
        token.transfer(carol, 5e18); // only the stressed amount is locked
        vm.prank(bob);
        vm.expectRevert(_errLocked(bob, 1, 0));
        token.transfer(carol, 1);
    }

    // ═════════════ rules 2 + 3: queue / cancel / execute ═════════════

    function test_Queue_ReservesButKeepsBalance() public {
        _protect();
        uint64 execAt = uint64(START + HOLD);
        vm.expectEmit(address(token));
        emit ProtectedERC20.TransferQueued(1, alice, mallory, 900e18, execAt);
        uint256 id = _queue(900e18);
        assertEq(id, 1);

        assertEq(token.balanceOf(alice), 1_000e18);
        assertEq(token.reservedOf(alice), 900e18);
        assertEq(token.availableBalanceOf(alice), 100e18);
        uint256[] memory ids = token.pendingTransferIds(alice);
        assertEq(ids.length, 1);
        assertEq(ids[0], 1);

        // Reserved tokens cannot leave through a plain transfer, even within the daily limit.
        vm.prank(alice);
        vm.expectRevert(_errLocked(alice, 100e18 + 1, 100e18));
        token.transfer(carol, 100e18 + 1);
    }

    function test_Queue_Validation() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ProtectedERC20.NotProtected.selector, alice));
        token.queueTransfer(carol, 1);

        _protect();
        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(ProtectedERC20.InvalidRecipient.selector, address(0)));
        token.queueTransfer(address(0), 1);
        vm.expectRevert(abi.encodeWithSelector(ProtectedERC20.InvalidRecipient.selector, alice));
        token.queueTransfer(alice, 1);
        vm.expectRevert(ProtectedERC20.ZeroAmount.selector);
        token.queueTransfer(carol, 0);
        token.queueTransfer(carol, 600e18);
        vm.expectRevert(_errLocked(alice, 500e18, 400e18));
        token.queueTransfer(carol, 500e18); // cannot double-reserve
        vm.stopPrank();
    }

    function test_Execute_OnlyAfterHold_ByAnyone_NoLimitUsed() public {
        _protect();
        uint256 id = _queue(900e18);

        vm.warp(START + HOLD - 1);
        vm.expectRevert(abi.encodeWithSelector(ProtectedERC20.HoldNotExpired.selector, id, uint64(START + HOLD)));
        token.executeTransfer(id);

        vm.warp(START + HOLD);
        vm.expectEmit(address(token));
        emit ProtectedERC20.TransferExecuted(id, carol);
        vm.prank(carol);
        token.executeTransfer(id);

        assertEq(token.balanceOf(mallory), 900e18);
        assertEq(token.reservedOf(alice), 0);
        assertEq(token.dailyLimitRemaining(alice), LIMIT);

        vm.expectRevert(abi.encodeWithSelector(ProtectedERC20.TransferNotPending.selector, id));
        token.executeTransfer(id);
    }

    function test_Cancel_ByBackup() public {
        _protect();
        uint256 id = _queue(900e18);
        vm.warp(START + HOLD - 1);
        vm.expectEmit(address(token));
        emit ProtectedERC20.TransferCancelled(id, bob);
        vm.prank(bob);
        token.cancelTransfer(id);

        assertEq(token.reservedOf(alice), 0);
        assertEq(token.availableBalanceOf(alice), 1_000e18);
        assertEq(token.pendingTransferIds(alice).length, 0);

        vm.warp(START + HOLD);
        vm.expectRevert(abi.encodeWithSelector(ProtectedERC20.TransferNotPending.selector, id));
        token.executeTransfer(id);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(ProtectedERC20.TransferNotPending.selector, id));
        token.cancelTransfer(id);
    }

    function test_Cancel_ByOwnerOk_ByStrangerReverts() public {
        _protect();
        uint256 id = _queue(900e18);
        vm.prank(mallory);
        vm.expectRevert(abi.encodeWithSelector(ProtectedERC20.Unauthorized.selector, mallory));
        token.cancelTransfer(id);
        vm.prank(alice);
        token.cancelTransfer(id);
    }

    function test_Cancel_StillPossibleAfterHoldUntilExecuted() public {
        _protect();
        uint256 id = _queue(900e18);
        vm.warp(START + HOLD + 1 days);
        vm.prank(bob);
        token.cancelTransfer(id);
        assertEq(token.balanceOf(alice), 1_000e18);
    }

    function test_Queue_UsesHoldWindowAtQueueTime() public {
        _protect();
        uint256 id = _queue(500e18);
        vm.prank(alice);
        token.setParam(ProtectedERC20.Param.HoldWindow, 10 days); // later change doesn't move existing ids
        (ProtectedERC20.QueuedTransfer memory q, bool pending) = token.getQueuedTransfer(id);
        assertTrue(pending);
        assertEq(q.executableAt, START + HOLD);
    }

    function test_Execute_StillWorksAfterFlagOff() public {
        _protect();
        uint256 id = _queue(500e18);
        vm.prank(alice);
        token.requestFlagOff();
        vm.warp(START + OFF);
        token.sync(alice);
        assertFalse(token.isProtected(alice));
        assertEq(token.availableBalanceOf(alice), 500e18); // still reserved while unprotected
        token.executeTransfer(id);
        assertEq(token.balanceOf(mallory), 500e18);
    }

    // ═════════════ rule 4: stress ═════════════

    function test_Stress_MovesBalanceAndPending() public {
        _protect();
        uint256 id1 = _queue(400e18);
        uint256 id2 = _queue(300e18);
        vm.prank(alice);
        token.requestFlagOff();
        vm.prank(alice);
        token.setParam(ProtectedERC20.Param.DailyLimit, 1_000e18);
        vm.prank(alice);
        token.requestBackupChange(mallory);

        vm.expectEmit(address(token));
        emit ProtectedERC20.StressTriggered(alice, bob, bob, 1_000e18, uint64(START + LOCK));
        vm.prank(bob);
        token.stress(alice);

        assertEq(token.balanceOf(alice), 0);
        assertEq(token.balanceOf(bob), 1_000e18);
        assertEq(token.reservedOf(alice), 0);
        assertEq(token.pendingTransferIds(alice).length, 0);
        (uint256 locked, uint64 until) = token.lockOf(bob);
        assertEq(locked, 1_000e18);
        assertEq(until, START + LOCK);

        // All pending decreases were cancelled and the account stays protected.
        vm.warp(START + OFF + HOLD);
        assertTrue(token.isProtected(alice));
        ProtectedERC20.ProtectionView memory v = token.protectionOf(alice);
        assertEq(v.backup, bob);
        assertEq(v.dailyLimit, LIMIT);
        vm.expectRevert(abi.encodeWithSelector(ProtectedERC20.TransferNotPending.selector, id1));
        token.executeTransfer(id1);
        vm.expectRevert(abi.encodeWithSelector(ProtectedERC20.TransferNotPending.selector, id2));
        token.executeTransfer(id2);
    }

    function test_Stress_ByOwnerOk_ByStrangerReverts() public {
        _protect();
        vm.prank(mallory);
        vm.expectRevert(abi.encodeWithSelector(ProtectedERC20.Unauthorized.selector, mallory));
        token.stress(alice);
        vm.prank(alice);
        token.stress(alice);
        assertEq(token.balanceOf(bob), 1_000e18);
    }

    function test_Stress_RequiresProtection() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ProtectedERC20.NotProtected.selector, alice));
        token.stress(alice);
    }

    function test_Stress_IgnoresDailyLimit() public {
        vm.prank(alice);
        token.protect(bob, 0, HOLD, OFF, LOCK); // zero daily limit
        vm.prank(alice);
        token.stress(alice);
        assertEq(token.balanceOf(bob), 1_000e18);
    }

    function test_Stress_ManyQueuedTransfersStillCheap() public {
        _protect();
        for (uint256 i; i < 200; ++i) {
            _queue(1e18);
        }
        uint256 g = gasleft();
        vm.prank(bob);
        token.stress(alice);
        assertLt(g - gasleft(), 200_000); // O(1): no loop over queued transfers
        assertEq(token.balanceOf(bob), 1_000e18);
    }

    // ═════════════ rule 4: lock enforcement ═════════════

    function test_Lock_BlocksEveryPath() public {
        _protect();
        vm.prank(bob);
        token.stress(alice);

        vm.startPrank(bob);
        vm.expectRevert(_errLocked(bob, 1, 0));
        token.transfer(carol, 1);
        token.approve(carol, type(uint256).max);
        vm.stopPrank();

        vm.prank(carol);
        vm.expectRevert(_errLocked(bob, 1, 0));
        token.transferFrom(bob, carol, 1);

        // Bob protecting himself and queueing doesn't help either.
        vm.startPrank(bob);
        token.protect(carol, LIMIT, HOLD, OFF, LOCK);
        vm.expectRevert(_errLocked(bob, 1, 0));
        token.queueTransfer(carol, 1);
        token.stress(bob); // moves nothing: locked funds stay put
        vm.stopPrank();
        assertEq(token.balanceOf(bob), 1_000e18);
        assertEq(token.balanceOf(carol), 0);

        vm.prank(bob);
        vm.expectRevert(_errLocked(bob, 1, 0));
        token.burn(1);
    }

    function test_Lock_ExpiresAtTimestamp() public {
        _protect();
        vm.prank(bob);
        token.stress(alice);

        vm.warp(START + LOCK - 1);
        vm.prank(bob);
        vm.expectRevert(_errLocked(bob, 1_000e18, 0));
        token.transfer(carol, 1_000e18);

        vm.warp(START + LOCK);
        (uint256 locked,) = token.lockOf(bob);
        assertEq(locked, 0);
        vm.prank(bob);
        token.transfer(carol, 1_000e18);
        assertEq(token.balanceOf(carol), 1_000e18);
    }

    function test_Lock_RepeatStressDoesNotExtend() public {
        _protect();
        vm.prank(alice);
        token.stress(alice);

        // Attacker with alice's key tries to keep bob frozen by re-stressing dust.
        vm.warp(START + LOCK - 1 hours);
        token.mint(alice, 1);
        vm.prank(alice);
        token.stress(alice);
        (uint256 locked, uint64 until) = token.lockOf(bob);
        assertEq(locked, 1_000e18 + 1);
        assertEq(until, START + LOCK);

        vm.warp(START + LOCK);
        vm.prank(bob);
        token.transfer(carol, 1_000e18 + 1);
    }

    function test_Lock_NewStressAfterExpiryStartsFreshLock() public {
        _protect();
        vm.prank(alice);
        token.stress(alice);
        vm.warp(START + LOCK + 1);

        token.mint(alice, 50e18);
        vm.prank(alice);
        token.stress(alice);
        (uint256 locked, uint64 until) = token.lockOf(bob);
        assertEq(locked, 50e18); // old 1000 are free
        assertEq(until, START + LOCK + 1 + LOCK);
        vm.prank(bob);
        token.transfer(carol, 1_000e18);
    }
}
