// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {MockERC20} from "../test/mocks/MockERC20.sol";
import {ProtectedWrapper} from "../src/ProtectedWrapper.sol";

interface IUniswapV2RouterLike {
    function addLiquidity(address, address, uint256, uint256, uint256, uint256, address, uint256)
        external
        returns (uint256, uint256, uint256);
    function factory() external view returns (address);
}

interface IUniswapV2FactoryLike {
    function getPair(address, address) external view returns (address);
}

/// @notice TESTNET ONLY. Deploys an openly mintable 6-decimal "Test USD Coin" (tUSDC), a pUSDC wrapper around
///         it, and a Uniswap V2 pool, so the demo can use 100k+ amounts that Circle's faucet can't provide.
///   forge script script/DeployTestUSDC.s.sol --rpc-url base_sepolia --account deployer --broadcast
contract DeployTestUSDC is Script {
    // Uniswap V2 on Base Sepolia (checked on-chain: router.factory() == FACTORY).
    IUniswapV2RouterLike constant ROUTER = IUniswapV2RouterLike(0x1689E7B1F10000AE47eBfE339a4f69dECd19F602);

    uint256 constant POOL_SIDE = 1_000_000e6;
    uint256 constant DEPLOYER_EXTRA = 200_000e6;

    function run() external {
        require(block.chainid != 1 && block.chainid != 8453, "testnet only");
        address me = msg.sender;

        vm.startBroadcast();
        MockERC20 tusdc = new MockERC20("Test USD Coin", "tUSDC", 6);
        ProtectedWrapper pusdc = new ProtectedWrapper(tusdc, "Protected Test USDC", "pUSDC");

        tusdc.mint(me, 2 * POOL_SIDE + 2 * DEPLOYER_EXTRA);
        tusdc.approve(address(pusdc), type(uint256).max);
        pusdc.deposit(POOL_SIDE + DEPLOYER_EXTRA);

        tusdc.approve(address(ROUTER), type(uint256).max);
        pusdc.approve(address(ROUTER), type(uint256).max);
        ROUTER.addLiquidity(address(pusdc), address(tusdc), POOL_SIDE, POOL_SIDE, 0, 0, me, block.timestamp + 1 hours);
        vm.stopBroadcast();

        console2.log("tUSDC (mint: mint(address,uint256)):", address(tusdc));
        console2.log("pUSDC:", address(pusdc));
        console2.log(
            "Uniswap V2 pair:", IUniswapV2FactoryLike(ROUTER.factory()).getPair(address(pusdc), address(tusdc))
        );
        console2.log("deployer now holds 200k pUSDC + 200k tUSDC; pool holds 1M + 1M");
    }
}
