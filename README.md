# Protected Token

An opt-in **recoverable transfer** flag for ERC-20s. Built at ETHGlobal Mumbai 2026.

Crypto transfers are instant and final, so a stolen key or a wrench attack drains a wallet in seconds.
Protected Token lets each holder switch on a public, on-chain "protected" flag for their own account:

- Turning protection **on is instant**. Anything that **weakens** it (turning it off, changing the backup wallet,
  raising the daily limit, shortening the hold window) only applies after a delay the holder chose (at least 7 days).
- Outgoing transfers above a **daily limit** don't go out instantly. A big **Send from any wallet app (e.g. MetaMask)** is
  automatically **scheduled**: it shows as sent, but the recipient gets it after a hold window, during which a pre-registered
  **backup wallet** can cancel it. Contracts pulling funds (`transferFrom`: DEXs, approvals) get a clean revert instead,
  so no protocol is ever fooled into thinking tokens arrived.
- Optional **fast lane**: the backup can approve a scheduled transfer to send it right away.
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

## Security model: what it does and doesn't protect against

| Situation | Outcome |
| --- | --- |
| Key stolen **after** protection is on | The thief gets at most the daily limit. Anything bigger is scheduled publicly and can be cancelled by you or your backup. Turning protection off, loosening a setting or changing the backup all wait the off-delay, and the emergency button cancels them. |
| Someone forces you to hand over funds (wrench attack) | The emergency button (or your backup) moves everything to the backup, where it's locked. Nobody can release it early, including you. |
| Key **already** leaked **before** you turn protection on | Not protected: protection isn't retroactive, and the attacker could even front-run `protect()` with their own backup. Set up protection on a **fresh wallet before funding it**. The app warns about this, and flags a backup you never chose. |
| Leaked key, attacker waits for you to switch protection off | Once it's off, whoever holds the key has full control. Don't switch off a possibly-compromised wallet: **move funds to a new wallet** instead (the app has a button for it), or use the fast lane so you never need to switch off. |
| Both your main key and backup key compromised | Not protected. The backup is the root of trust. |

**Big sends from wallet apps.** A plain `transfer()` sent directly by a normal wallet over the daily limit is scheduled (it returns
`true`, and the standard `Transfer` event only appears when it executes). Recipients get it after the hold, so don't use big sends
for payments that must arrive now. `transferFrom` and calls from contracts or code-bearing accounts (incl. EIP-7702) revert,
because a contract might treat `true` as "tokens moved".

**Fast lane (opt-in).** Your backup can approve a scheduled transfer to send it immediately, so big payments don't require
switching protection off. An attacker holding only your main key can't approve. It's off by default because if one person
holds both keys, a physical attacker can force both approvals. Enabling it later waits the off-delay, and disabling it is instant.

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

## Frontend (`frontend/`)

A static web app for the Base Sepolia demo deployment: no backend, no trackers, browser-extension wallets only. It builds to plain
files, so it can be hosted on IPFS + ENS.

```sh
cd frontend
npm install
npm run dev          # http://localhost:5173
npm run build        # static site in frontend/dist
npm run abi          # regenerate src/abi.ts after `forge build`
```

What it does:
- explains the idea in plain words before you connect,
- has a 3-step protection setup (backup wallet, presets, plain-language review),
- shows whether each send or withdrawal will be instant or scheduled before you confirm,
- shows countdowns on scheduled transfers,
- labels each settings change as "applies instantly" or "applies on <date>",
- has a hold-to-confirm emergency button,
- has an "I'm a backup" view for stopping transfers and rescuing someone's funds,
- offers a test-USDC faucet.

**Dev-only test mode**, for clicking through without MetaMask: run anvil as a fork of Base Sepolia with `--auto-impersonate`, start the app with
`VITE_RPC_URL=http://127.0.0.1:8545 npm run dev`, then open `/?as=0xANY_ADDRESS`. Production builds strip it out.

Design tokens and voice are documented in `brand.md`.

## License

MIT
