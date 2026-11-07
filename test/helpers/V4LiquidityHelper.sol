// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";

/// @dev Minimal v4 liquidity adder for tests and the demo deployment (ERC-20 currencies only).
///      The caller must approve this contract for both tokens.
contract V4LiquidityHelper is IUnlockCallback {
    IPoolManager public immutable poolManager;

    constructor(IPoolManager pm) {
        poolManager = pm;
    }

    function addLiquidity(PoolKey calldata key, int24 tickLower, int24 tickUpper, int256 liquidity) external {
        poolManager.unlock(abi.encode(msg.sender, key, tickLower, tickUpper, liquidity));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(poolManager), "only pool manager");
        (address payer, PoolKey memory key, int24 lower, int24 upper, int256 liquidity) =
            abi.decode(data, (address, PoolKey, int24, int24, int256));
        (BalanceDelta d,) = poolManager.modifyLiquidity(
            key,
            IPoolManager.ModifyLiquidityParams({
                tickLower: lower, tickUpper: upper, liquidityDelta: liquidity, salt: 0
            }),
            ""
        );
        _square(key.currency0, payer, d.amount0());
        _square(key.currency1, payer, d.amount1());
        return "";
    }

    function _square(Currency c, address payer, int128 amount) private {
        if (amount < 0) {
            poolManager.sync(c);
            IERC20(Currency.unwrap(c)).transferFrom(payer, address(poolManager), uint128(-amount));
            poolManager.settle();
        } else if (amount > 0) {
            poolManager.take(c, payer, uint128(amount));
        }
    }
}
