// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {ProtectedERC20} from "../src/ProtectedERC20.sol";
import {ScheduledSwap} from "../src/ScheduledSwap.sol";
import {V4LiquidityHelper} from "../test/helpers/V4LiquidityHelper.sol";

/// @notice Deploys ScheduledSwap for an existing pUSDC and a seeded Uniswap v4 pUSDC/USDC pool (Base Sepolia).
///   PUSDC=0x... USDC=0x... forge script script/DeployScheduledSwap.s.sol --rpc-url base_sepolia \
///     --account deployer --sender <addr> --broadcast
contract DeployScheduledSwap is Script {
    IPoolManager constant PM = IPoolManager(0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408); // Uniswap v4, Base Sepolia
    uint160 constant PRICE_1_TO_1 = 79228162514264337593543950336;

    function run() external {
        address pusdc = vm.envOr("PUSDC", address(0x033B36fE536e97d312Ece98750A0302eF31CBBab));
        address usdc = vm.envOr("USDC", address(0xC75FDBDb1805528aC07A256aeDEe171d1Da509Be));
        int256 liquidity = int256(vm.envOr("LIQUIDITY", uint256(3e13))); // ~150k of each within ±1% of 1.00

        (address a, address b) = pusdc < usdc ? (pusdc, usdc) : (usdc, pusdc);
        PoolKey memory key = PoolKey(Currency.wrap(a), Currency.wrap(b), 500, 10, IHooks(address(0)));

        vm.startBroadcast();
        ScheduledSwap scheduler = new ScheduledSwap(PM, ProtectedERC20(pusdc));
        V4LiquidityHelper liq = new V4LiquidityHelper(PM);
        PM.initialize(key, PRICE_1_TO_1);
        IERC20(pusdc).approve(address(liq), type(uint256).max);
        IERC20(usdc).approve(address(liq), type(uint256).max);
        liq.addLiquidity(key, -100, 100, liquidity);
        vm.stopBroadcast();

        console2.log("ScheduledSwap:", address(scheduler));
        console2.log("V4LiquidityHelper:", address(liq));
        console2.log("pool currency0:", a);
        console2.log("pool currency1:", b);
        console2.log("pool fee 500 (0.05%), tickSpacing 10, no hooks");
    }
}
