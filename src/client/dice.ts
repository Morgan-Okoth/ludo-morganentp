/** 3D die: rounded cube with pip faces, thrown and landed on a given value. */
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { ease, ms, tween } from "./anim";
import { sfx } from "./audio";
import { pipTexture } from "./textures";

/** Box face order is +x, -x, +y, -y, +z, -z; opposite faces sum to 7. */
const FACE_VALUES = [3, 4, 1, 6, 2, 5];
const FACE_NORMALS: Record<number, THREE.Vector3> = {
  3: new THREE.Vector3(1, 0, 0),
  4: new THREE.Vector3(-1, 0, 0),
  1: new THREE.Vector3(0, 1, 0),
  6: new THREE.Vector3(0, -1, 0),
  2: new THREE.Vector3(0, 0, 1),
  5: new THREE.Vector3(0, 0, -1),
};
const UP = new THREE.Vector3(0, 1, 0);

export class Die {
  readonly mesh: THREE.Mesh;
  readonly size = 0.85;
  private glow: THREE.Mesh;
  private idleT = 0;
  rolling = false;
  /** Pulses when the local player may roll. */
  ready = false;

  constructor(scene: THREE.Object3D) {
    const mats = FACE_VALUES.map(
      (v) => new THREE.MeshPhysicalMaterial({ map: pipTexture(v), roughness: 0.25, clearcoat: 0.8, clearcoatRoughness: 0.15 }),
    );
    this.mesh = new THREE.Mesh(new RoundedBoxGeometry(this.size, this.size, this.size, 5, 0.12), mats);
    this.mesh.castShadow = true;
    this.mesh.name = "die";
    scene.add(this.mesh);

    this.glow = new THREE.Mesh(
      new THREE.RingGeometry(0.62, 0.8, 48),
      new THREE.MeshBasicMaterial({ color: "#FFD700", transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.glow.rotation.x = -Math.PI / 2;
    scene.add(this.glow);
  }

  /** Orientation that shows `value` on top, with a yaw so it faces the viewer nicely. */
  static orientation(value: number, yaw: number): THREE.Quaternion {
    const q = new THREE.Quaternion().setFromUnitVectors(FACE_NORMALS[value]!, UP);
    return new THREE.Quaternion().setFromAxisAngle(UP, yaw).multiply(q);
  }

  place(at: THREE.Vector3, value: number, yaw = 0) {
    this.mesh.position.set(at.x, at.y + this.size / 2, at.z);
    this.mesh.quaternion.copy(Die.orientation(value, yaw));
  }

  setGlowColor(c: THREE.ColorRepresentation) {
    (this.glow.material as THREE.MeshBasicMaterial).color.set(c);
  }

  /** Throws the die from `from` (in the air) to land on `to` (table level) showing `value`. */
  async roll(from: THREE.Vector3, to: THREE.Vector3, value: number, yaw: number): Promise<void> {
    this.rolling = true;
    this.ready = false;
    sfx.diceShake();
    const half = this.size / 2;
    const start = new THREE.Quaternion().random();
    const axis = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    const turns = 3 + Math.random() * 2;
    const target = Die.orientation(value, yaw);
    const spin = new THREE.Quaternion();
    const tmp = new THREE.Quaternion();
    const hits = new Set<number>();
    const height = from.y - to.y;

    await tween(ms(1300), (t) => {
      const h = ease.outCubic(t);
      this.mesh.position.x = THREE.MathUtils.lerp(from.x, to.x, h);
      this.mesh.position.z = THREE.MathUtils.lerp(from.z, to.z, h);
      // Decaying bounces: zeros of cos(2.5 pi t) are the impacts.
      const bounce = Math.abs(Math.cos(2.5 * Math.PI * t)) * Math.pow(1 - t, 2);
      const y0 = t < 0.2 ? Math.pow(1 - t / 0.2, 2) * height : bounce * height * 0.55;
      this.mesh.position.y = to.y + half + Math.max(0, y0);
      for (const [i, at] of [[0, 0.2], [1, 0.6], [2, 1.0]] as const) {
        if (t >= at - 0.02 && !hits.has(i)) {
          hits.add(i);
          sfx.diceHit(1 - i * 0.3);
        }
      }
      spin.setFromAxisAngle(axis, turns * Math.PI * 2 * ease.outCubic(t));
      tmp.copy(spin).multiply(start);
      this.mesh.quaternion.slerpQuaternions(tmp, target, ease.smooth(0.55, 1, t));
    });
    this.mesh.quaternion.copy(target);
    this.rolling = false;
  }

  update(dt: number) {
    this.idleT += dt;
    const mat = this.glow.material as THREE.MeshBasicMaterial;
    const want = this.ready && !this.rolling ? 0.55 + Math.sin(this.idleT * 4) * 0.3 : 0;
    mat.opacity += (want - mat.opacity) * Math.min(1, dt * 8);
    this.glow.position.set(this.mesh.position.x, this.mesh.position.y - this.size / 2 + 0.01, this.mesh.position.z);
    this.glow.visible = mat.opacity > 0.01;
  }
}
