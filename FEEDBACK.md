# Uniswap v4 developer feedback

Notes written while building `ScheduledSwap` (protected big swaps on v4) at ETHGlobal Mumbai, November 2026.

## What worked well
- **Flash accounting is a great fit for "swap on someone else's behalf".** `unlock`, then `swap`, then `sync`/transfer/`settle`,
  then `take(currency, owner, amount)` let us pay the output straight to the owner without the contract ever holding it.
  The core logic is about 30 lines.
- **`take` to any address** made "the output always goes to the owner, whoever triggers it" trivial and easy to audit.
- **Forking a public testnet and using the real deployed PoolManager** in Foundry tests worked well. We didn't have to
  compile or deploy v4-core ourselves.
- **Hookless pools** are easy to require (`key.hooks == address(0)`), which mattered for us: a malicious hook could
  otherwise skim a scheduled swap's input.

## Friction we hit
1. **Finding testnet addresses.** Web search didn't surface the Base Sepolia v4 addresses reliably. We confirmed the
   PoolManager by checking that the PositionManager's `poolManager()` pointed at it. A machine-readable deployments file
   (JSON per chain) in the repo would help.
2. **`PoolManager.sol` pins `pragma solidity 0.8.26` exactly**, while the interfaces use `^0.8.24`. Projects on 0.8.28 can't
   compile PoolManager for local tests without multi-version setups, which pushed us to fork tests.
3. **Struct locations moved between versions** (`IPoolManager.SwapParams` / `ModifyLiquidityParams` vs. later
   `PoolOperation.sol`). Code samples online mix both, so we had to read the tagged source.
4. **Adding liquidity without v4-periphery** means doing `modifyLiquidity` delta settlement by hand. `LiquidityAmounts`
   (liquidity from token amounts) lives in periphery, so sizing a concentrated range took manual math. A tiny core-level
   helper, or a docs snippet ("seed a stable pool within ±1%"), would save time.
5. **The test routers in `v4-core/src/test`** import `../../test/utils/CurrencySettler.sol`, which pulls in more of the test
   tree, so we wrote a 40-line helper instead. A standalone, dependency-free liquidity router would be handy for demos.
6. **Our first test used full-range liquidity** and a 50k swap lost about 5% to price impact. That's correct math, but
   newcomers may expect stable-pair behavior. A docs callout on concentrating liquidity for pegged pairs would help.
7. **Exact-input sign convention** (`amountSpecified < 0`) and reading in/out from `BalanceDelta` depending on `zeroForOne`
   are easy to get backwards. A short table in the swap docs mapping direction to which delta is negative would prevent bugs.

## Where v4 is used in this repo
See the README section "Uniswap v4: protected big swaps", which links the exact lines (`unlock`, `swap`, `sync`/`settle`,
`take`, pool `initialize`/`modifyLiquidity`).
