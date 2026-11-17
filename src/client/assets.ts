/**
 * Loads Clay-generated models from /models, falling back to the procedural
 * versions when a file is missing or fails to parse.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { diceCupGeometry, pawnGeometry, trophyGroup } from "./procedural";

export interface Assets {
  /** Unit-height pawn, base centred on the origin. */
  pawn: THREE.BufferGeometry;
  pawnSource: "clay" | "procedural";
  /** Returns a fresh trophy object (keeps Clay materials if present). */
  trophy: () => THREE.Object3D;
  dicecup: () => THREE.Object3D;
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

async function loadGltf(name: string): Promise<THREE.Group | null> {
  const url = `/models/${name}.glb`;
  try {
    if (!(await available()).includes(name)) return null;
    const gltf = await loader.loadAsync(url);
    return gltf.scene;
  } catch (e) {
    console.warn("model load failed", url, e);
    return null;
  }
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
  const [pawnScene, trophyScene, cupScene] = await Promise.all([
    loadGltf("pawn"),
    loadGltf("trophy"),
    loadGltf("dicecup"),
  ]);

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
  };
}
