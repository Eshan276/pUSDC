// Shared test harness: anvil fork of Base Sepolia + a built test extension + real Chromium.
import { chromium } from "playwright-core";
import { execSync, spawn } from "node:child_process";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const ROOT = resolve(import.meta.dirname, "..");
export const PORT = 8550, RPC = `http://127.0.0.1:${PORT}`;
export const FOUNDRY = `${homedir()}/.foundry/bin`;
export const PW = "correct horse 9";
export const BACKUP = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
export const THIEF = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const ANVIL_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
export const sh = (c, env = {}, cwd = ROOT) => execSync(c, { cwd, env: { ...process.env, PATH: `${FOUNDRY}:${process.env.PATH}`, ...env }, stdio: "pipe" }).toString().trim();
export const cast = (a) => sh(`cast ${a} --rpc-url ${RPC}`);

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const base = join(homedir(), "Library/Caches/ms-playwright");
  if (existsSync(base)) for (const d of readdirSync(base).filter((x) => /^chromium-\d+$/.test(x)).sort().reverse()) {
    const p = join(base, d, "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
    if (existsSync(p)) return p;
  }
}

/** Deploys the minute-level demo token on the fork and returns its address. */
export function deployDemoToken(usdc) {
  const out = sh(`forge create src/demo/DemoFastProtectedWrapper.sol:DemoFastProtectedWrapper --rpc-url ${RPC} --private-key ${ANVIL_KEY} --broadcast --constructor-args ${usdc} "Demo Protected USDC (fast)" dpUSDC`, {}, resolve(ROOT, ".."));
  return /Deployed to: (0x[0-9a-fA-F]{40})/.exec(out)[1];
}

export async function start({ buildEnv = {}, beforeBuild } = {}) {
  const h = { failed: false };
  h.anvil = spawn(`${FOUNDRY}/anvil`, ["--fork-url", "https://sepolia.base.org", "--port", String(PORT), "--chain-id", "84532", "--silent"], { stdio: "ignore" });
  for (let i = 0; i < 60; i++) { try { cast("block-number"); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }
  const extra = (await beforeBuild?.()) ?? {};
  const env = { VITE_RPC_URL: RPC, ...buildEnv, ...extra };
  const out = join(ROOT, "dist-test");
  sh(`npx vite build --outDir dist-test --emptyOutDir`, env);
  sh(`npx vite build --outDir dist-test`, { ...env, ENTRY: "inpage" });
  sh(`npx vite build --outDir dist-test`, { ...env, ENTRY: "content" });
  h.profile = join(tmpdir(), `pw-e2e-${Date.now()}`);
  h.ctx = await chromium.launchPersistentContext(h.profile, {
    headless: false, executablePath: findChrome(),
    args: ["--headless=new", `--disable-extensions-except=${out}`, `--load-extension=${out}`],
  });
  let [sw] = h.ctx.serviceWorkers(); if (!sw) sw = await h.ctx.waitForEvent("serviceworker");
  h.id = sw.url().split("/")[2];
  h.page = await h.ctx.newPage();
  h.page.on("pageerror", (e) => console.log("   PAGEERR", e.message));
  h.T = (t) => h.page.getByText(t, { exact: false }).first().waitFor({ timeout: 60000 });
  h.state = () => h.page.evaluate(async () => (await chrome.runtime.sendMessage({ t: "state" })).data);
  h.cleanup = async () => { try { await h.ctx.close(); } catch {} h.anvil.kill(); rmSync(h.profile, { recursive: true, force: true }); };
  h.step = async (name, fn) => {
    try { await fn(); console.log("  ✓", name); }
    catch (e) {
      h.failed = true; console.log("  ✗", name, "\n   ", e.message.split("\n")[0]);
      try { console.log("    page text:", (await h.page.locator("body").innerText()).replace(/\n+/g, " | ").slice(0, 400)); } catch {}
      try { await h.page.screenshot({ path: join(tmpdir(), "pw-e2e-fail.png"), fullPage: true }); } catch {}
      await h.cleanup(); process.exit(1);
    }
  };
  h.onboard = async () => {
    await h.page.goto(`chrome-extension://${h.id}/popup.html?tab=1`);
    await h.page.getByRole("button", { name: "Skip intro" }).click();
    await h.page.getByText("Create a new wallet").click();
    await h.page.getByLabel("Password", { exact: true }).fill(PW);
    await h.page.getByLabel("Repeat password").fill(PW);
    await h.page.getByRole("checkbox").check();
    await h.page.getByRole("button", { name: "Continue" }).click();
    await h.page.getByRole("button", { name: /Reveal/ }).click();
    const words = await h.page.locator("ol li span.font-mono").allInnerTexts();
    await h.page.getByRole("button", { name: "I wrote it down" }).click();
    for (const l of await h.page.locator("label:has-text('Word #')").allInnerTexts()) await h.page.getByLabel(l.trim(), { exact: true }).fill(words[+/#(\d+)/.exec(l)[1] - 1]);
    await h.page.getByRole("button", { name: "Confirm" }).click();
    await h.T("Get ready");
    const me = (await h.state()).address;
    cast(`rpc anvil_setBalance ${me} 0x56BC75E2D63100000`);
    await h.page.reload();
    return me;
  };
  return h;
}
