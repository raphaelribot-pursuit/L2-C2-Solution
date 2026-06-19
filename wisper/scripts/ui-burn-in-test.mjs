/**
 * Connect to Tauri WebView2 via CDP and exercise the Burn-in video button.
 * Requires: WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222
 */
import { chromium } from "playwright";

const CDP = process.env.WISPER_CDP_URL ?? "http://127.0.0.1:9222";
const TITLE = process.env.WISPER_TEST_TITLE ?? "Burn-in UI test";
const TIMEOUT_MS = 120_000;

async function main() {
  const browser = await chromium.connectOverCDP(CDP);
  const context = browser.contexts()[0];
  if (!context) {
    throw new Error("No browser context on CDP endpoint");
  }
  const page = context.pages()[0] ?? (await context.newPage());
  await page.waitForLoadState("domcontentloaded");

  const recordingBtn = page.getByRole("button", { name: new RegExp(TITLE, "i") });
  await recordingBtn.waitFor({ state: "visible", timeout: 30_000 });
  await recordingBtn.click();

  const burnBtn = page.getByRole("button", { name: "Burn-in video" });
  await burnBtn.waitFor({ state: "visible", timeout: 30_000 });
  console.log("PASS: Burn-in video button is visible for video recording");

  await burnBtn.click();
  console.log("Clicked Burn-in video — waiting for save + ffmpeg…");

  const success = page.getByText(/Saved video with burned-in subtitles/i);
  const failure = page.getByText(/Could not burn in subtitles/i);
  const cancelled = page.getByText(/Burn-in cancelled/i);

  const outcome = await Promise.race([
    success.waitFor({ state: "visible", timeout: TIMEOUT_MS }).then(() => "success"),
    failure.waitFor({ state: "visible", timeout: TIMEOUT_MS }).then(() => "failure"),
    cancelled.waitFor({ state: "visible", timeout: TIMEOUT_MS }).then(() => "cancelled"),
  ]);

  if (outcome === "success") {
    const status = await page.locator(".status, [class*='status']").first().textContent().catch(() => "");
    console.log("PASS: Burn-in completed —", (status ?? "").trim());
    await browser.close();
    process.exit(0);
  }

  const errText = await page.locator(".error, [class*='error']").first().textContent().catch(() => "");
  throw new Error(`Burn-in did not succeed (${outcome}). ${errText ?? ""}`.trim());
}

main().catch((err) => {
  console.error("FAIL:", err.message ?? err);
  process.exit(1);
});
