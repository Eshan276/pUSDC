// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {ProtectedERC20} from "../src/ProtectedERC20.sol";
import {ProtectedWrapper} from "../src/ProtectedWrapper.sol";
import {ScheduledSwap} from "../src/ScheduledSwap.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {V4LiquidityHelper} from "./helpers/V4LiquidityHelper.sol";

/// @notice Runs against the REAL Uniswap v4 PoolManager deployed on Base Sepolia (fork).
///         RPC: BASE_SEPOLIA_RPC_URL, defaulting to the public https://sepolia.base.org.
contract ScheduledSwapTest is Test {
    IPoolManager constant PM = IPoolManager(0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408);
    uint160 constant PRICE_1_TO_1 = 79228162514264337593543950336; // sqrt(1) * 2^96

    MockERC20 usdc;
    ProtectedWrapper pusdc;
    ScheduledSwap scheduler;
    V4LiquidityHelper liq;
    PoolKey key;

    address alice = makeAddr("ss-alice");
    address bob = makeAddr("ss-backup");
    address keeper = makeAddr("ss-keeper");
    address lp = makeAddr("ss-lp");

    uint64 constant HOLD = 1 hours;
    uint256 constant AMOUNT = 50_000e6;

    function setUp() public {
        vm.createSelectFork(vm.envOr("BASE_SEPOLIA_RPC_URL", string("https://sepolia.base.org")));
        usdc = new MockERC20("USD Coin", "USDC", 6);
        pusdc = new ProtectedWrapper(
            usdc, "Protected USDC", "pUSDC", ProtectedERC20.Minimums(1 minutes, 2 minutes, 1 minutes)
        );
        scheduler = new ScheduledSwap(PM, pusdc);
        liq = new V4LiquidityHelper(PM);

        (address a, address b) =
            address(pusdc) < address(usdc) ? (address(pusdc), address(usdc)) : (address(usdc), address(pusdc));
        key = PoolKey(Currency.wrap(a), Currency.wrap(b), 500, 10, IHooks(address(0)));
        PM.initialize(key, PRICE_1_TO_1);

        // LP seeds ~1M of each, concentrated within ±1% of 1.00 (a stable pair), so big swaps barely move the price.
        usdc.mint(lp, 2_000_000e6);
        vm.startPrank(lp);
        usdc.approve(address(pusdc), type(uint256).max);
        pusdc.deposit(1_000_000e6);
        usdc.approve(address(liq), type(uint256).max);
        pusdc.approve(address(liq), type(uint256).max);
        liq.addLiquidity(key, -100, 100, 2e14);
        vm.stopPrank();

        // Alice: 100k pUSDC, protected with a 1,000/day limit and a 1-hour hold.
        usdc.mint(alice, 100_000e6);
        vm.startPrank(alice);
        usdc.approve(address(pusdc), type(uint256).max);
        pusdc.deposit(100_000e6);
        pusdc.protect(bob, 1_000e6, HOLD, 1 days, 1 days, true);
        vm.stopPrank();
    }

    function _schedule(uint256 amount, uint128 minOut) internal returns (uint256 id) {
        vm.startPrank(alice);
        id = pusdc.queueTransfer(address(scheduler), amount);
        scheduler.register(id, key, minOut);
        vm.stopPrank();
    }

    function test_HappyPath_OutputGoesToOwner() public {
        uint256 id = _schedule(AMOUNT, 49_000e6);
        vm.warp(block.timestamp + HOLD);
        vm.prank(keeper); // anyone can trigger it
        uint256 out = scheduler.execute(id);

        assertGt(out, 49_900e6); // 0.05% fee + small price impact on a 1M pool
        assertEq(usdc.balanceOf(alice), out);
        assertEq(usdc.balanceOf(keeper), 0);
        assertEq(pusdc.balanceOf(alice), 100_000e6 - AMOUNT);
        assertEq(pusdc.balanceOf(address(scheduler)), 0);
        assertEq(pusdc.reservedOf(alice), 0);
    }

    function test_BigSwapImpossibleWithoutScheduler() public {
        // The ordinary path still refuses: a direct over-limit pull reverts (this is what any router does).
        vm.prank(alice);
        pusdc.approve(keeper, type(uint256).max);
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(ProtectedERC20.ExceedsDailyLimit.selector, alice, AMOUNT, 1_000e6));
        pusdc.transferFrom(alice, keeper, AMOUNT);
    }

    function test_BackupCancelStopsSwap() public {
        uint256 id = _schedule(AMOUNT, 49_000e6);
        vm.prank(bob);
        pusdc.cancelTransfer(id);
        vm.warp(block.timestamp + HOLD);
        vm.expectRevert(abi.encodeWithSelector(ScheduledSwap.TransferWasCancelled.selector, id));
        scheduler.execute(id);
        assertEq(pusdc.balanceOf(alice), 100_000e6);
    }

    function test_StressCancelsScheduledSwap() public {
        uint256 id = _schedule(AMOUNT, 49_000e6);
        vm.prank(bob);
        pusdc.stress(alice);
        vm.warp(block.timestamp + HOLD);
        vm.expectRevert(abi.encodeWithSelector(ScheduledSwap.TransferWasCancelled.selector, id));
        scheduler.execute(id);
    }

    function test_CannotExecuteDuringHold() public {
        uint256 id = _schedule(AMOUNT, 49_000e6);
        vm.warp(block.timestamp + HOLD - 1);
        vm.expectRevert(); // ProtectedERC20.HoldNotExpired bubbles up
        scheduler.execute(id);
    }

    function test_MinOutProtectsAgainstBadPrice() public {
        uint256 id = _schedule(AMOUNT, 50_000e6); // impossible after fees
        vm.warp(block.timestamp + HOLD);
        vm.expectRevert();
        scheduler.execute(id);
        // Nothing moved; the transfer is still pending and can be cancelled or refunded later.
        (, bool pending) = pusdc.getQueuedTransfer(id);
        assertTrue(pending);
    }

    function test_OnlyOwnerCanRegister_AndOnlyOnce() public {
        vm.prank(alice);
        uint256 id = pusdc.queueTransfer(address(scheduler), AMOUNT);
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(ScheduledSwap.NotYourTransfer.selector, id));
        scheduler.register(id, key, 1);
        vm.prank(alice);
        scheduler.register(id, key, 1);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ScheduledSwap.AlreadyRegistered.selector, id));
        scheduler.register(id, key, 49_000e6);
    }

    function test_RejectsHookedPool_WrongPool_ZeroMinOut() public {
        vm.prank(alice);
        uint256 id = pusdc.queueTransfer(address(scheduler), AMOUNT);
        PoolKey memory hooked = key;
        hooked.hooks = IHooks(address(0xBEEF));
        vm.startPrank(alice);
        vm.expectRevert(ScheduledSwap.HookedPoolNotAllowed.selector);
        scheduler.register(id, hooked, 1);
        PoolKey memory other = key;
        other.currency0 = Currency.wrap(address(0x1));
        other.currency1 = Currency.wrap(address(0x2));
        vm.expectRevert(ScheduledSwap.PoolMustTradeToken.selector);
        scheduler.register(id, other, 1);
        vm.expectRevert(ScheduledSwap.MinOutRequired.selector);
        scheduler.register(id, key, 0);
        vm.stopPrank();
    }

    function test_RegisterRequiresTransferToScheduler() public {
        vm.prank(alice);
        uint256 id = pusdc.queueTransfer(keeper, AMOUNT);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ScheduledSwap.NotYourTransfer.selector, id));
        scheduler.register(id, key, 1);
    }

    function test_StillSwapsIfSomeoneExecutedTheTransferDirectly() public {
        uint256 id = _schedule(AMOUNT, 49_000e6);
        vm.warp(block.timestamp + HOLD);
        pusdc.executeTransfer(id); // griefer delivers the tokens without swapping
        assertEq(pusdc.balanceOf(address(scheduler)), AMOUNT);
        uint256 out = scheduler.execute(id);
        assertEq(usdc.balanceOf(alice), out);
        assertEq(pusdc.balanceOf(address(scheduler)), 0);
    }

    function test_FastLaneApprovalThenExecute() public {
        uint256 id = _schedule(AMOUNT, 49_000e6);
        vm.prank(bob); // backup approves: skips the hold
        pusdc.approveTransfer(id);
        uint256 out = scheduler.execute(id);
        assertGt(out, 49_900e6);
        assertEq(usdc.balanceOf(alice), out);
    }

    function test_RefundUnregisteredDelivery() public {
        vm.prank(alice);
        uint256 id = pusdc.queueTransfer(address(scheduler), AMOUNT);
        vm.warp(block.timestamp + HOLD);
        pusdc.executeTransfer(id); // delivered, but never registered
        vm.prank(keeper); // anyone can send it back to the owner
        scheduler.refund(id);
        assertEq(pusdc.balanceOf(alice), 100_000e6);
        vm.expectRevert(abi.encodeWithSelector(ScheduledSwap.AlreadySettled.selector, id));
        scheduler.refund(id);
    }

    function test_OwnerCanAbandonDeliveredOrder_NoDoubleSpend() public {
        uint256 id = _schedule(AMOUNT, 50_000e6); // minOut too high, so it can never run
        vm.warp(block.timestamp + HOLD);
        pusdc.executeTransfer(id);
        vm.prank(keeper);
        vm.expectRevert(ScheduledSwap.OnlyOwner.selector);
        scheduler.refund(id);
        vm.prank(alice);
        scheduler.refund(id);
        assertEq(pusdc.balanceOf(alice), 100_000e6);
        vm.expectRevert(abi.encodeWithSelector(ScheduledSwap.NotRegistered.selector, id));
        scheduler.execute(id);
    }

    function test_ThiefSchedulingSwapStillPaysOwner() public {
        // A thief with alice's key schedules the swap and triggers it: the output still lands in alice's wallet.
        uint256 id = _schedule(AMOUNT, 49_000e6);
        address thief = makeAddr("ss-thief");
        vm.warp(block.timestamp + HOLD);
        vm.prank(thief);
        scheduler.execute(id);
        assertEq(usdc.balanceOf(thief), 0);
        assertGt(usdc.balanceOf(alice), 49_000e6);
    }
}
