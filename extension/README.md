# Protected Wallet (Chrome extension)

Standalone self-custody wallet for Base Sepolia with the Protected Token rules built into the UI.

**Build and load:** `npm install && npm run build`, then chrome://extensions → Developer mode → Load unpacked → `extension/dist`.
First install opens a full-page welcome flow. Needs `../frontend` (shared UI + generated ABI; run `forge build && npm run abi` there if the ABI changes).

## Features
- **Onboarding:** 3-slide intro, create or import, password strength meter, 12-word phrase with reveal, 3-word confirmation quiz, then a "Get ready" checklist that ticks itself off from on-chain state (ETH for fees → test pUSDC → protection → emergency PIN).
- **Protection wizard:** backup wallet → Everyday / Savings / Custom → plain-language review. Settings page edits every parameter, shows whether a change is instant (stricter) or delayed (looser), plus backup change and scheduled turn-off.
- **Accounts:** several accounts from the same recovery phrase (up to 10): add, switch from the header, rename. Every signature, dApp connection and balance follows the selected account; Guard watches all of them.
- **Assets and send:** pUSDC, USDC and ETH rows. Send has an asset picker: pUSDC keeps the instant-vs-scheduled routing, USDC is a plain transfer, ETH a plain value transfer. Amount/address validation, ETH-for-gas checks, and a network fee estimate before you confirm (also shown on dApp transaction approvals).
- **Receive:** a QR code (generated locally as SVG) plus the copyable address.
- **Swap:** a Uniswap-style card. USDC → pUSDC wraps exactly 1:1 (Approve, then Swap); pUSDC → USDC unwraps 1:1, or is scheduled by the token when over the daily limit; pUSDC → USDC can also go through the Uniswap v4 pool as a scheduled swap with 0.5 / 1 / 3 % slippage, via the `ScheduledSwap` contract.
- **Activity:** on-chain pUSDC and USDC transfers to and from the account over the last ~9,000 blocks (scanned in 200-block ranges, because the public RPC refuses wider ones, and cached so refreshes only fetch new blocks) merged with what the wallet recorded. Recent activity on the home screen, the full list in More → Activity, each row linking to the explorer. Wraps, unwraps and faucet mints are worded as what they are.
- **Connected sites:** More → Connected sites lists approved origins with Disconnect; afterwards the site's `eth_accounts` returns `[]`.
- **Private key export:** More → Security, password required, hidden until asked, for the selected account only.
- **Send routing:** instant `transfer` within the daily limit, otherwise `queueTransfer`, explained before signing. Plain over-limit sends from a dApp are scheduled by the token itself and the approval screen says so.
- **Waiting:** scheduled transfers with countdowns, pending flag-off / backup / limit changes, each cancellable.
- **Guard:** background alarm (1 min) watches your wallet and any wallets you add; notifies on new queued transfers or settings changes; backups can stop transfers or `stress()`.
- **Emergency PIN:** unlocking with it calls `stress` for **every** protected account, then shows an empty decoy wallet that holds no keys and no account list.
- **Security:** auto-lock, change password, recovery phrase reveal, remove wallet.
- **dApps:** EIP-1193 + EIP-6963 provider; connect, `eth_sendTransaction`, `personal_sign`, typed data v4; rejections return 4001.
- **Keys:** seed encrypted with AES-GCM; data key wrapped under the password (PBKDF2-SHA256, 600k) and the optional PIN. Decrypted keys live only in `chrome.storage.session`.

## Short delays for demos
Each ProtectedWrapper deployment fixes its own shortest delays in the constructor (days on a production token, minutes on a demo one). The wallet reads `MIN_*` and `MAX_*` from the contract, so against the current Base Sepolia deployment (60s hold, 120s off-delay, 60s lock) it shows minutes and a "Fast demo" preset automatically; against a day-based deployment it shows days.
To try another deployment, paste its address in **More → Demo token** (no rebuild; "Back to default" undoes it), or build with `VITE_PUSDC=<address> npm run build`. Countdowns follow the chain's clock (latest block), not the computer's.
Plain over-limit sends from this wallet are scheduled by the token itself, and the approval screen says so.

## Testing
All suites start an anvil fork of Base Sepolia, build a test copy of the extension (`dist-test`) and drive real Chromium, checking results on-chain with `cast`. They need foundry (`anvil`, `cast`) and a Chromium (set `CHROME=/path/to/chrome` if it isn't found in the Playwright cache); run them one at a time (they share port 8550).
- `npm run test:e2e:wallet` (18 checks, default deployment): accounts (add, switch, rename, signing account verified from the mined transaction), ETH / USDC sends with validation, QR code decoded back to the address, on-chain activity with in/out direction and explorer links, connected sites and disconnect, dApp approval with a fee estimate, private key export (password, hidden by default, derives the account's address), every swap state (approve, wrap, unwrap, scheduled, Uniswap v4 registered then executed after the hold), and the emergency PIN sweeping two protected accounts.
- `npm run test:e2e` (18 checks): onboarding, lock/unlock, funding, protection wizard, sends, settings, dApp provider, Guard, emergency PIN. Deploys a production-minimum (day-based) token first.
- `npm run test:e2e:fast` (6 checks): minute inputs and the Fast demo preset, scheduling, completion after 2 minutes, switching deployments in the UI.
`node tests/screenshot.mjs` saves popup-sized screenshots for eyeballing. Not covered: Chrome notifications and auto-lock timing.

## Not done
Other chains, importing a single private key as a new account, accounts-changed events pushed to websites after you switch account (a site sees the new account the next time it asks), swaps through other routers, an independent security review.
