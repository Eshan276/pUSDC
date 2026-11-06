// End-to-end test: real Chromium + the built extension + an anvil fork of Base Sepolia.
// Run: npm run test:e2e   (needs foundry's anvil/cast and a Chromium; set CHROME=/path/to/chrome to override detection)
import { chromium } from "playwright-core";
import { execSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, "dist-test");
const PORT = 8550, RPC = `http://127.0.0.1:${PORT}`;
const PUSDC = "0xCabC4016cc24d2A2509552378dE6e232241295a3";
const USDC = "0xC75FDBDb1805528aC07A256aeDEe171d1Da509Be";
const BACKUP = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const THIEF = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const PW = "correct horse 9";
const FOUNDRY = `${homedir()}/.foundry/bin`;
const sh = (c, env = {}) => execSync(c, { cwd: ROOT, env: { ...process.env, PATH: `${FOUNDRY}:${process.env.PATH}`, ...env }, stdio: "pipe" }).toString().trim();
const cast = (a) => sh(`cast ${a} --rpc-url ${RPC}`);
const bal = (who) => cast(`call ${PUSDC} "balanceOf(address)(uint256)" ${who}`).split(" ")[0];
const queued = (who) => cast(`call ${PUSDC} "pendingTransferIds(address)(uint256[])" ${who}`);

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const base = join(homedir(), "Library/Caches/ms-playwright");
  if (existsSync(base)) for (const d of readdirSync(base).filter((x) => /^chromium-\d+$/.test(x)).sort().reverse()) {
    const p = join(base, d, "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
    if (existsSync(p)) return p;
  }
  return undefined; // let playwright find its own
}

let anvil, http, ctx, page, failed = false;
async function cleanup() { try { await ctx?.close(); } catch {} anvil?.kill(); http?.close(); }
async function step(name, fn) {
  try { await fn(); console.log("  ✓", name); }
  catch (e) {
    failed = true; console.log("  ✗", name, "\n   ", e.message.split("\n")[0]);
    try { console.log("    page text:", (await page.locator("body").innerText()).replace(/\n+/g, " | ").slice(0, 400)); } catch {}
    try { await page.screenshot({ path: join(tmpdir(), "pw-e2e-fail.png"), fullPage: true }); console.log("    screenshot:", join(tmpdir(), "pw-e2e-fail.png")); } catch {}
    await cleanup(); process.exit(1);
  }
}

console.log("Starting fork + building test extension…");
anvil = spawn(`${FOUNDRY}/anvil`, ["--fork-url", "https://sepolia.base.org", "--port", String(PORT), "--chain-id", "84532", "--silent"], { stdio: "ignore" });
for (let i = 0; i < 60; i++) { try { cast("block-number"); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }
const env = { VITE_RPC_URL: RPC };
sh(`npx vite build --outDir dist-test --emptyOutDir`, env);
sh(`npx vite build --outDir dist-test`, { ...env, ENTRY: "inpage" });
sh(`npx vite build --outDir dist-test`, { ...env, ENTRY: "content" });

http = createServer((_, res) => res.end("<!doctype html><title>dapp</title><body>dapp</body>")).listen(8765);
const profile = join(tmpdir(), `pw-e2e-${Date.now()}`);
ctx = await chromium.launchPersistentContext(profile, {
  headless: false, executablePath: findChrome(),
  args: ["--headless=new", `--disable-extensions-except=${OUT}`, `--load-extension=${OUT}`],
});
let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent("serviceworker");
const id = sw.url().split("/")[2];
page = await ctx.newPage();
page.on("pageerror", (e) => console.log("   PAGEERR", e.message));
const T = (t) => page.getByText(t, { exact: false }).first().waitFor({ timeout: 60000 });
const state = () => page.evaluate(async () => (await chrome.runtime.sendMessage({ t: "state" })).data);
const lockAndReload = async () => { await page.evaluate(() => chrome.runtime.sendMessage({ t: "lock" })); await page.reload(); };

console.log("\nOnboarding");
await page.goto(`chrome-extension://${id}/popup.html?tab=1`);
await step("intro slides → create wallet → phrase → quiz", async () => {
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: /Get started/ }).click();
  await page.getByText("Create a new wallet").click();
  await page.getByLabel("Password", { exact: true }).fill(PW);
  await page.getByLabel("Repeat password").fill("different");
  await page.getByText("don't match").waitFor();
  await page.getByLabel("Repeat password").fill(PW);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: /Reveal/ }).click();
  const words = await page.locator("ol li span.font-mono").allInnerTexts();
  if (words.length !== 12) throw new Error("expected 12 words");
  await page.getByRole("button", { name: "I wrote it down" }).click();
  const labels = await page.locator("label:has-text('Word #')").allInnerTexts();
  await page.getByLabel(labels[0].trim(), { exact: true }).fill("wrong");
  await page.getByRole("button", { name: "Confirm" }).click();
  await page.getByText("not the word").first().waitFor();
  for (const l of labels) await page.getByLabel(l.trim(), { exact: true }).fill(words[+/#(\d+)/.exec(l)[1] - 1]);
  await page.getByRole("button", { name: "Confirm" }).click();
  await T("Get ready");
});
const me = (await state()).address;
console.log("  wallet:", me);
cast(`rpc anvil_setBalance ${me} 0x56BC75E2D63100000`);
await page.reload();

await step("wrong password refused, right password unlocks", async () => {
  await lockAndReload();
  await page.getByLabel("Password").fill("nope nope nope");
  await page.getByRole("button", { name: "Unlock" }).click();
  await T("isn't right");
  await page.getByLabel("Password").fill(PW);
  await page.getByRole("button", { name: "Unlock" }).click();
  await T("Get ready");
});

console.log("\nMoney and protection");
await step("balance panel shows ETH, flags zero pUSDC, no-ETH warning", async () => {
  await page.getByText("ETH for network fees").first().waitFor();
  await page.getByText("You don't have any pUSDC yet").waitFor();
});
await step("one-click test pUSDC (mint + approve + wrap)", async () => {
  await page.getByRole("button", { name: "Get 10,000 test pUSDC" }).click();
  await T("10,000 pUSDC added");
  if (bal(me) !== "10000000000") throw new Error("balance " + bal(me));
});
await step("protection wizard validates and turns protection on", async () => {
  await page.getByRole("button", { name: "Set up protection" }).first().click();
  await page.getByLabel("Backup wallet address").fill(me);
  await page.getByText("different wallet").waitFor();
  await page.getByLabel("Backup wallet address").fill(BACKUP);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: /Next/ }).click();
  await page.getByRole("button", { name: /Review/ }).click();
  await page.getByRole("button", { name: "Turn on protection" }).click();
  await T("Protection is on");
  await T("You're protected");
});

await page.screenshot({ path: join(tmpdir(), "pw-e2e-wallet.png"), fullPage: true });
console.log("\nSending rules");
await step("small send goes out instantly", async () => {
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.getByLabel("To").fill(THIEF);
  await page.getByLabel("Amount").fill("500");
  await page.getByText("goes out right away").waitFor();
  await page.getByRole("button", { name: "Send now" }).click();
  await T("Sent");
  if (bal(THIEF) !== "500000000") throw new Error("thief has " + bal(THIEF));
});
await step("big send is scheduled, not sent, and can be stopped", async () => {
  await page.getByLabel("To").fill(THIEF);
  await page.getByLabel("Amount").fill("5000");
  await page.getByText("over today's limit").waitFor();
  await page.getByRole("button", { name: "Schedule transfer" }).click();
  await T("Scheduled");
  if (bal(THIEF) !== "500000000") throw new Error("money moved");
  await page.getByRole("button", { name: /Waiting/ }).click();
  await page.getByText("Ready in").waitFor();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await T("Transfer stopped");
  await page.getByText("Nothing is waiting").waitFor();
});
await step("over-balance amount is blocked in the form", async () => {
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.getByLabel("To").fill(THIEF);
  await page.getByLabel("Amount").fill("999999");
  await page.getByText(/is ready to use/).first().waitFor();
  if (!(await page.getByRole("button", { name: /Send now|Schedule transfer/ }).isDisabled())) throw new Error("button enabled");
});
await step("looser setting is delayed, stricter is instant", async () => {
  await page.getByRole("button", { name: "More" }).click();
  await page.getByText("Protection settings").first().click();
  await page.getByRole("button", { name: "Change" }).first().click();
  await page.getByLabel(/New value/).fill("5000");
  await page.getByText("Looser").first().waitFor();
  await page.getByLabel(/New value/).fill("100");
  await page.getByText("Stricter").first().waitFor();
  await page.getByRole("button", { name: "Save" }).click();
  await T("Updated");
  const lim = cast(`call ${PUSDC} "dailyLimitRemaining(address)(uint256)" ${me}`).split(" ")[0];
  if (BigInt(lim) > 100_000000n) throw new Error("limit not lowered: " + lim);
});

console.log("\nWebsites (EIP-1193)");
const dapp = await ctx.newPage();
await dapp.goto("http://127.0.0.1:8765/");
const approve = async (btn) => {
  const p = await ctx.waitForEvent("page", { timeout: 20000 });
  await p.getByRole("button", { name: btn }).click();
  return p;
};
await step("not connected until approved", async () => {
  if ((await dapp.evaluate(() => ethereum.request({ method: "eth_accounts" }))).length) throw new Error("leaked accounts");
  const r = dapp.evaluate(() => ethereum.request({ method: "eth_requestAccounts" }));
  await approve("Connect");
  if ((await r)[0].toLowerCase() !== me.toLowerCase()) throw new Error("wrong account");
});
await step("personal_sign and typed data v4", async () => {
  const s1 = dapp.evaluate((a) => ethereum.request({ method: "personal_sign", params: ["0x68656c6c6f", a] }), me);
  await approve("Sign");
  if ((await s1).length !== 132) throw new Error("bad signature");
  const typed = JSON.stringify({ types: { EIP712Domain: [{ name: "name", type: "string" }], Msg: [{ name: "text", type: "string" }] }, primaryType: "Msg", domain: { name: "T" }, message: { text: "hi" } });
  const s2 = dapp.evaluate(([a, t]) => ethereum.request({ method: "eth_signTypedData_v4", params: [a, t] }), [me, typed]);
  await approve("Sign");
  if ((await s2).length !== 132) throw new Error("bad typed signature");
});
await step("rejecting returns error 4001", async () => {
  const r = dapp.evaluate((a) => ethereum.request({ method: "personal_sign", params: ["0x01", a] }).catch((e) => e.code), me);
  await approve("Reject");
  if ((await r) !== 4001) throw new Error("code " + (await r));
});
await step("dApp transfer over the limit offers 'Schedule it instead'", async () => {
  const data = sh(`cast calldata "transfer(address,uint256)" ${THIEF} 3000000000`);
  const r = dapp.evaluate(([a, d]) => ethereum.request({ method: "eth_sendTransaction", params: [{ from: a, to: "0xCabC4016cc24d2A2509552378dE6e232241295a3", data: d }] }), [me, data]);
  const p = await ctx.waitForEvent("page", { timeout: 20000 });
  await p.getByText("Over your daily limit").waitFor();
  await p.getByRole("button", { name: "Schedule it instead" }).click();
  await r;
  if (bal(THIEF) !== "500000000") throw new Error("money moved");
  if (!/\d/.test(queued(me))) throw new Error("not queued: " + queued(me));
});
await step("plain reads pass through to the network", async () => {
  const n = await dapp.evaluate(() => ethereum.request({ method: "eth_blockNumber" }));
  if (!/^0x[0-9a-f]+$/.test(n)) throw new Error(n);
});

console.log("\nGuard");
await page.bringToFront();
await step("watched wallet shows the queued transfer and it can be stopped", async () => {
  await page.reload();
  await page.getByRole("button", { name: /Guard/ }).click();
  await page.getByLabel("Wallet to watch").fill(me);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByText("Ready in").first().waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "Stop", exact: true }).first().click();
  await T("Transfer stopped");
});

console.log("\nEmergency PIN");
await step("queue a transfer, set PIN, unlock with PIN → sweep + decoy", async () => {
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.getByLabel("To").fill(THIEF);
  await page.getByLabel("Amount").fill("3000");
  await page.getByRole("button", { name: "Schedule transfer" }).click();
  await T("Scheduled");
  await page.getByRole("button", { name: "More" }).click();
  await page.getByText("Security").first().click();
  await page.getByLabel("Your password").fill(PW);
  await page.getByLabel("New emergency PIN").fill("9999");
  await page.getByRole("button", { name: "Save PIN" }).click();
  await page.getByText("Emergency PIN saved").waitFor();
  await lockAndReload();
  await page.getByLabel("Password").fill("9999");
  await page.getByRole("button", { name: "Unlock" }).click();
  await page.getByText("No assets yet").waitFor({ timeout: 90000 });
  if (bal(BACKUP) !== "9500000000") throw new Error("backup has " + bal(BACKUP));
  if (bal(me) !== "0") throw new Error("still holds " + bal(me));
  if (/\d/.test(queued(me))) throw new Error("queued transfer survived the sweep");
});
await step("decoy cannot sign; real password still works", async () => {
  const r = await page.evaluate(() => chrome.runtime.sendMessage({ t: "send", to: "0x0000000000000000000000000000000000000001", data: "0x" }));
  if (r.ok) throw new Error("decoy was able to send");
  await lockAndReload();
  await page.getByLabel("Password").fill(PW);
  await page.getByRole("button", { name: "Unlock" }).click();
  await T("Ready to use");
});
await step("recovery phrase needs the password", async () => {
  await page.getByRole("button", { name: "More" }).click();
  await page.getByText("Security").first().click();
  await page.getByRole("button", { name: "Show phrase" }).waitFor();
  const bad = await page.evaluate(() => chrome.runtime.sendMessage({ t: "reveal", password: "wrong wrong" }));
  if (bad.ok) throw new Error("revealed with wrong password");
});

await cleanup();
rmSync(profile, { recursive: true, force: true });
console.log(failed ? "\nFAILED" : "\nALL PASSED");
