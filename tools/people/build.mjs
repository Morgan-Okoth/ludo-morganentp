#!/usr/bin/env node
/**
 * Builds the seated players: one realistic person per seat colour.
 *
 *   node tools/people/build.mjs [--regen]
 *
 * Characters come from Ara 3D Gen (`npx ara3d`, MIT tool) which builds them
 * from CC0 MakeHuman data; the walk and chair clips are CMU motion capture
 * (free to use in products, acknowledgement in public/models/CREDITS.md).
 * The raw exports (tools/people/raw, git-ignored) are shrunk here: textures
 * to 512 px WebP (people are seen from across the table), meshes meshopt-compressed,
 * clips renamed to short ids. Output: public/models/people/<colour>.glb.
 */
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, meshopt, prune, textureCompress } from "@gltf-transform/functions";
import { MeshoptEncoder } from "meshoptimizer";
import sharp from "sharp";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const RAW = join(here, "raw");
const MODELS = join(root, "public", "models");
const OUT = join(MODELS, "people");

/** Seat colour -> Ara 3D Gen preset. Yellow is the lady who walks in during the intro (she sits opposite red). */
export const CAST = {
  red: "Athletic man",
  green: "Elder",
  yellow: "Businesswoman",
  blue: "Athletic woman",
  purple: "Teen",
  orange: "Detective",
};

/** The colour whose person walks in during the intro. */
const LADY = "yellow";
const CLIPS = ["walk", "idle", "sit_down", "sit_idle", "stand_up", "cheer", "clap", "wave"];
/** Ara 3D Gen clip names -> the short ids the game uses. */
const RENAME = {
  Walk: "walk",
  Idle: "idle",
  "Sit down (chair)": "sit_down",
  "Sit idle (chair)": "sit_idle",
  "Stand up (chair)": "stand_up",
  Cheer: "cheer",
  Clap: "clap",
  Wave: "wave",
};

/** ara3d writes spaces in preset names as underscores. */
const rawFile = (preset) => join(RAW, `${preset.replace(/ /g, "_")}.glb`);

function exportRaw(presets) {
  const args = ["-y", "ara3d", "export", "--detail", "low", "--animations", CLIPS.join(","), "--out", RAW];
  // Windows runs npx through a shell, which would split "Athletic man" in two.
  const q = (s) => (process.platform === "win32" ? `"${s}"` : s);
  for (const p of presets) args.push("--preset", q(p));
  execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", args, { stdio: "inherit", shell: process.platform === "win32" });
}

async function main() {
  const regen = process.argv.includes("--regen");
  await mkdir(RAW, { recursive: true });
  await mkdir(OUT, { recursive: true });
  const missing = Object.values(CAST).filter((p) => regen || !existsSync(rawFile(p)));
  if (missing.length) exportRaw(missing);

  await MeshoptEncoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.encoder": MeshoptEncoder });
  for (const [color, preset] of Object.entries(CAST)) {
    const doc = await io.read(rawFile(preset));
    // Seated players only ever play sit_idle; the lady also walks in and sits down.
    const keep = color === LADY ? ["walk", "idle", "sit_down", "sit_idle"] : ["sit_idle"];
    for (const a of doc.getRoot().listAnimations()) {
      a.setName(RENAME[a.getName()] ?? a.getName());
      if (keep.includes(a.getName())) continue;
      for (const s of a.listSamplers()) s.dispose();
      for (const c of a.listChannels()) c.dispose();
      a.dispose();
    }
    // Closed mouths: teeth and tongue are never visible.
    for (const mesh of doc.getRoot().listMeshes()) {
      for (const prim of mesh.listPrimitives()) {
        if (/teeth|tongue/i.test(prim.getMaterial()?.getName() ?? "")) prim.dispose();
      }
    }
    await doc.transform(
      dedup(),
      prune(),
      textureCompress({ encoder: sharp, targetFormat: "webp", resize: [512, 512], quality: 85 }),
      textureCompress({ encoder: sharp, targetFormat: "webp", resize: [128, 128], pattern: /eyelash|eyebrow/i }),
      meshopt({ encoder: MeshoptEncoder, level: "medium" }),
    );
    const out = join(OUT, `${color}.glb`);
    await writeFile(out, await io.writeBinary(doc));
    const clips = doc.getRoot().listAnimations().map((a) => a.getName());
    console.log(`${color}: ${preset} [${clips.join(", ")}] -> ${Math.round((await stat(out)).size / 1024)} KiB`);
  }

  // Keep public/models/manifest.json in step (same format as tools/clay/generate.mjs).
  const top = (await readdir(MODELS)).filter((f) => f.endsWith(".glb")).map((f) => f.slice(0, -4));
  const people = (await readdir(OUT)).filter((f) => f.endsWith(".glb")).map((f) => `people/${f.slice(0, -4)}`);
  await writeFile(join(MODELS, "manifest.json"), JSON.stringify({ models: [...top, ...people].sort() }, null, 2) + "\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
