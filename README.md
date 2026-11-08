# Protected Token

An opt-in **recoverable transfer** flag for ERC-20s. Built at ETHGlobal Mumbai 2026.

Crypto transfers are instant and final, so a stolen key or a wrench attack drains a wallet in seconds.
Protected Token lets each holder switch on a public, on-chain "protected" flag for their own account:

- Turning protection **on is instant**. Anything that **weakens** it (turning it off, changing the backup wallet,
  raising the daily limit, shortening the hold window) only applies after a delay the holder chose (at least 7 days on a production deployment).
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

## Durations and per-deployment minimums

Every duration (hold window, off-delay, emergency lock) is stored in seconds, so minutes, hours and days all work. The
**minimums are fixed per deployment** in the constructor (immutable, no admin):

| Deployment | Min hold | Min off-delay | Min lock | Set by |
| --- | --- | --- | --- | --- |
| Production (`script/Deploy.s.sol`) | 1 day | 7 days | 1 day | `DEFAULT_MIN_*` constants |
| Demo / testnet (`script/DeployTestUSDC.s.sol`) | 1 minute | 2 minutes | 1 minute | so the whole flow can be shown live |

Override either script with `MIN_HOLD`, `MIN_OFF_DELAY`, `MIN_LOCK` (in seconds). The app reads the minimums from the
contract and offers a "Quick demo" preset on minute-level deployments.

## Uniswap v4: protected big swaps ([`src/ScheduledSwap.sol`](src/ScheduledSwap.sol))

A protected account can't make a big swap through any normal router, because the router's `transferFrom` reverts over the
daily limit. Switching protection off would take days and expose you. **ScheduledSwap** gives protected holders big swaps on
Uniswap v4 with no new trust:

1. **Owner:** `pUSDC.queueTransfer(scheduledSwap, amount)`, an ordinary scheduled transfer, so the backup can cancel it and
   `stress()` wipes it.
2. **Owner:** `register(id, poolKey, minOut)` records the swap terms on-chain, so the backup can review them during the hold.
3. **Anyone, after the hold** (or right away if the backup approves through the fast lane): `execute(id)` swaps on v4 and pays
   the output **straight to the owner**. A thief who triggers it gains nothing.

Where v4 is used (exact lines):

| What | Code |
| --- | --- |
| Take the lock with flash accounting: `PoolManager.unlock` | [ScheduledSwap.sol#L108](https://github.com/Eshan276/pUSDC/blob/main/src/ScheduledSwap.sol#L108) |
| Callback entry point | [ScheduledSwap.sol#L149](https://github.com/Eshan276/pUSDC/blob/main/src/ScheduledSwap.sol#L149) |
| Exact-input `swap` | [ScheduledSwap.sol#L155](https://github.com/Eshan276/pUSDC/blob/main/src/ScheduledSwap.sol#L155) |
| `minOut` slippage guard | [ScheduledSwap.sol#L168](https://github.com/Eshan276/pUSDC/blob/main/src/ScheduledSwap.sol#L168) |
| Pay the input: `sync` → ERC-20 transfer → `settle` | [ScheduledSwap.sol#L172-L174](https://github.com/Eshan276/pUSDC/blob/main/src/ScheduledSwap.sol#L172-L174) |
| `take` the output directly to the owner | [ScheduledSwap.sol#L177](https://github.com/Eshan276/pUSDC/blob/main/src/ScheduledSwap.sol#L177) |
| Safety checks on register (hookless pool, must trade pUSDC, `minOut > 0`) | [ScheduledSwap.sol#L83-L94](https://github.com/Eshan276/pUSDC/blob/main/src/ScheduledSwap.sol#L83-L94) |
| Tokens delivered without a swap (direct execute / fast lane) are still swapped, or refunded | [ScheduledSwap.sol#L118-L146](https://github.com/Eshan276/pUSDC/blob/main/src/ScheduledSwap.sol#L118-L146) |
| Pool creation (`initialize`) and seeding (`modifyLiquidity`) | [DeployScheduledSwap.s.sol#L32-L35](https://github.com/Eshan276/pUSDC/blob/main/script/DeployScheduledSwap.s.sol#L32-L35), [V4LiquidityHelper.sol#L28](https://github.com/Eshan276/pUSDC/blob/main/test/helpers/V4LiquidityHelper.sol#L28) |

The tests ([`test/ScheduledSwap.t.sol`](test/ScheduledSwap.t.sol)) run against the **real v4 PoolManager on a Base Sepolia fork**
(`0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408`). They cover the happy path, a backup cancel, stress, the hold, `minOut`, ownership,
hooked and wrong pools, delivery without a swap, the fast lane, refunds, and a thief triggering the swap. The pool is a hookless 0.05%
pUSDC/USDC pool with liquidity concentrated within ±1% of 1.00, so a 15,000 swap costs about 0.1%.
**Live on Base Sepolia:** a protected wallet (2-minute hold) scheduled a 5,000 pUSDC swap
([queue](https://sepolia.basescan.org/tx/0x1a6e88d5b002a5c5d2295d3a280bd6f756af98817ca1b35ab92e2adba57d3c85),
[register terms](https://sepolia.basescan.org/tx/0xd8a7e5ba1617f5cdc71dcea5126e5e8791804b7a338938f8026ec5f565e6071b)). Executing during the hold was refused.
After the hold, another wallet acting as a keeper [executed it](https://sepolia.basescan.org/tx/0x35ec84612f3b0ff8f693132ead34775b7bfcff8d106070e4b3026e8323f233f2),
and the owner received 4,996.67 USDC (0.07% total cost).

Developer feedback is in [`FEEDBACK.md`](FEEDBACK.md).

## Private reads with anon-rpc ([`frontend/src/lib/anonRpc.ts`](frontend/src/lib/anonRpc.ts))

The app reads the chain through [anon-rpc](https://github.com/ethereum/anon-rpc) **by default**, using the **Nox** mixnet
worker (Sphinx packets through entry, mix and exit nodes; TLS to the RPC terminates inside the sandboxed worker). It plugs in
as viem's `fetchFn`, so every app read (balances, protection state, scheduled transfers, watched wallets) goes through it.

**Why it matters for this project:** the "I'm a backup" view looks up the wallet you protect. Over a normal RPC, the provider
learns *this IP watches that wallet*, which links your backup to your main wallet. That's exactly what a wrench attacker
would want to know. Through the mixnet, the RPC provider can't tell who asked.

- Verified in a headless browser against live Base Sepolia: the page made **no direct requests to the RPC**. The only
  outside requests were the one-time specifier read (bootstrap) and the hash-checked worker bundle download.
- The first load takes about 15–20 s while the mixnet connects (shown as "Connecting privately…"); then reads take 1–3 s each.
- The header shows the status ("Private connection" / "Connecting privately…" / "Standard connection"). If the mixnet fails,
  the app falls back to a normal connection **and says so** in a banner with "Try private again". Users can also turn it off.
- Limits: this covers the app's own reads. Your wallet extension still sends transactions, and does its own lookups, through
  its own RPC provider. The dev test mode (local anvil) can't be anonymized and uses a normal connection.
- We also tried the Nym and Tor (demo gateway) workers. From our test environment, neither connected (no gateway / no Tor
  directory within 3 minutes), so we chose Nox.

## Deployments

| Network | Contract | Address |
| --- | --- | --- |
| Base Sepolia (84532) | **pUSDC, current** (`ProtectedWrapper` around the demo USDC; fast lane, auto-scheduled wallet sends, minute-level minimums 60s/120s/60s) | [`0x033B36fE536e97d312Ece98750A0302eF31CBBab`](https://sepolia.basescan.org/address/0x033B36fE536e97d312Ece98750A0302eF31CBBab) |
| Base Sepolia (84532) | Demo USDC: **test token, anyone can mint**, 6 decimals | [`0xC75FDBDb1805528aC07A256aeDEe171d1Da509Be`](https://sepolia.basescan.org/address/0xC75FDBDb1805528aC07A256aeDEe171d1Da509Be) |
| Base Sepolia (84532) | Uniswap V2 pool, current pUSDC/USDC, seeded with 1M + 1M | [`0xfab232073e4008372C0454990978e8d8E882Aa88`](https://sepolia.basescan.org/address/0xfab232073e4008372C0454990978e8d8E882Aa88) |
| Base Sepolia (84532) | **ScheduledSwap** (protected big swaps on Uniswap v4) | [`0x3aa82e9d481FDdf1913381ae2692c3FF272e4158`](https://sepolia.basescan.org/address/0x3aa82e9d481FDdf1913381ae2692c3FF272e4158) |
| Base Sepolia (84532) | Uniswap v4 pUSDC/USDC pool: hookless, 0.05% fee, tick spacing 10, ~150k + ~150k within ±1% of 1.00, on the official PoolManager | PoolManager [`0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408`](https://sepolia.basescan.org/address/0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408) · init tx [`0xc3fc68f4…`](https://sepolia.basescan.org/tx/0xc3fc68f469b040f0a722c3c60b58aeedf5cc0492c14d40d3bd2121dc54bf1f3e) |

<details><summary>Retired earlier deployments (first contract version, before fast lane and minute minimums)</summary>

| Contract | Address |
| --- | --- |
| pUSDC around Circle's test USDC | [`0x4045cB3524304aB25409E39C4170A76762228B2B`](https://sepolia.basescan.org/address/0x4045cB3524304aB25409E39C4170A76762228B2B) |
| pUSDC around the demo USDC | [`0xCabC4016cc24d2A2509552378dE6e232241295a3`](https://sepolia.basescan.org/address/0xCabC4016cc24d2A2509552378dE6e232241295a3) |
| Uniswap V2 pool for it | [`0xbf2bD7B3cd08859c924d14d6dcbB9dB5dC5091cd`](https://sepolia.basescan.org/address/0xbf2bD7B3cd08859c924d14d6dcbB9dB5dC5091cd) |

</details>

## Build and test

```sh
forge build
export MAINNET_RPC_URL=<your mainnet RPC>   # needed for the fork demo test
forge test -vv
```

The local token, wrapper and delegated-account suites do not need an RPC:

```sh
forge test --match-contract '^(ProtectedERC20Test|ProtectedWrapperTest|DelegatedAccountTest)$' -vv
```

Validated with Foundry 1.7.1: 89 tests pass, including nine delegated-account cases and 256 batch-spend fuzz runs.
`DelegatedAccount.t.sol` uses signed Foundry delegations and Prague execution to check the existing code-bearing
account policy, batch rollback, allowance rollback, explicit scheduling, and replacement/revocation of delegation.
It keeps the default Solidity 0.8.28/Cancun build and switches the test EVM with `vm.setEvmVersion`.
These are staged Foundry delegations, not mined type-4 transactions; the fork demos are outside this command.

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

**Live app:** https://protected-usdc.vercel.app (Base Sepolia; connect MetaMask and use "Get 10,000 test USDC" to start).

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
