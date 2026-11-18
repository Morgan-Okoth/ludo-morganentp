#!/usr/bin/env node
/**
 * Clay asset pipeline.
 *
 *   npm run clay -- [asset ...] [--regen]      (default: all assets)
 *
 * For each asset:
 *   1. bundle tools/clay/reference.ts and render a reference PNG of the
 *      procedural model in headless Edge/Chrome,
 *   2. send it to Clay's /generate/image-to-3d (TRELLIS-2 on Modal) and keep
 *      the raw result in tools/clay/out/<asset>.raw.glb (reused unless --regen),
 *   3. optimise locally with glTF-Transform: weld, simplify to the triangle
 *      budget, meshopt-compress, and shrink textures to WebP,
 *   4. write public/models/<asset>.glb.
 *
 * Clay's /remesh endpoint is not used: posting a 10 MB mesh as base64 JSON
 * failed, and local meshoptimizer gives the same result faster.
 *
 * Env: CLAY_URL (default: the clay-gpu-backend Modal web endpoint),
 *      BROWSER_CHANNEL (default: msedge; use "chrome" elsewhere).
 */
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, meshopt, prune, simplify, textureCompress, weld } from "@gltf-transform/functions";
import { build } from "esbuild";
import { MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const CLAY_URL = process.env.CLAY_URL ?? "https://stanleyisaac134--clay-gpu-backend.modal.run";
const OUT = join(root, "public", "models");
const WORK = join(here, "out");

/**
 * Triangle budgets keep downloads small for phones. `texture: false` drops
 * the generated texture because the game applies its own material (pawns
 * are tinted per player).
 */
const ASSETS = {
  pawn: { triangles: 8000, texture: false },
  trophy: { triangles: 16000, texture: true },
  dicecup: { triangles: 6000, texture: true },
  chair: { triangles: 12000, texture: true },
};

async function generate(name, pngPath) {
  const image_b64 = (await readFile(pngPath)).toString("base64");
  const t0 = Date.now();
  const res = await fetch(CLAY_URL + "/generate/image-to-3d", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image_b64, format: "glb" }),
    signal: AbortSignal.timeout(30 * 60_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`image-to-3d -> ${res.status}: ${text.slice(0, 300)}`);
  const json = JSON.parse(text);
  if (typeof json.mesh_b64 !== "string") throw new Error("No mesh_b64 in Clay response; keys: " + Object.keys(json).join(", "));
  console.log(`${name}: Clay returned ${json.triangles} triangles in ${Math.round((Date.now() - t0) / 1000)}s`);
  return Buffer.from(json.mesh_b64, "base64");
}

async function renderReferences(names) {
  await build({
    entryPoints: [join(here, "reference.ts")],
    bundle: true,
    format: "iife",
    outfile: join(here, "reference.bundle.js"),
    logLevel: "warning",
  });
  await mkdir(WORK, { recursive: true });
  const browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL ?? "msedge",
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
  const files = {};
  for (const name of names) {
    await page.goto(pathToFileURL(join(here, "reference.html")).href + "?asset=" + name);
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 30_000 });
    files[name] = join(WORK, `${name}.png`);
    await page.locator("canvas").screenshot({ path: files[name] });
    console.log(`${name}: reference ${files[name]}`);
  }
  await browser.close();
  return files;
}

async function optimise(name, raw) {
  const cfg = ASSETS[name];
  await MeshoptSimplifier.ready;
  await MeshoptEncoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.encoder": MeshoptEncoder });
  const doc = await io.readBinary(new Uint8Array(raw));

  const tris = () =>
    doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives()).reduce((n, p) => n + (p.getIndices()?.getCount() ?? 0) / 3, 0);
  const before = tris();

  if (!cfg.texture) {
    for (const m of doc.getRoot().listMaterials()) m.setBaseColorTexture(null);
    for (const p of doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives())) p.setAttribute("TEXCOORD_0", null);
  }

  await doc.transform(
    weld(),
    simplify({ simplifier: MeshoptSimplifier, ratio: Math.min(1, cfg.triangles / before), error: 0.004 }),
    dedup(),
    prune(),
  );
  if (cfg.texture) {
    try {
      const sharp = (await import("sharp")).default;
      await doc.transform(textureCompress({ encoder: sharp, targetFormat: "webp", resize: [1024, 1024] }));
    } catch (e) {
      console.warn(`${name}: texture compression skipped (${e.message})`);
    }
  }
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: "medium" }));
  const out = join(OUT, `${name}.glb`);
  await writeFile(out, await io.writeBinary(doc));
  await updateManifest();
  console.log(`${name}: ${Math.round(before)} -> ${Math.round(tris())} triangles, ${Math.round((await stat(out)).size / 1024)} KiB -> ${out}`);
}

/** public/models/manifest.json lists available models so the game never requests missing ones. */
async function updateManifest() {
  const glbs = async (dir, prefix = "") =>
    existsSync(dir) ? (await readdir(dir)).filter((f) => f.endsWith(".glb")).map((f) => prefix + f.slice(0, -4)) : [];
  // Include people/ (written by tools/people/build.mjs) so neither script drops the other's models.
  const models = [...(await glbs(OUT)), ...(await glbs(join(OUT, "people"), "people/"))].sort();
  await writeFile(join(OUT, "manifest.json"), JSON.stringify({ models }, null, 2) + "\n");
}

async function main() {
  const args = process.argv.slice(2);
  const regen = args.includes("--regen");
  const names = args.filter((a) => !a.startsWith("--"));
  const list = names.length ? names : Object.keys(ASSETS);
  for (const n of list) if (!ASSETS[n]) throw new Error(`Unknown asset ${n}`);
  await mkdir(OUT, { recursive: true });
  await mkdir(WORK, { recursive: true });

  const missing = list.filter((n) => regen || !existsSync(join(WORK, `${n}.raw.glb`)));
  if (missing.length) {
    const health = await (await fetch(CLAY_URL + "/health", { signal: AbortSignal.timeout(15 * 60_000) })).json();
    console.log("clay:", JSON.stringify(health));
    const refs = await renderReferences(missing);
    // One at a time: the backend runs a single A10G.
    for (const name of missing) {
      const raw = await generate(name, refs[name]);
      await writeFile(join(WORK, `${name}.raw.glb`), raw);
    }
  }
  for (const name of list) await optimise(name, await readFile(join(WORK, `${name}.raw.glb`)));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
