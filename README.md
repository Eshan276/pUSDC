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

## Deployments

| Network | Contract | Address |
| --- | --- | --- |
| Base Sepolia (84532) | pUSDC (`ProtectedWrapper` around Circle's test USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e`) | [`0x4045cB3524304aB25409E39C4170A76762228B2B`](https://sepolia.basescan.org/address/0x4045cB3524304aB25409E39C4170A76762228B2B) |
| Base Sepolia (84532) | Demo USDC: **test token, anyone can mint**, 6 decimals (`script/DeployTestUSDC.s.sol`) | [`0xC75FDBDb1805528aC07A256aeDEe171d1Da509Be`](https://sepolia.basescan.org/address/0xC75FDBDb1805528aC07A256aeDEe171d1Da509Be) |
| Base Sepolia (84532) | Demo pUSDC (`ProtectedWrapper` around the demo USDC) | [`0xCabC4016cc24d2A2509552378dE6e232241295a3`](https://sepolia.basescan.org/address/0xCabC4016cc24d2A2509552378dE6e232241295a3) |
| Base Sepolia (84532) | Uniswap V2 pool, demo pUSDC/USDC, seeded with 1M + 1M | [`0xbf2bD7B3cd08859c924d14d6dcbB9dB5dC5091cd`](https://sepolia.basescan.org/address/0xbf2bD7B3cd08859c924d14d6dcbB9dB5dC5091cd) |

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

Free public RPCs only keep about 25 minutes of mainnet history. If you pause on a step for longer, the fork can no
longer fetch state ("historical state is not available"). Use an archive RPC (a free Alchemy or Infura key works), or
restart anvil and rerun.

## License

MIT
