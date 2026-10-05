import { chromium } from "playwright-core";
import { mkdir } from "node:fs/promises";

const baseURL = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const chromePath = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const required = ["DEV_ADMIN_EMAIL", "DEV_ADMIN_PASSWORD", "DEV_TEAM_EMAIL", "DEV_TEAM_PASSWORD"];
for (const name of required) if (!process.env[name]) throw new Error(`${name} is required for the browser smoke test`);
await mkdir(".next", { recursive: true });
const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--disable-extensions"] });
try {
  for (const scenario of [
    { role: "admin", email: process.env.DEV_ADMIN_EMAIL, password: process.env.DEV_ADMIN_PASSWORD, path: "/admin", heading: "Overview", viewport: { width: 1440, height: 900 } },
    { role: "team", email: process.env.DEV_TEAM_EMAIL, password: process.env.DEV_TEAM_PASSWORD, path: "/team", heading: "Teams worth watching", viewport: { width: 390, height: 844 } },
  ]) {
    const context = await browser.newContext({ viewport: scenario.viewport, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${baseURL}/login`, { waitUntil: "networkidle" });
    await page.getByLabel("Email or leader registration number").fill(scenario.email);
    await page.getByLabel("Password").fill(scenario.password);
    await page.getByRole("button", { name: /Sign in/ }).click();
    try { await page.waitForURL(`**${scenario.path}`, { timeout: 90_000 }); }
    catch (error) {
      await page.screenshot({ path: `.next/${scenario.role}-login-failed.png`, fullPage: true });
      const alerts = await page.locator("[role=alert]").allTextContents();
      throw new Error(`${scenario.role} login did not complete: ${alerts.join("; ") || String(error)}`);
    }
    await page.getByText(scenario.heading, { exact: false }).first().waitFor();
    await page.screenshot({ path: `.next/${scenario.role}-preview.png`, fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    console.log(`${scenario.role}: loaded; horizontal overflow=${overflow}; page errors=${errors.length}`);
    if (overflow || errors.length) throw new Error(`${scenario.role} browser smoke failed: ${errors.join("; ")}`);
    await context.close();
  }
} finally { await browser.close(); }
