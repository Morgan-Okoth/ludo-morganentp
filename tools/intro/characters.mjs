#!/usr/bin/env node
/**
 * Builds the intro characters from KayKit's Adventurers pack (CC0, Kay Lousberg).
 *
 *   node tools/intro/characters.mjs
 *
 * Downloads the rigged GLBs from KayKit's GitHub release repo, keeps only
 * the animation clips the intro uses, drops weapons and props, and
 * meshopt-compresses the result into public/models/<role>.glb.
 * Clay's image-to-3D meshes are static (no skeleton), so the walking and
 * sitting people come from this CC0 pack instead.
 */
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, meshopt, prune } from "@gltf-transform/functions";
import { MeshoptEncoder } from "meshoptimizer";
import { existsSync } from "node:fs";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const SRC = join(here, "src");
const OUT = join(root, "public", "models");
const BASE =
  "https://raw.githubusercontent.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0/main";

const KEEP_CLIPS = ["Walking_A", "Walking_B", "Sit_Chair_Down", "Sit_Chair_Idle", "Idle", "Unarmed_Idle", "Interact", "Cheer"];

/** role -> source character and the unskinned accessory nodes to keep. */
const ROLES = {
  lady: { from: "Rogue", keep: [] },
  partner: { from: "Mage", keep: ["Mage_Hat"] },
};

async function download(name) {
  const file = join(SRC, `${name}.glb`);
  if (existsSync(file)) return file;
  const url = `${BASE}/addons/kaykit_character_pack_adventures/Characters/gltf/${name}.glb`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

async function main() {
  await mkdir(SRC, { recursive: true });
  await mkdir(OUT, { recursive: true });
  const lic = join(SRC, "LICENSE.txt");
  if (!existsSync(lic)) await writeFile(lic, Buffer.from(await (await fetch(`${BASE}/LICENSE.txt`)).arrayBuffer()));

  await MeshoptEncoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.encoder": MeshoptEncoder });

  for (const [role, cfg] of Object.entries(ROLES)) {
    const doc = await io.read(await download(cfg.from));
    const r = doc.getRoot();
    for (const a of r.listAnimations()) {
      if (KEEP_CLIPS.includes(a.getName())) continue;
      // Dispose samplers too; prune() then drops the keyframe accessors nothing uses.
      // (Accessors are shared between clips, so they must not be disposed directly.)
      for (const s of a.listSamplers()) s.dispose();
      for (const c of a.listChannels()) c.dispose();
      a.dispose();
    }
    for (const n of r.listNodes()) {
      if (n.getMesh() && !n.getSkin() && !cfg.keep.includes(n.getName())) {
        n.getMesh().dispose();
        n.dispose();
      }
    }
    await doc.transform(prune({ keepLeaves: true }), dedup(), meshopt({ encoder: MeshoptEncoder, level: "medium" }));
    const out = join(OUT, `${role}.glb`);
    await writeFile(out, await io.writeBinary(doc));
    const clips = r.listAnimations().map((a) => a.getName());
    console.log(`${role} (${cfg.from}): ${clips.join(", ")} -> ${Math.round((await stat(out)).size / 1024)} KiB`);
  }
  // Same manifest format as tools/clay/generate.mjs: every model the game may load.
  const models = (await readdir(OUT)).filter((f) => f.endsWith(".glb")).map((f) => f.slice(0, -4)).sort();
  await writeFile(join(OUT, "manifest.json"), JSON.stringify({ models }, null, 2) + "\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
