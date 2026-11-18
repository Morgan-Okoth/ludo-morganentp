/**
 * Loads Clay-generated models from /models, falling back to the procedural
 * versions when a file is missing or fails to parse.
 */
import * as THREE from "three";
import { type GLTF, GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { chairGroup, diceCupGeometry, pawnGeometry, trophyGroup } from "./procedural";

export interface Assets {
  /** Unit-height pawn, base centred on the origin. */
  pawn: THREE.BufferGeometry;
  pawnSource: "clay" | "procedural";
  /** Returns a fresh trophy object (keeps Clay materials if present). */
  trophy: () => THREE.Object3D;
  dicecup: () => THREE.Object3D;
  /** Dining chair, 1 unit tall, front facing +Z, seat at CHAIR_SEAT. */
  chair: () => THREE.Object3D;
}

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

let manifest: Promise<string[]> | null = null;
function available(): Promise<string[]> {
  manifest ??= fetch("/models/manifest.json")
    .then((r) => (r.ok ? r.json() : { models: [] }))
    .then((m: { models?: string[] }) => m.models ?? [])
    .catch(() => []);
  return manifest;
}

async function loadFull(name: string): Promise<GLTF | null> {
  const url = `/models/${name}.glb`;
  try {
    if (!(await available()).includes(name)) return null;
    return await loader.loadAsync(url);
  } catch (e) {
    console.warn("model load failed", url, e);
    return null;
  }
}

async function loadGltf(name: string): Promise<THREE.Group | null> {
  return (await loadFull(name))?.scene ?? null;
}

/** A rigged person (Ara 3D Gen / MakeHuman, CC0) with their animation clips. */
export interface Character {
  scene: THREE.Group;
  clips: THREE.AnimationClip[];
}

/** Loads the seated player for a colour from /models/people (metres, feet at y = 0). */
export async function loadPerson(color: string): Promise<Character | null> {
  const g = await loadFull(`people/${color}`);
  if (!g) return null;
  shadowed(g.scene);
  g.scene.traverse((o) => {
    // Skinned meshes move outside their bind-pose bounds while animating.
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) o.frustumCulled = false;
  });
  return { scene: g.scene, clips: g.animations };
}

/** Scales and moves an object so it is `height` tall with its base at y = 0. */
function normalize(obj: THREE.Object3D, height: number): THREE.Object3D {
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const s = height / (size.y || 1);
  const centre = box.getCenter(new THREE.Vector3());
  const wrap = new THREE.Group();
  obj.position.sub(new THREE.Vector3(centre.x, box.min.y, centre.z));
  wrap.add(obj);
  wrap.scale.setScalar(s);
  return wrap;
}

/** Bakes all meshes into one position+normal geometry (we apply our own material). */
function singleGeometry(obj: THREE.Object3D, height: number): THREE.BufferGeometry | null {
  const wrapped = normalize(obj, height);
  wrapped.updateMatrixWorld(true);
  const parts: THREE.BufferGeometry[] = [];
  wrapped.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const g = new THREE.BufferGeometry();
    // meshopt-quantized positions are normalized ints; bake into float32 first.
    const src = m.geometry.getAttribute("position");
    const pos = new Float32Array(src.count * 3);
    for (let i = 0; i < src.count; i++) {
      pos[i * 3] = src.getX(i);
      pos[i * 3 + 1] = src.getY(i);
      pos[i * 3 + 2] = src.getZ(i);
    }
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    if (m.geometry.index) g.setIndex(m.geometry.index.clone());
    g.applyMatrix4(m.matrixWorld);
    parts.push(g.index ? g.toNonIndexed() : g);
  });
  if (!parts.length) return null;
  let merged = mergeGeometries(parts);
  if (!merged) return null;
  merged = mergeVertices(merged, 1e-4);
  merged.computeVertexNormals();
  return merged;
}

function shadowed(obj: THREE.Object3D) {
  obj.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = o.receiveShadow = true;
  });
  return obj;
}

export async function loadAssets(): Promise<Assets> {
  const [pawnScene, trophyScene, cupScene, chairScene] = await Promise.all([
    loadGltf("pawn"),
    loadGltf("trophy"),
    loadGltf("dicecup"),
    loadGltf("chair"),
  ]);
  const chairWood = new THREE.MeshStandardMaterial({ color: "#6b3f1d", roughness: 0.45 });
  const velvet = new THREE.MeshStandardMaterial({ color: "#8e1b2e", roughness: 0.8 });


  const clayPawn = pawnScene ? singleGeometry(pawnScene, 1) : null;
  const fallbackPawn = mergeVertices(pawnGeometry(), 1e-4);
  fallbackPawn.computeVertexNormals();

  const gold = new THREE.MeshPhysicalMaterial({ color: "#d4a017", metalness: 1, roughness: 0.22, clearcoat: 0.6 });
  const leather = new THREE.MeshStandardMaterial({ color: "#5d3418", roughness: 0.75 });

  return {
    pawn: clayPawn ?? fallbackPawn,
    pawnSource: clayPawn ? "clay" : "procedural",
    trophy: () =>
      shadowed(trophyScene ? normalize(trophyScene.clone(true), 1.6) : trophyGroup(gold)),
    dicecup: () =>
      shadowed(cupScene ? normalize(cupScene.clone(true), 1.0) : new THREE.Mesh(diceCupGeometry(), leather)),
    chair: () => {
      if (!chairScene) return shadowed(chairGroup(chairWood, velvet));
      // Clay's chair came back facing -Z (backrest measured at +Z); turn it to face +Z.
      const outer = new THREE.Group();
      const inner = normalize(chairScene.clone(true), 1.0);
      inner.rotation.y = Math.PI;
      outer.add(inner);
      return shadowed(outer);
    },
  };
}
