# Protected Token

An opt-in **recoverable transfer** flag for ERC-20s. Built at ETHGlobal Mumbai 2026.

Crypto transfers are instant and final, so a stolen key or a wrench attack drains a wallet in seconds.
Protected Token lets each holder switch on a public, on-chain "protected" flag for their own account:

- Turning protection **on is instant**. Anything that **weakens** it (turning it off, changing the backup wallet,
  raising the daily limit, shortening the hold window) only applies after a delay the holder chose (at least 7 days).
- Outgoing transfers above a **daily limit** revert. Large moves are **queued** and wait out a hold window, during
  which a pre-registered **backup wallet** can cancel them.
- **`stress()`** sweeps the whole balance to the backup wallet and locks it there for a set time.
- **Incoming transfers are always instant.** Unprotected accounts behave exactly like a plain ERC-20, so it works with
  unmodified Uniswap.
- **`ProtectedWrapper`** wraps any existing ERC-20 1:1 (e.g. USDC → pUSDC).

## Layout

| Path | What it is |
| --- | --- |
| `src/ProtectedERC20.sol` | Abstract ERC-20 + Permit extension that implements every rule |
| `src/ProtectedWrapper.sol` | 1:1 wrapper for an existing ERC-20 (pUSDC) |
| `test/` | Unit tests, plus `DemoScenario.t.sol`, which runs the whole demo on a mainnet fork |

## Build and test

```sh
forge build
export MAINNET_RPC_URL=<your mainnet RPC>   # needed for the fork demo test
forge test -vv
```

## Try the demo in a terminal

This runs the whole story on a local mainnet fork, with real USDC and the real Uniswap V2. Nothing touches the
real chain.

```sh
# terminal 1: local fork of mainnet
anvil --fork-url "$MAINNET_RPC_URL" --auto-impersonate

# terminal 2: step-by-step demo (press Enter between steps; DEMO_AUTO=1 runs it without pauses)
./script/demo.sh
```

## License

MIT
