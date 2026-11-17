/**
 * Renders a clean reference image of one procedural model for Clay's
 * image-to-3D endpoint. Opened by tools/clay/generate.mjs in a headless
 * browser as reference.html?asset=<name>; sets window.__ready when drawn.
 */
import * as THREE from "three";
import { diceCupGeometry, pawnGeometry, trophyGroup } from "../../src/client/procedural";

const asset = new URLSearchParams(location.search).get("asset") ?? "pawn";
const size = 1024;

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(size, size);
renderer.setPixelRatio(1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color("#ffffff");
scene.add(new THREE.HemisphereLight("#ffffff", "#bbbbbb", 1.6));
const key = new THREE.DirectionalLight("#ffffff", 2.4);
key.position.set(3, 5, 4);
scene.add(key);
const rim = new THREE.DirectionalLight("#ffffff", 1.2);
rim.position.set(-4, 3, -3);
scene.add(rim);

const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
const obj = new THREE.Group();

if (asset === "pawn") {
  const m = new THREE.MeshStandardMaterial({ color: "#c62828", roughness: 0.25, metalness: 0.05 });
  obj.add(new THREE.Mesh(pawnGeometry(), m));
} else if (asset === "trophy") {
  const m = new THREE.MeshStandardMaterial({ color: "#d4a017", roughness: 0.25, metalness: 0.9 });
  obj.add(trophyGroup(m));
} else if (asset === "dicecup") {
  // Lighter leather than in game: the dark version timed out on Clay twice.
  const m = new THREE.MeshStandardMaterial({ color: "#b0703a", roughness: 0.6 });
  obj.add(new THREE.Mesh(diceCupGeometry(), m));
}
scene.add(obj);

// Frame the object: three-quarter view from slightly above.
const box = new THREE.Box3().setFromObject(obj);
const centre = box.getCenter(new THREE.Vector3());
const radius = box.getBoundingSphere(new THREE.Sphere()).radius;
const dist = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.15;
camera.position.copy(centre).add(new THREE.Vector3(0.55, 0.45, 1).normalize().multiplyScalar(dist));
camera.lookAt(centre);

renderer.render(scene, camera);
(window as unknown as { __ready: boolean }).__ready = true;
