#!/usr/bin/env node
/**
 * Captures frames of the opening scene for review:
 *   node tools/intro/capture.mjs [baseUrl] [outDir] [width] [height]
 */
import { chromium } from "playwright-core";
import { mkdir } from "node:fs/promises";

const base = process.argv[2] ?? "http://localhost:8787";
const out = process.argv[3] ?? "tools/intro/out/frames";
const width = Number(process.argv[4] ?? 1280);
const height = Number(process.argv[5] ?? 720);
await mkdir(out, { recursive: true });

const browser = await chromium.launch({
  channel: process.env.BROWSER_CHANNEL ?? "msedge",
  args: ["--ignore-gpu-blocklist", "--enable-gpu"],
});
const page = await (await browser.newContext({ viewport: { width, height } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await page.goto(base + "/");
await page.waitForFunction(() => document.body.classList.contains("ready"), null, { timeout: 60_000 });
const t0 = Date.now();
for (const t of [0.4, 1.5, 3, 4.5, 5.6, 6.6, 7.8, 9, 10.5, 12.5]) {
  const wait = t * 1000 - (Date.now() - t0);
  if (wait > 0) await page.waitForTimeout(wait);
  await page.screenshot({ path: `${out}/t${String(t).replace(".", "_")}.png` });
}
const menuVisible = await page.locator("#menu:not(.hidden)").count();
console.log(`menu visible after intro: ${menuVisible === 1}`);
await browser.close();
console.log(errors.length ? "errors:\n" + errors.join("\n") : "no page errors");
