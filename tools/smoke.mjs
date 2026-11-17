#!/usr/bin/env node
/**
 * Browser smoke test against a running `wrangler dev`:
 *   node tools/smoke.mjs [baseUrl] [outDir]
 * Starts local games for every player count with all-AI seats at high speed,
 * takes screenshots, and fails on page errors or games that do not finish.
 * Then plays a 2-browser online game through a room.
 */
import { chromium } from "playwright-core";
import { mkdir } from "node:fs/promises";

const base = process.argv[2] ?? "http://localhost:8787";
const out = process.argv[3] ?? "tools/clay/out/shots";
await mkdir(out, { recursive: true });

const browser = await chromium.launch({
  channel: process.env.BROWSER_CHANNEL ?? "msedge",
  // Hardware GPU by default; SOFTWARE=1 for machines without one (very slow).
  args: process.env.SOFTWARE
    ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
    : ["--ignore-gpu-blocklist", "--enable-gpu", "--autoplay-policy=no-user-gesture-required"],
});
const errors = [];
async function page(name, viewport = { width: 1280, height: 800 }) {
  const p = await (await browser.newContext({ viewport })).newPage();
  p.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
  p.on("console", (m) => {
    if (m.type() === "error") errors.push(`${name} console: ${m.text()}`);
    if (m.text().startsWith("pawn model")) console.log(name, m.text());
  });
  return p;
}

const only = process.env.ONLY;
for (const n of [2, 3, 4, 5, 6]) {
  if (only && !only.split(",").includes(String(n))) continue;
  const p = await page(`local${n}`);
  await p.goto(base + "/");
  await p.waitForFunction(() => document.body.classList.contains("ready"), null, { timeout: 60_000 });
  await p.click(`.pcb[data-n="${n}"]`);
  await p.waitForTimeout(800);
  await p.screenshot({ path: `${out}/menu-${n}.png` });
  await p.click("#startBtn");
  await p.waitForTimeout(2500);
  // Seat 0 is human: roll and pick for a few turns.
  for (let i = 0; i < 12; i++) {
    if (await p.locator("#rollBtn:not([disabled])").count()) await p.click("#rollBtn");
    await p.waitForTimeout(2500);
  }
  await p.screenshot({ path: `${out}/game-${n}.png` });
  const pills = await p.locator(".pill").count();
  console.log(`local ${n}: pills=${pills} msg="${await p.textContent("#msg")}"`);
  await p.close();
}

if (!process.env.NO_FULL) {
  // Full all-AI game at high speed must reach the results screen.
  const p = await page("full");
  await p.goto(base + "/?speed=40");
  await p.waitForFunction(() => document.body.classList.contains("ready"), null, { timeout: 60_000 });
  await p.click('.pcb[data-n="2"]');
  await p.click(".prow .ptype"); // seat 0 -> AI
  await p.click("#startBtn");
  const t0 = Date.now();
  await p.waitForFunction(() => document.getElementById("results").classList.contains("show"), null, { timeout: 240_000 });
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${out}/results.png` });
  console.log(`full game finished in ${Math.round((Date.now() - t0) / 1000)}s: ${(await p.textContent("#ranking")).trim()}`);
  await p.close();
}

if (!process.env.NO_ONLINE) {
  const a = await page("A", { width: 900, height: 900 });
  const b = await page("B", { width: 390, height: 844 });
  await a.goto(base + "/");
  await a.waitForFunction(() => document.body.classList.contains("ready"), null, { timeout: 60_000 });
  await a.click("#openOnline");
  await a.fill("#onName", "Alice");
  await a.click("#onCreate");
  await a.waitForSelector("#roomCode:not(:empty)");
  const code = (await a.textContent("#roomCode")).trim();
  await b.goto(`${base}/?room=${code}`);
  await b.waitForFunction(() => document.body.classList.contains("ready"), null, { timeout: 60_000 });
  await b.fill("#onName", "Bob");
  await b.click("#onJoin");
  await a.waitForFunction(() => document.querySelectorAll("#seats .seat").length === 2);
  for (let i = 0; i < 3; i++) await a.click("#addAiBtn"), await a.waitForTimeout(300);
  await a.waitForFunction(() => document.querySelectorAll("#seats .seat").length === 5);
  await a.screenshot({ path: `${out}/online-lobby.png` });
  await a.click("#startOnlineBtn");
  await Promise.all([a, b].map((p) => p.waitForFunction(() => document.getElementById("hud").classList.contains("show"), null, { timeout: 20_000 })));
  const play = async (p) => {
    for (let i = 0; i < 25; i++) {
      if (await p.locator("#rollBtn:not([disabled])").count()) await p.click("#rollBtn");
      await p.waitForTimeout(1500);
    }
  };
  await Promise.all([play(a), play(b)]);
  await a.screenshot({ path: `${out}/online-a.png` });
  await b.screenshot({ path: `${out}/online-b.png` });
  console.log(`online: code=${code} pillsA=${await a.locator(".pill").count()} msgA="${await a.textContent("#msg")}" msgB="${await b.textContent("#msg")}"`);
}

await browser.close();
console.log(errors.length ? "ERRORS:\n" + errors.slice(0, 20).join("\n") : "no page errors");
process.exit(errors.length ? 1 : 0);
