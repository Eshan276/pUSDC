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

## Minute-level demo token
The real token enforces day-level delays. For live demos there is a testnet-only variant (`src/demo/DemoFastProtectedWrapper.sol`: 1-minute minimums, 10-minute daily window). The wallet reads the allowed ranges from the contract, so against the demo token it shows minutes and a "Fast demo" preset automatically.
Deploy it with your keystore, then either paste the printed address into the wallet (**More → Demo token → Use this token**, no rebuild needed; "Back to default" undoes it), or build the extension pointing at it:
```sh
forge script script/DeployDemoFast.s.sol --rpc-url base_sepolia --sender <you> --account <keystore> --broadcast
VITE_PUSDC=<printed address> npm run build
```
Countdowns follow the chain's clock (latest block), not the computer's.

## Testing
`npm run test:e2e` starts an anvil fork of Base Sepolia, builds a test copy of the extension (`dist-test`), and drives real Chromium through 20 checks: onboarding and quiz validation, lock/unlock, one-click funding, protection wizard, instant vs scheduled sends, cancel, looser-vs-stricter settings, dApp connect / sign / typed data / reject / "Schedule it instead" / read passthrough, Guard, and the emergency-PIN sweep with decoy.
Needs foundry (`anvil`, `cast`) and a Chromium (set `CHROME=/path/to/chrome` if it isn't found in the Playwright cache). `npm run test:e2e:fast` deploys the demo token on the fork and checks minute-level scheduling, completion after 2 minutes and the 10-minute limit reset. Not covered: Chrome notifications and auto-lock timing.

## Not done
Multiple accounts, other chains, token list beyond pUSDC, transaction history from chain (activity shows what you did in this wallet), an independent security review.
