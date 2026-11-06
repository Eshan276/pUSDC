// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {ProtectedERC20} from "../src/ProtectedERC20.sol";
import {ProtectedWrapper} from "../src/ProtectedWrapper.sol";
import {IUniswapV2Factory, IUniswapV2Router02} from "./interfaces/IUniswapV2.sol";

/// @notice The whole demo story on a mainnet fork, with real USDC and the real, unmodified Uniswap V2.
///         Run with: MAINNET_RPC_URL=<rpc> forge test --match-contract DemoScenario -vv
contract DemoScenarioTest is Test {
    IERC20 constant USDC = IERC20(0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48);
    IUniswapV2Router02 constant ROUTER = IUniswapV2Router02(0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D);
    IUniswapV2Factory constant FACTORY = IUniswapV2Factory(0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f);
    /// @dev One of the largest USDC holders on mainnet (~3.3B USDC in Nov 2026). `deal` does not work on USDC.
    address constant WHALE = 0x37305B1cD40574E4C5Ce33f8e8306Be057fD7341;

    uint256 constant POOL_SIDE = 1_000_000e6;
    uint256 constant ALICE_FUNDS = 100_000e6;
    uint256 constant DAILY_LIMIT = 1_000e6;
    uint64 constant HOLD = 72 hours;
    uint64 constant OFF_DELAY = 7 days;
    uint64 constant LOCK = 14 days;

    ProtectedWrapper pusdc;
    address alice = makeAddr("alice"); // the user
    address backup = makeAddr("alice-backup"); // alice's backup wallet (e.g. a hardware wallet at home)
    address attacker = makeAddr("attacker"); // holds a copy of alice's key / is holding the wrench

    bool forked;

    function setUp() public {
        string memory rpc = vm.envOr("MAINNET_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        forked = true;
        pusdc = new ProtectedWrapper(IERC20Metadata(address(USDC)), "Protected USDC", "pUSDC");
        vm.label(address(USDC), "USDC");
        vm.label(address(ROUTER), "UniswapV2Router02");
        vm.label(address(pusdc), "pUSDC");
    }

    function test_DemoScenario() public {
        if (!forked) {
            console2.log("MAINNET_RPC_URL not set: skipping the mainnet-fork demo");
            vm.skip(true);
        }

        // ── a. Whale wraps USDC, seeds a pUSDC/USDC Uniswap V2 pool and funds alice ──
        uint256 needed = 2 * POOL_SIDE + ALICE_FUNDS;
        require(USDC.balanceOf(WHALE) >= needed, "whale is short of USDC: pick another holder");

        vm.startPrank(WHALE);
        USDC.approve(address(pusdc), type(uint256).max);
        pusdc.deposit(POOL_SIDE);
        USDC.approve(address(ROUTER), type(uint256).max);
        pusdc.approve(address(ROUTER), type(uint256).max);
        ROUTER.addLiquidity(address(pusdc), address(USDC), POOL_SIDE, POOL_SIDE, 0, 0, WHALE, vm.getBlockTimestamp());
        USDC.transfer(alice, ALICE_FUNDS);
        vm.stopPrank();
        assertTrue(FACTORY.getPair(address(pusdc), address(USDC)) != address(0), "pool created");

        vm.startPrank(alice);
        USDC.approve(address(pusdc), type(uint256).max);
        pusdc.deposit(ALICE_FUNDS);
        pusdc.approve(address(ROUTER), type(uint256).max);
        USDC.approve(address(ROUTER), type(uint256).max);
        vm.stopPrank();
        assertEq(pusdc.balanceOf(alice), ALICE_FUNDS);
        console2.log("a. pool seeded, alice wrapped 100k USDC into pUSDC");

        // ── b. Flag off: pUSDC is a plain ERC-20, a large swap on Uniswap works instantly ──
        uint256 out = _swap(alice, address(pusdc), address(USDC), 20_000e6);
        assertGt(out, 19_000e6);
        console2.log("b. unprotected: swapped 20,000 pUSDC -> USDC:", out);

        // ── c. Turn the flag on (instant). Small swaps still work, large ones revert ──
        vm.prank(alice);
        pusdc.protect(backup, DAILY_LIMIT, HOLD, OFF_DELAY, LOCK);
        assertTrue(pusdc.isProtected(alice));

        _swap(alice, address(pusdc), address(USDC), 500e6);
        assertEq(pusdc.dailyLimitRemaining(alice), 500e6);

        // Uniswap's TransferHelper wraps our ExceedsDailyLimit error in its own revert string.
        vm.prank(alice);
        vm.expectRevert(bytes("TransferHelper: TRANSFER_FROM_FAILED"));
        ROUTER.swapExactTokensForTokens(
            10_000e6, 0, _path(address(pusdc), address(USDC)), alice, vm.getBlockTimestamp()
        );

        // Buying pUSDC is incoming, so it is always instant, even into a protected account.
        uint256 bought = _swap(alice, address(USDC), address(pusdc), 5_000e6);
        assertGt(bought, 4_900e6);
        console2.log("c. protected: 500 swap ok, 10,000 swap reverted, incoming buy ok");

        // ── d. Attacker with alice's key queues a drain; the backup cancels it ──
        uint256 aliceBal = pusdc.balanceOf(alice);
        vm.prank(alice); // = attacker holding alice's key
        uint256 id = pusdc.queueTransfer(attacker, aliceBal);
        assertEq(pusdc.availableBalanceOf(alice), 0);

        vm.warp(vm.getBlockTimestamp() + 1 hours);
        vm.prank(backup);
        pusdc.cancelTransfer(id);
        vm.warp(vm.getBlockTimestamp() + HOLD);
        vm.expectRevert(abi.encodeWithSelector(ProtectedERC20.TransferNotPending.selector, id));
        pusdc.executeTransfer(id);
        assertEq(pusdc.balanceOf(attacker), 0);
        assertEq(pusdc.availableBalanceOf(alice), aliceBal);
        console2.log("d. queued drain cancelled by backup, attacker got 0");

        // ── e. Attacker requests flag-off; before the delay ends, alice is still protected ──
        vm.prank(alice);
        pusdc.requestFlagOff();
        vm.warp(vm.getBlockTimestamp() + 6 days);
        assertTrue(pusdc.isProtected(alice));
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ProtectedERC20.ExceedsDailyLimit.selector, alice, aliceBal, DAILY_LIMIT));
        pusdc.transfer(attacker, aliceBal);
        console2.log("e. 6 days into a 7-day flag-off delay: still protected");

        // ── f. Stress: sweep everything to the backup wallet and lock it ──
        uint256 stressAt = vm.getBlockTimestamp();
        vm.prank(backup);
        pusdc.stress(alice);
        assertEq(pusdc.balanceOf(alice), 0);
        assertEq(pusdc.balanceOf(backup), aliceBal);
        (uint256 locked, uint64 until) = pusdc.lockOf(backup);
        assertEq(locked, aliceBal);
        assertEq(until, stressAt + LOCK);
        assertEq(pusdc.flagOffTime(alice), 0, "stress cancelled the attacker's flag-off request");

        // Every exit for the locked funds reverts: transfer, unwrap, Uniswap.
        bytes memory lockedErr =
            abi.encodeWithSelector(ProtectedERC20.InsufficientUnlockedBalance.selector, backup, aliceBal, 0);
        vm.startPrank(backup);
        vm.expectRevert(lockedErr);
        pusdc.transfer(attacker, aliceBal);
        vm.expectRevert(lockedErr);
        pusdc.withdraw(aliceBal);
        pusdc.approve(address(ROUTER), type(uint256).max);
        vm.expectRevert(bytes("TransferHelper: TRANSFER_FROM_FAILED"));
        ROUTER.swapExactTokensForTokens(
            aliceBal, 0, _path(address(pusdc), address(USDC)), attacker, vm.getBlockTimestamp()
        );
        vm.stopPrank();

        vm.warp(stressAt + LOCK);
        vm.prank(backup);
        pusdc.withdraw(aliceBal);
        assertEq(USDC.balanceOf(backup), aliceBal);
        console2.log("f. stress: funds locked in backup for 14 days, then unwrapped to USDC:", aliceBal);

        // ── g. Threat over: alice turns protection off; after the delay, large swaps are instant again ──
        vm.prank(alice);
        pusdc.requestFlagOff();
        vm.warp(vm.getBlockTimestamp() + OFF_DELAY);
        assertFalse(pusdc.isProtected(alice));

        uint256 usdcBal = USDC.balanceOf(alice);
        uint256 got = _swap(alice, address(USDC), address(pusdc), usdcBal); // incoming
        uint256 back = _swap(alice, address(pusdc), address(USDC), got); // large outgoing, instant
        assertGt(back, usdcBal * 98 / 100); // round trip costs only fees and slippage
        assertEq(pusdc.balanceOf(alice), 0);
        console2.log("g. flag off after 7 days: large swap of pUSDC -> USDC instant again:", back);
    }

    function _swap(address who, address tokenIn, address tokenOut, uint256 amountIn) internal returns (uint256) {
        vm.prank(who);
        uint256[] memory amounts =
            ROUTER.swapExactTokensForTokens(amountIn, 0, _path(tokenIn, tokenOut), who, vm.getBlockTimestamp());
        return amounts[1];
    }

    function _path(address a, address b) internal pure returns (address[] memory p) {
        p = new address[](2);
        p[0] = a;
        p[1] = b;
    }
}
