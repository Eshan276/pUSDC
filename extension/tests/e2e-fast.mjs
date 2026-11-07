// Minute-level deployment: the default Base Sepolia pUSDC has minute minimums, so the wizard offers minutes and the
// "Fast demo" preset; a queued transfer matures after 2 minutes. Also switches to another deployment through the UI.
// Run: npm run test:e2e:fast
import { BACKUP, THIEF, cast, deployToken, start } from "./harness.mjs";
const USDC = "0xC75FDBDb1805528aC07A256aeDEe171d1Da509Be";
let PUSDC;
// Built with the default token (minute-level minimums). A second deployment is switched to from inside the wallet.
const h = await start({ beforeBuild: () => { PUSDC = deployToken(USDC, "60,120,60"); console.log("second deployment:", PUSDC); return {}; } });
const bal = (w) => cast(`call ${PUSDC} "balanceOf(address)(uint256)" ${w}`).split(" ")[0];
const warp = (s) => { cast(`rpc evm_increaseTime ${s}`); cast("rpc evm_mine"); };
const { page, T, step } = h;
const tab = (name) => page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name });

const me = await h.onboard();
await step("default deployment shows minutes; another deployment can be switched to in More → Demo token", async () => {
  await page.getByRole("button", { name: "More" }).click();
  await page.getByText("Demo token").first().click();
  await page.getByText("Minutes (demo)").waitFor();
  await page.getByLabel("Token address").fill("0x0000000000000000000000000000000000000001");
  await page.getByRole("button", { name: "Use this token" }).click();
  await page.getByText("isn't a Protected Wallet token").waitFor();
  await page.getByLabel("Token address").fill(PUSDC);
  await Promise.all([page.waitForEvent("load"), page.getByRole("button", { name: "Use this token" }).click()]);
  const nav = page.getByRole("navigation", { name: "Sections" });
  await nav.getByRole("button", { name: "More" }).click();
  await page.getByText("Demo token").first().click();
  await page.getByText(PUSDC, { exact: false }).first().waitFor();
  await page.getByText("Minutes (demo)").waitFor();
  await nav.getByRole("button", { name: "Wallet" }).click();
});
await step("one-click funding", async () => { await page.getByRole("button", { name: "Get 10,000 test pUSDC" }).click(); await T("10,000 pUSDC added"); });
await step("wizard offers minutes and the Fast demo preset", async () => {
  await page.getByRole("button", { name: "Set up protection" }).first().click();
  await page.getByLabel("Backup wallet address").fill(BACKUP);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: /Next/ }).click();
  await page.getByText("Fast demo").waitFor();
  if (await page.getByText("Everyday").count()) throw new Error("day presets shown in fast mode");
  await page.getByText("Custom", { exact: true }).click();
  await page.getByLabel("Big transfers wait (minutes)").waitFor();
  await page.getByLabel("Big transfers wait (minutes)").fill("0");
  await page.getByText("Choose a whole number of minutes from 1").waitFor();
  await page.getByText("Fast demo").click();
  await page.getByRole("button", { name: /Review/ }).click();
  await page.getByText("2 minutes").first().waitFor();
  await page.getByRole("button", { name: "Turn on protection" }).click();
  await T("Protection is on");
});
await step("over-limit send is scheduled and not completable yet", async () => {
  await tab("Send").click();
  await page.getByLabel("To").fill(THIEF);
  await page.getByLabel("Amount").fill("300");
  await page.getByText("wait 2 minutes").waitFor();
  await page.getByRole("button", { name: "Schedule transfer" }).click();
  await T("Scheduled");
  await tab("Waiting").click();
  await page.getByText(/Ready in 1m|Ready in 2m/).waitFor();
  if (await page.getByRole("button", { name: "Complete" }).count()) throw new Error("completable too early");
});
await step("after 2 minutes it can be completed", async () => {
  warp(125);
  await page.getByRole("button", { name: "Complete" }).waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "Complete" }).click();
  await T("Transfer completed");
  if (bal(THIEF) !== "300000000") throw new Error("thief has " + bal(THIEF));
});
await step("settings page edits in minutes", async () => {
  await page.getByRole("button", { name: "More" }).click();
  await page.getByText("Protection settings").first().click();
  await page.getByText("2 minutes").first().waitFor();
  await page.getByRole("button", { name: "Change" }).nth(1).click();
  await page.getByLabel("New value (minutes)").fill("5");
  await page.getByText("Stricter").first().waitFor();
});
await h.cleanup();
console.log("\nALL PASSED");
