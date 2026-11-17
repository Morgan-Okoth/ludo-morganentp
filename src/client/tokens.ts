/** 3D pawns: placement with stacking, hop animations, selection glow. */
import * as THREE from "three";
import { TOKENS_PER_PLAYER, type Color } from "../shared/rules";
import { ease, ms, tween } from "./anim";
import { sfx } from "./audio";
import { TILE_TOP } from "./board3d";
import type { Fx } from "./fx";
import { COLOR_HEX, type Layout, type P2 } from "./layout";

const PAWN_H = 0.95;
const YARD_Y = TILE_TOP + 0.12;

export class Pawn {
  readonly group = new THREE.Group();
  readonly body: THREE.Mesh;
  private ring: THREE.Mesh;
  step = 0;
  clickable = false;
  private t = Math.random() * 10;
  baseY = YARD_Y;

  constructor(
    geo: THREE.BufferGeometry,
    readonly color: Color,
    readonly index: number,
  ) {
    const mat = new THREE.MeshPhysicalMaterial({
      color: COLOR_HEX[color],
      roughness: 0.22,
      metalness: 0.05,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
      sheen: 0.3,
    });
    this.body = new THREE.Mesh(geo, mat);
    this.body.scale.setScalar(PAWN_H);
    this.body.castShadow = true;
    this.body.receiveShadow = true;
    this.body.userData.pawn = this;
    this.group.add(this.body);

    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.36, 0.5, 40),
      new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.015;
    this.group.add(this.ring);
  }

  setClickable(on: boolean) {
    this.clickable = on;
  }

  update(dt: number) {
    this.t += dt;
    const mat = this.ring.material as THREE.MeshBasicMaterial;
    const want = this.clickable ? 0.6 + Math.sin(this.t * 6) * 0.35 : 0;
    mat.opacity += (want - mat.opacity) * Math.min(1, dt * 10);
    this.ring.visible = mat.opacity > 0.01;
    if (this.clickable) {
      this.body.position.y = Math.abs(Math.sin(this.t * 4)) * 0.18;
    } else {
      this.body.position.y *= 0.8;
    }
  }
}

export class Pawns {
  readonly all: Pawn[] = [];
  readonly group = new THREE.Group();

  constructor(
    private layout: Layout,
    geo: THREE.BufferGeometry,
    colors: Color[],
    private fx: Fx,
  ) {
    for (const c of colors) {
      for (let i = 0; i < TOKENS_PER_PLAYER; i++) {
        const p = new Pawn(geo, c, i);
        this.all.push(p);
        this.group.add(p.group);
      }
    }
  }

  get(color: Color, i: number): Pawn {
    return this.all.find((p) => p.color === color && p.index === i)!;
  }

  private yFor(step: number) {
    return step === 0 ? YARD_Y : TILE_TOP;
  }

  /** Target positions for every pawn, spreading pawns that share a cell. */
  private targets(): Map<Pawn, { p: P2; scale: number }> {
    const byCell = new Map<string, Pawn[]>();
    for (const p of this.all) {
      const key = p.step === 0 ? `yard:${p.color}:${p.index}` : this.layout.cellKey(p.color, p.step);
      const finished = key.startsWith("done:");
      const k = finished ? `${key}:${p.index}` : key;
      if (!byCell.has(k)) byCell.set(k, []);
      byCell.get(k)!.push(p);
    }
    const out = new Map<Pawn, { p: P2; scale: number }>();
    for (const list of byCell.values()) {
      list.forEach((pawn, i) => {
        const base = this.layout.stepPosition(pawn.color, pawn.step, pawn.index);
        if (list.length === 1) {
          out.set(pawn, { p: base, scale: 1 });
          return;
        }
        const a = (i / list.length) * Math.PI * 2 + Math.PI / 4;
        out.set(pawn, { p: { x: base.x + Math.cos(a) * 0.24, z: base.z + Math.sin(a) * 0.24 }, scale: 0.72 });
      });
    }
    return out;
  }

  /** Puts every pawn at its current step instantly. */
  snapAll() {
    for (const [pawn, t] of this.targets()) {
      pawn.group.position.set(t.p.x, this.yFor(pawn.step), t.p.z);
      pawn.group.scale.setScalar(this.isFinished(pawn) ? 0.6 : t.scale);
    }
  }

  private isFinished(p: Pawn) {
    return this.layout.cellKey(p.color, p.step).startsWith("done:");
  }

  /** Smoothly re-spreads pawns after a move (stacking changes). */
  async settle(skip?: Pawn) {
    const moves: Promise<void>[] = [];
    for (const [pawn, t] of this.targets()) {
      if (pawn === skip) continue;
      const from = pawn.group.position.clone();
      const fromScale = pawn.group.scale.x;
      const toScale = this.isFinished(pawn) ? 0.6 : t.scale;
      const to = new THREE.Vector3(t.p.x, this.yFor(pawn.step), t.p.z);
      if (from.distanceTo(to) < 0.01 && Math.abs(fromScale - toScale) < 0.01) continue;
      moves.push(
        tween(ms(220), (k) => {
          const e = ease.outCubic(k);
          pawn.group.position.lerpVectors(from, to, e);
          pawn.group.scale.setScalar(THREE.MathUtils.lerp(fromScale, toScale, e));
        }),
      );
    }
    await Promise.all(moves);
  }

  private async hop(pawn: Pawn, to: THREE.Vector3, height: number, dur: number) {
    const from = pawn.group.position.clone();
    await tween(ms(dur), (k) => {
      pawn.group.position.lerpVectors(from, to, k);
      pawn.group.position.y += Math.sin(Math.PI * k) * height;
      // Squash and stretch.
      const s = 1 + Math.sin(Math.PI * k) * 0.12;
      pawn.body.scale.set(0.95 / Math.sqrt(s), 0.95 * s, 0.95 / Math.sqrt(s));
    });
    pawn.body.scale.setScalar(0.95);
  }

  /** Animates a pawn from step `from` to step `to`, one hop per cell. */
  async move(color: Color, index: number, from: number, to: number) {
    const pawn = this.get(color, index);
    pawn.group.scale.setScalar(1);
    if (from === 0) {
      pawn.step = 1;
      const p = this.layout.stepPosition(color, 1, index);
      sfx.enter();
      await this.hop(pawn, new THREE.Vector3(p.x, TILE_TOP, p.z), 1.6, 480);
      this.fx.shockwave(new THREE.Vector3(p.x, TILE_TOP + 0.02, p.z), COLOR_HEX[color]);
    } else {
      for (let s = from + 1; s <= to; s++) {
        pawn.step = s;
        const p = this.layout.stepPosition(color, s, index);
        const finished = this.isFinished(pawn);
        sfx.step(s);
        await this.hop(pawn, new THREE.Vector3(p.x, TILE_TOP, p.z), finished ? 1.2 : 0.55, finished ? 420 : 200);
      }
    }
    await this.settle();
  }

  /** Knocked-out pawn flies back to its yard. */
  async capture(color: Color, index: number) {
    const pawn = this.get(color, index);
    const at = pawn.group.position.clone();
    this.fx.burst(at.clone().add(new THREE.Vector3(0, 0.5, 0)), COLOR_HEX[color], 46, 6);
    sfx.capture();
    pawn.step = 0;
    const slot = this.layout.yardSlot(color, index);
    const to = new THREE.Vector3(slot.x, YARD_Y, slot.z);
    const from = pawn.group.position.clone();
    const spinAxis = new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
    await tween(ms(750), (k) => {
      pawn.group.position.lerpVectors(from, to, ease.inOutCubic(k));
      pawn.group.position.y += Math.sin(Math.PI * k) * 4;
      pawn.body.setRotationFromAxisAngle(spinAxis, k * Math.PI * 4);
    });
    pawn.body.rotation.set(0, 0, 0);
    await this.settle();
  }

  update(dt: number) {
    for (const p of this.all) p.update(dt);
  }

  setClickable(color: Color | null, indices: number[]) {
    for (const p of this.all) p.setClickable(p.color === color && indices.includes(p.index));
  }

  pickable(): THREE.Object3D[] {
    return this.all.filter((p) => p.clickable).map((p) => p.body);
  }

  /** Clickable pawns plus their stacked neighbours, for picking forgiveness. */
  nearestClickable(point: THREE.Vector3, maxDist = 0.8): Pawn | null {
    let best: Pawn | null = null;
    let bestD = maxDist;
    for (const p of this.all) {
      if (!p.clickable) continue;
      const d = Math.hypot(p.group.position.x - point.x, p.group.position.z - point.z);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }
}
