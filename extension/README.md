# Protected Wallet (Chrome extension)

Standalone self-custody wallet for Base Sepolia with the Protected Token rules built into the UI.

**Build and load:** `npm install && npm run build`, then chrome://extensions → Developer mode → Load unpacked → `extension/dist`.
First install opens a full-page welcome flow. Needs `../frontend` (shared UI + generated ABI; run `forge build && npm run abi` there if the ABI changes).

## Features
- **Onboarding:** 3-slide intro, create or import, password strength meter, 12-word phrase with reveal, 3-word confirmation quiz, then a "Get ready" checklist that ticks itself off from on-chain state (ETH for fees → test pUSDC → protection → emergency PIN).
- **Protection wizard:** backup wallet → Everyday / Savings / Custom → plain-language review. Settings page edits every parameter, shows whether a change is instant (stricter) or delayed (looser), plus backup change and scheduled turn-off.
- **Send routing:** instant `transfer` within the daily limit, otherwise `queueTransfer`, explained before signing. Same check on dApp transactions, with a "Schedule it instead" rewrite.
- **Waiting:** scheduled transfers with countdowns, pending flag-off / backup / limit changes, each cancellable.
- **Guard:** background alarm (1 min) watches your wallet and any wallets you add; notifies on new queued transfers or settings changes; backups can stop transfers or `stress()`.
- **Emergency PIN:** unlocking with it calls `stress(self)`, then shows an empty decoy wallet that holds no key.
- **Security:** auto-lock, change password, recovery phrase reveal, remove wallet.
- **dApps:** EIP-1193 + EIP-6963 provider; connect, `eth_sendTransaction`, `personal_sign`, typed data v4; rejections return 4001.
- **Keys:** seed encrypted with AES-GCM; data key wrapped under the password (PBKDF2-SHA256, 600k) and the optional PIN. Decrypted keys live only in `chrome.storage.session`.

## Short delays for demos
Each ProtectedWrapper deployment fixes its own shortest delays in the constructor (days on a production token, minutes on a demo one). The wallet reads `MIN_*` and `MAX_*` from the contract, so against the current Base Sepolia deployment (60s hold, 120s off-delay, 60s lock) it shows minutes and a "Fast demo" preset automatically; against a day-based deployment it shows days.
To try another deployment, paste its address in **More → Demo token** (no rebuild; "Back to default" undoes it), or build with `VITE_PUSDC=<address> npm run build`. Countdowns follow the chain's clock (latest block), not the computer's.
Plain over-limit sends from this wallet are scheduled by the token itself, and the approval screen says so.

## Testing
`npm run test:e2e` starts an anvil fork of Base Sepolia, builds a test copy of the extension (`dist-test`), and drives real Chromium through 20 checks: onboarding and quiz validation, lock/unlock, one-click funding, protection wizard, instant vs scheduled sends, cancel, looser-vs-stricter settings, dApp connect / sign / typed data / reject / "Schedule it instead" / read passthrough, Guard, and the emergency-PIN sweep with decoy.
Needs foundry (`anvil`, `cast`) and a Chromium (set `CHROME=/path/to/chrome` if it isn't found in the Playwright cache). `npm run test:e2e:fast` runs against the minute-minimum deployment: minute inputs and the Fast demo preset, scheduling, completion after 2 minutes, and switching deployments in the UI. `npm run test:e2e` deploys a production-minimum (day-based) token on the fork first. Not covered: Chrome notifications and auto-lock timing.

## Not done
Multiple accounts, other chains, token list beyond pUSDC, transaction history from chain (activity shows what you did in this wallet), an independent security review.
