// Not a test: sets up a funded, protected wallet on the fork and saves popup-sized screenshots. Run: node tests/screenshot.mjs
import { BACKUP, THIEF, deployToken, start, cast } from "./harness.mjs";
const USDC = "0xC75FDBDb1805528aC07A256aeDEe171d1Da509Be";
let PUSDC;
const h = await start({ beforeBuild: () => { PUSDC = deployToken(USDC, "60,120,60"); return { VITE_PUSDC: PUSDC }; } });
const { page, T } = h;
const tab = (name) => page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name });
await h.onboard();
await page.getByRole("button", { name: "Get 10,000 test pUSDC" }).click(); await T("10,000 pUSDC added");
await page.getByRole("button", { name: "Set up protection" }).first().click();
await page.getByLabel("Backup wallet address").fill(BACKUP); await page.getByRole("checkbox").check();
await page.getByRole("button", { name: /Next/ }).click(); await page.getByRole("button", { name: /Review/ }).click();
await page.getByRole("button", { name: "Turn on protection" }).click(); await T("Protection is on");
await tab("Send").click(); await page.getByLabel("To").fill(THIEF); await page.getByLabel("Amount").fill("300");
await page.getByRole("button", { name: "Schedule transfer" }).click(); await T("Scheduled");
// popup-sized window: no ?tab=1
await page.setViewportSize({ width: 380, height: 760 });
await page.goto(`chrome-extension://${h.id}/popup.html`); await page.getByRole("button", { name: "Unlock" }).waitFor().then(async () => { await page.getByLabel("Password").fill("correct horse 9"); await page.getByRole("button", { name: "Unlock" }).click(); }).catch(() => {});
await page.getByText("Total balance").waitFor(); await page.waitForTimeout(800);
await page.screenshot({ path: "/private/tmp/claude-501/ext-wallet.png", fullPage: true });
await tab("Waiting").click(); await page.waitForTimeout(600); await page.screenshot({ path: "/private/tmp/claude-501/ext-waiting.png", fullPage: true });
await h.cleanup(); console.log("saved");
