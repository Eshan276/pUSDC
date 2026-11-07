// New wallet features, in real Chromium against an anvil fork of Base Sepolia, with on-chain checks via cast:
// multiple accounts, ETH/USDC/pUSDC sends, QR receive, on-chain activity, connected sites, private key export,
// fee estimates, the swap screen (wrap, unwrap, scheduled, Uniswap v4) and the emergency-PIN sweep across accounts.
// Run: npm run test:e2e:wallet   (uses the default Base Sepolia pUSDC, which has minute-level minimums)
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";
import jsQR from "jsqr";
import { privateKeyToAddress } from "viem/accounts";
import { BACKUP, THIEF, PW, cast, sh, start } from "./harness.mjs";

const USDC = "0xC75FDBDb1805528aC07A256aeDEe171d1Da509Be";
const PUSDC = "0x033B36fE536e97d312Ece98750A0302eF31CBBab";
const SCHEDULER = "0x3aa82e9d481FDdf1913381ae2692c3FF272e4158";
const first = (s) => s.split(" ")[0];
const tokBal = (t, who) => BigInt(first(cast(`call ${t} "balanceOf(address)(uint256)" ${who}`)));
const ethBal = (who) => BigInt(cast(`balance ${who}`));
const queued = (who) => cast(`call ${PUSDC} "pendingTransferIds(address)(uint256[])" ${who}`);
const E6 = 1_000_000n;
const ANVIL0 = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"; // pre-funded, unlocked on anvil
const anySend = (c) => cast(`send ${c} --from ${ANVIL0} --unlocked`);
const warp = (s) => { cast(`rpc evm_increaseTime ${s}`); cast("rpc evm_mine"); };

const dappServer = createServer((_, res) => res.end("<!doctype html><title>dapp</title><body>dapp</body>")).listen(8765);
const h = await start();
const { page, T, step } = h;
const shot = async (name) => { await page.setViewportSize({ width: 380, height: 780 }); await page.waitForTimeout(500); await page.screenshot({ path: join(tmpdir(), `wallet-${name}.png`), fullPage: true }); };
const tab = (name) => page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name });
const action = (name) => page.getByRole("group", { name: "Actions" }).getByRole("button", { name });
const state = () => h.state();
const unlocked = async () => { await page.goto(`chrome-extension://${h.id}/popup.html?tab=1`); await page.getByText("Total balance").waitFor({ timeout: 30000 }).catch(async () => { await page.getByLabel("Password").fill(PW); await page.getByRole("button", { name: "Unlock" }).click(); await page.getByText("Total balance").waitFor(); }); };

console.log("Setup");
const me1 = await h.onboard();
cast(`rpc anvil_setBalance ${BACKUP} 0x56BC75E2D63100000`);
await step("fund, wrap and protect account 1 (Fast demo preset)", async () => {
  await page.getByRole("button", { name: "Get 10,000 test pUSDC" }).click(); await T("10,000 pUSDC added");
  await page.getByRole("button", { name: "Set up protection" }).first().click();
  await page.getByLabel("Backup wallet address").fill(BACKUP); await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: /Next/ }).click(); await page.getByRole("button", { name: /Review/ }).click();
  await page.getByRole("button", { name: "Turn on protection" }).click(); await T("Protection is on");
  if (tokBal(PUSDC, me1) !== 10_000n * E6) throw new Error("balance " + tokBal(PUSDC, me1));
});

console.log("\nAccounts");
let me2;
await step("add an account: new address, becomes active, balance resets", async () => {
  await page.getByRole("button", { name: "Switch account" }).click();
  await shot("switcher");
  await page.getByRole("button", { name: /Add account/ }).click();
  await page.waitForFunction(async () => (await chrome.runtime.sendMessage({ t: "state" })).data.accounts.length === 2);
  const st = await state();
  me2 = st.accounts[1].address;
  if (st.selected !== 1 || me2.toLowerCase() === me1.toLowerCase()) throw new Error("not switched: " + JSON.stringify(st.accounts));
  await page.getByText("$0.00").first().waitFor();
});
await step("rename the account", async () => {
  await page.getByRole("button", { name: "Switch account" }).click();
  await page.getByRole("button", { name: "Rename Account 2" }).click();
  await page.getByLabel("Account name").fill("Savings"); await page.getByRole("button", { name: "Save" }).click();
  await page.getByRole("menuitem", { name: /Savings/ }).waitFor();
  await page.getByRole("menuitem", { name: /Savings/ }).click();
  await page.getByRole("button", { name: "Switch account" }).filter({ hasText: "Savings" }).waitFor();
  if ((await state()).accounts[1].name !== "Savings") throw new Error("name not stored");
});
cast(`rpc anvil_setBalance ${me2} 0x56BC75E2D63100000`);
await step("the selected account is the one that signs (ETH sent from account 2)", async () => {
  await page.reload(); await page.getByText("Total balance").waitFor();
  const before = ethBal(THIEF);
  await tab("Send").click();
  await page.getByRole("radio", { name: "ETH" }).click();
  await page.getByLabel("To").fill(THIEF); await page.getByLabel("Amount").fill("0.25");
  await page.getByTestId("fee").waitFor(); await page.getByText("≈").first().waitFor();
  await page.getByRole("button", { name: "Send now" }).click(); await T("Sent ETH");
  if (ethBal(THIEF) - before !== 250_000_000_000_000_000n) throw new Error("thief got " + (ethBal(THIEF) - before));
  const tx = JSON.parse(cast(`block latest --full --json`)).transactions[0];
  if (tx.from.toLowerCase() !== me2.toLowerCase()) throw new Error("tx came from " + tx.from);
});
// Give account 2 pUSDC and protection directly on-chain, so the emergency-PIN test can sweep it later.
cast(`rpc anvil_impersonateAccount ${me2}`);
const as2 = (c) => cast(`send ${c} --from ${me2} --unlocked`);
as2(`${USDC} "mint(address,uint256)" ${me2} 3000000000`); as2(`${USDC} "approve(address,uint256)" ${PUSDC} 3000000000`); as2(`${PUSDC} "deposit(uint256)" 3000000000`);
as2(`${PUSDC} "protect(address,uint256,uint64,uint64,uint64,bool)" ${BACKUP} 100000000 120 120 120 false`);
await step("switch back to account 1: its own balance and address", async () => {
  await page.getByRole("button", { name: "Switch account" }).click();
  await page.getByRole("menuitem", { name: /Account 1/ }).click();
  await tab("Wallet").click();
  await page.getByText("$10,000.00").first().waitFor();
  if ((await state()).address.toLowerCase() !== me1.toLowerCase()) throw new Error("wrong account");
});

console.log("\nSend");
await step("USDC: faucet, validation, then a plain transfer", async () => {
  await page.getByRole("button", { name: "Get 10,000 test USDC" }).click(); await T("10,000 test USDC added");
  await tab("Send").click(); await page.getByRole("radio", { name: "USDC", exact: true }).click();
  await page.getByLabel("To").fill("0x123"); await page.getByText("doesn't look like an address").waitFor();
  await page.getByLabel("To").fill(THIEF); await page.getByLabel("Amount").fill("999999");
  await page.getByText(/is ready to use/).waitFor();
  if (!(await page.getByRole("button", { name: /Send now/ }).isDisabled())) throw new Error("over-balance send enabled");
  await page.getByLabel("Amount").fill("250");
  const before = tokBal(USDC, THIEF);
  await page.getByRole("button", { name: "Send now" }).click(); await T("Sent USDC");
  if (tokBal(USDC, THIEF) - before !== 250n * E6) throw new Error("thief USDC +" + (tokBal(USDC, THIEF) - before));
});
await step("ETH: not enough for amount plus fee is blocked", async () => {
  await tab("Send").click(); await page.getByRole("radio", { name: "ETH" }).click();
  await page.getByLabel("To").fill(THIEF); await page.getByLabel("Amount").fill("100000");
  await page.getByText(/Only .* ETH is ready|Not enough ETH/).waitFor();
  await shot("send-eth");
});

console.log("\nReceive and activity");
await step("receive shows a QR code that decodes to the address", async () => {
  await tab("Wallet").click(); await action("Receive").click();
  const png = PNG.sync.read(await page.getByTestId("qr").screenshot());
  const code = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  if (!code || code.data.toLowerCase() !== me1.toLowerCase()) throw new Error("decoded: " + code?.data);
  await shot("receive");
  await action("Receive").click();
});
await step("incoming transfer appears in Recent activity (direction in) with an explorer link", async () => {
  anySend(`${USDC} "mint(address,uint256)" ${me1} 7000000`);
  await page.reload(); await page.getByText("Total balance").waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="activity-row"]')].some((r) => r.dataset.dir === "in"), null, { timeout: 60000 });
  const href = await page.locator('[data-testid="activity-row"]').first().getAttribute("href");
  if (!/basescan\.org\/tx\/0x[0-9a-f]{64}/i.test(href)) throw new Error("link " + href);
  await shot("home");
});
await step("More → Activity lists the sends with in/out direction", async () => {
  await tab("More").click(); await page.getByText("Transfers and what you've done").first().click();
  await page.getByText("Sent 250 USDC").first().waitFor({ timeout: 60000 });
  await page.getByText("Received 7 USDC").first().waitFor();
  await page.getByText("Wrapped 10,000 USDC").first().waitFor(); // the wrap reads as a wrap, not a send to a contract
  await page.getByText("Added 10,000 pUSDC").first().waitFor();
  await shot("activity");
});

console.log("\nWebsites");
const dapp = await h.ctx.newPage();
await dapp.goto("http://127.0.0.1:8765/");
const approve = async (btn) => { const p = await h.ctx.waitForEvent("page", { timeout: 20000 }); await p.getByRole("button", { name: btn }).click(); return p; };
await step("connect a site, see it listed, approve a transaction with a fee estimate", async () => {
  const r = dapp.evaluate(() => ethereum.request({ method: "eth_requestAccounts" }));
  await approve("Connect");
  if ((await r)[0].toLowerCase() !== me1.toLowerCase()) throw new Error("wrong account connected");
  const data = sh(`cast calldata "approve(address,uint256)" ${PUSDC} 1`);
  const tx = dapp.evaluate(([a, d, t]) => ethereum.request({ method: "eth_sendTransaction", params: [{ from: a, to: t, data: d }] }), [me1, data, USDC]);
  const p = await h.ctx.waitForEvent("page", { timeout: 20000 });
  await p.getByTestId("fee").waitFor(); await p.getByText("≈").first().waitFor();
  await p.getByRole("button", { name: "Approve" }).click();
  if (!/^0x[0-9a-f]{64}$/i.test(await tx)) throw new Error("no tx hash");
});
await step("disconnect from More → Connected sites; the site then sees no accounts", async () => {
  await page.bringToFront(); await page.reload(); await page.getByText("Total balance").waitFor();
  await tab("More").click(); await page.getByText("Connected sites").first().click();
  await page.getByTestId("site").filter({ hasText: "127.0.0.1:8765" }).waitFor();
  await shot("sites");
  await page.getByRole("button", { name: /Disconnect http:\/\/127\.0\.0\.1:8765/ }).click();
  await page.getByText("No sites are connected").waitFor();
  const accts = await dapp.evaluate(() => ethereum.request({ method: "eth_accounts" }));
  if (accts.length) throw new Error("site still sees " + accts);
});

console.log("\nPrivate key");
await step("export needs the password, is hidden until asked, and matches the account", async () => {
  await tab("More").click(); await page.getByText("Security").first().click();
  if (await page.getByTestId("privkey").count()) throw new Error("key visible by default");
  await page.getByLabel("Your password").fill("wrong wrong wrong");
  await page.getByRole("button", { name: /Show private key/ }).click(); await page.getByText("isn't right").first().waitFor();
  await page.getByLabel("Your password").fill(PW);
  await page.getByRole("button", { name: /Show private key/ }).click();
  const key = (await page.getByTestId("privkey").innerText()).trim();
  if (!/^0x[0-9a-f]{64}$/.test(key) || privateKeyToAddress(key).toLowerCase() !== me1.toLowerCase()) throw new Error("key does not match account 1");
  await page.getByRole("button", { name: "Hide" }).click();
  if (await page.getByTestId("privkey").count()) throw new Error("key not hidden");
});

console.log("\nSwap");
await unlocked();
const openSwap = async () => { await tab("Wallet").click(); await action("Swap").click(); await page.getByLabel("Amount to swap").waitFor(); };
await step("button states: enter an amount → insufficient → approve → swap (wrap USDC → pUSDC)", async () => {
  await openSwap();
  await page.getByRole("button", { name: "Enter an amount" }).waitFor();
  await page.getByLabel("Amount to swap").fill("99999999");
  await page.getByRole("button", { name: "Insufficient USDC balance" }).waitFor();
  const dis = await page.getByRole("button", { name: "Insufficient USDC balance" }).isDisabled(); if (!dis) throw new Error("not disabled");
  await page.getByLabel("Amount to swap").fill("500");
  await page.getByTestId("receive").getByText("500").waitFor();
  await page.getByText("Wrap · exactly 1:1").waitFor();
  await page.getByRole("button", { name: "Approve USDC" }).click(); await T("USDC approved");
  const p0 = tokBal(PUSDC, me1), u0 = tokBal(USDC, me1);
  await page.getByRole("button", { name: "Swap", exact: true }).click(); await T("Swapped 500 USDC for pUSDC");
  if (tokBal(PUSDC, me1) - p0 !== 500n * E6 || u0 - tokBal(USDC, me1) !== 500n * E6) throw new Error("1:1 broken");
  await shot("swap");
});
await step("flip: pUSDC → USDC within the daily limit unwraps instantly at 1:1", async () => {
  await openSwap(); await page.getByRole("button", { name: "Switch tokens" }).click();
  await page.getByLabel("Amount to swap").fill("50");
  await page.getByText("Unwrap · exactly 1:1").waitFor();
  const u0 = tokBal(USDC, me1);
  await page.getByRole("button", { name: "Swap", exact: true }).click(); await T("Swapped 50 pUSDC for USDC");
  if (tokBal(USDC, me1) - u0 !== 50n * E6) throw new Error("unwrap off");
});
await step("pUSDC → USDC over the limit is scheduled, not sent", async () => {
  await openSwap(); await page.getByRole("button", { name: "Switch tokens" }).click();
  await page.getByLabel("Amount to swap").fill("300");
  await page.getByText("Unwrap · scheduled").waitFor();
  const u0 = tokBal(USDC, me1), q0 = queued(me1);
  await page.getByRole("button", { name: "Schedule swap" }).click(); await T("Withdrawal scheduled");
  if (tokBal(USDC, me1) !== u0 || queued(me1) === q0) throw new Error("not queued");
});
let swapId;
await step("Uniswap v4 route: terms registered on the scheduler, then executed after the hold", async () => {
  await openSwap(); await page.getByRole("button", { name: "Switch tokens" }).click();
  await page.getByRole("radio", { name: "Uniswap v4" }).click();
  await page.getByLabel("Amount to swap").fill("200");
  await page.getByText("Uniswap v4 · scheduled").waitFor();
  await page.getByRole("radio", { name: "3%" }).click();
  await page.getByRole("button", { name: "Schedule swap" }).click(); await T("Swap scheduled on Uniswap v4");
  const ids = queued(me1).match(/\d+/g).map(BigInt); swapId = ids[ids.length - 1];
  const order = cast(`call ${SCHEDULER} "orderOf(uint256)" ${swapId}`);
  const status = Number(BigInt("0x" + order.slice(2).slice(-64)));
  if (status !== 1) throw new Error("order status " + status + " (expected Registered)");
  warp(130);
  const u0 = tokBal(USDC, me1);
  anySend(`${SCHEDULER} "execute(uint256)" ${swapId}`);
  const got = tokBal(USDC, me1) - u0;
  if (got < 194n * E6 || got > 201n * E6) throw new Error("got " + got + " USDC for 200 pUSDC");
});

console.log("\nEmergency PIN across accounts");
await step("one PIN sweeps every protected account to its backup, then shows the decoy", async () => {
  await unlocked();
  await tab("More").click(); await page.getByText("Security").first().click();
  await page.getByLabel("Your password").fill(PW); await page.getByLabel("New emergency PIN").fill("9999");
  await page.getByRole("button", { name: /Save PIN/ }).click(); await page.getByText("Emergency PIN saved").waitFor();
  const before = tokBal(PUSDC, BACKUP);
  const total = tokBal(PUSDC, me1) + tokBal(PUSDC, me2);
  await page.evaluate(() => chrome.runtime.sendMessage({ t: "lock" })); await page.reload();
  await page.getByLabel("Password").fill("9999"); await page.getByRole("button", { name: "Unlock" }).click();
  await page.getByText("No assets yet").waitFor({ timeout: 120000 });
  const swept = tokBal(PUSDC, BACKUP) - before;
  if (tokBal(PUSDC, me1) !== 0n || tokBal(PUSDC, me2) !== 0n) throw new Error(`left behind: ${tokBal(PUSDC, me1)} / ${tokBal(PUSDC, me2)}`);
  if (swept !== total) throw new Error(`backup got ${swept}, expected ${total}`);
  const st = await state();
  if (st.accounts.length) throw new Error("decoy exposes accounts");
});

dappServer.close();
await h.cleanup();
console.log("\nALL PASSED");
