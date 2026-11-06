// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {DemoFastProtectedWrapper} from "../src/demo/DemoFastProtectedWrapper.sol";

/// @notice TESTNET ONLY. Deploys the minute-level demo token around an existing underlying (default: the demo USDC
/// from DeployTestUSDC on Base Sepolia). Never use for real funds.
///   forge script script/DeployDemoFast.s.sol --rpc-url base_sepolia --sender <you> --account <keystore> --broadcast
contract DeployDemoFast is Script {
    function run() external returns (DemoFastProtectedWrapper pusdc) {
        require(block.chainid != 1 && block.chainid != 8453, "demo variant is testnet only");
        address underlying = vm.envOr("UNDERLYING", address(0xC75FDBDb1805528aC07A256aeDEe171d1Da509Be));
        require(underlying.code.length > 0, "underlying is not a contract on this chain");

        vm.startBroadcast();
        pusdc = new DemoFastProtectedWrapper(IERC20Metadata(underlying), "Demo Protected USDC (fast)", "dpUSDC");
        vm.stopBroadcast();

        console2.log("underlying:  ", underlying);
        console2.log("fast demo pUSDC:", address(pusdc));
    }
}
