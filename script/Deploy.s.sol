// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {ProtectedERC20} from "../src/ProtectedERC20.sol";
import {ProtectedWrapper} from "../src/ProtectedWrapper.sol";

/// @notice Deploys pUSDC (ProtectedWrapper around USDC).
///   forge script script/Deploy.s.sol --rpc-url base_sepolia --account <keystore> --broadcast --verify
/// Override the underlying with UNDERLYING=<address>. Minimums default to production values (1-day hold,
/// 7-day off-delay, 1-day lock); override in seconds with MIN_HOLD / MIN_OFF_DELAY / MIN_LOCK.
contract Deploy is Script {
    function run() external returns (ProtectedWrapper pusdc) {
        address underlying = vm.envOr("UNDERLYING", _defaultUsdc());
        require(underlying.code.length > 0, "underlying is not a contract on this chain");

        ProtectedERC20.Minimums memory mins = ProtectedERC20.Minimums({
            holdWindow: uint64(vm.envOr("MIN_HOLD", uint256(1 days))),
            offDelay: uint64(vm.envOr("MIN_OFF_DELAY", uint256(7 days))),
            lockDuration: uint64(vm.envOr("MIN_LOCK", uint256(1 days)))
        });

        vm.startBroadcast();
        pusdc = new ProtectedWrapper(IERC20Metadata(underlying), "Protected USDC", "pUSDC", mins);
        vm.stopBroadcast();

        console2.log("chain id:  ", block.chainid);
        console2.log("underlying:", underlying);
        console2.log("pUSDC:     ", address(pusdc));
    }

    function _defaultUsdc() internal view returns (address) {
        if (block.chainid == 84532) return 0x036CbD53842c5426634e7929541eC2318f3dCF7e; // Base Sepolia (Circle)
        if (block.chainid == 8453) return 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913; // Base mainnet
        if (block.chainid == 1) return 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48; // Ethereum mainnet
        revert("no default USDC for this chain: set UNDERLYING");
    }
}
