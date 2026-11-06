// Minute-level demo token: protect with the "Fast demo" preset, watch a queued transfer mature after 2 minutes,
// and the daily-limit window reset after 10 minutes. Run: npm run test:e2e:fast
import { BACKUP, THIEF, cast, deployDemoToken, start } from "./harness.mjs";
const USDC = "0xC75FDBDb1805528aC07A256aeDEe171d1Da509Be";
let PUSDC;
const h = await start({ beforeBuild: () => { PUSDC = deployDemoToken(USDC); console.log("demo token:", PUSDC); return { VITE_PUSDC: PUSDC }; } });
const bal = (w) => cast(`call ${PUSDC} "balanceOf(address)(uint256)" ${w}`).split(" ")[0];
const warp = (s) => { cast(`rpc evm_increaseTime ${s}`); cast("rpc evm_mine"); };
const { page, T, step } = h;

const me = await h.onboard();
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
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.getByLabel("To").fill(THIEF);
  await page.getByLabel("Amount").fill("300");
  await page.getByText("wait 2 minutes").waitFor();
  await page.getByRole("button", { name: "Schedule transfer" }).click();
  await T("Scheduled");
  await page.getByRole("button", { name: /Waiting/ }).click();
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
await step("daily limit resets after 10 minutes", async () => {
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.getByLabel("To").fill(THIEF);
  await page.getByLabel("Amount").fill("100");
  await page.getByRole("button", { name: "Send now" }).click();
  await T("Sent");
  await page.getByLabel("Amount").fill("100");
  await page.getByText("over today's limit").waitFor(); // window used up
  warp(11 * 60);
  await page.getByText("goes out right away").waitFor({ timeout: 30000 });
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
