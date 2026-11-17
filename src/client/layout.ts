/**
 * Board geometry for an N-arm Ludo board, in board units (1 unit = 1 cell),
 * on the XZ plane. Matches the ring numbering in src/shared/rules.ts.
 *
 * Arm a points along angle theta(a); a regular N-gon of side 3 sits in the
 * middle and a 3x6 arm grows out of each edge. Lanes are -1 (outgoing),
 * 0 (home column) and +1 (incoming, the side facing arm a+1). Cell index 0
 * touches the centre, 5 is at the tip.
 */
import {
  CELLS_PER_ARM,
  COLORS,
  HOME_COLUMN,
  STAR_OFFSET,
  TOKENS_PER_PLAYER,
  type Color,
  armOf,
  finishStep,
  ringLength,
} from "../shared/rules";

export interface P2 {
  x: number;
  z: number;
}

export interface Cell extends P2 {
  arm: number;
  lane: -1 | 0 | 1;
  idx: number;
  /** Rotation (radians around Y) that aligns a square tile with its arm. */
  rot: number;
}

export const ARM_LEN = 6;

export class Layout {
  readonly arms: number;
  /** Distance from centre to each centre-polygon edge. */
  readonly apothem: number;
  /** Distance from centre to each outer board edge. */
  readonly outer: number;
  readonly cornerRadius: number;
  readonly yardDist: number;
  readonly yardRadius = 2.2;

  constructor(arms: number) {
    this.arms = arms;
    const half = Math.PI / arms;
    this.apothem = 1.5 / Math.tan(half);
    this.outer = this.apothem + ARM_LEN + 0.6;
    this.cornerRadius = this.outer / Math.cos(half);
    this.yardDist = (1.5 + this.yardRadius + 0.35) / Math.sin(half);
  }

  theta(arm: number): number {
    // Arm 0 points at the viewer (+Z); arms continue clockwise seen from above.
    return Math.PI / 2 + (arm * 2 * Math.PI) / this.arms;
  }

  dir(arm: number): P2 {
    const t = this.theta(arm);
    return { x: Math.cos(t), z: Math.sin(t) };
  }

  /** Unit vector across the arm, pointing towards arm + 1. */
  perp(arm: number): P2 {
    const t = this.theta(arm);
    return { x: -Math.sin(t), z: Math.cos(t) };
  }

  armCell(arm: number, lane: -1 | 0 | 1, idx: number): Cell {
    const a = ((arm % this.arms) + this.arms) % this.arms;
    const d = this.dir(a);
    const p = this.perp(a);
    const along = this.apothem + idx + 0.5;
    return {
      x: d.x * along + p.x * lane,
      z: d.z * along + p.z * lane,
      arm: a,
      lane,
      idx,
      rot: -this.theta(a),
    };
  }

  /** Ring cell for a ring index (0 .. 13N-1). */
  ringCell(ri: number): Cell {
    const b = Math.floor(ri / CELLS_PER_ARM);
    const off = ri % CELLS_PER_ARM;
    if (off <= 4) return this.armCell(b, 1, 4 - off);
    if (off <= 10) return this.armCell(b + 1, -1, off - 5);
    if (off === 11) return this.armCell(b + 1, 0, 5);
    return this.armCell(b + 1, 1, 5);
  }

  homeCell(color: Color, k: number): Cell {
    return this.armCell(armOf(color), 0, HOME_COLUMN - 1 - k);
  }

  isStar(ri: number): boolean {
    return ri % CELLS_PER_ARM === STAR_OFFSET;
  }

  isEntry(ri: number): boolean {
    return ri % CELLS_PER_ARM === 0;
  }

  ringCells(): Cell[] {
    return Array.from({ length: ringLength(this.arms) }, (_, i) => this.ringCell(i));
  }

  yardCentre(arm: number): P2 {
    const t = this.theta(arm) + Math.PI / this.arms;
    return { x: Math.cos(t) * this.yardDist, z: Math.sin(t) * this.yardDist };
  }

  yardSlot(color: Color, i: number): P2 {
    const c = this.yardCentre(armOf(color));
    const t = this.theta(armOf(color)) + Math.PI / this.arms + Math.PI / 4 + (i * Math.PI) / 2;
    const r = this.yardRadius * 0.48;
    return { x: c.x + Math.cos(t) * r, z: c.z + Math.sin(t) * r };
  }

  /** Corner region (the coloured "yard" area) between arm and arm + 1. */
  yardRegion(arm: number): P2[] {
    const n = this.arms;
    const d0 = this.dir(arm);
    const p0 = this.perp(arm);
    const d1 = this.dir(arm + 1);
    const p1 = this.perp(arm + 1);
    const t = this.theta(arm) + Math.PI / n;
    const vIn = this.apothem / Math.cos(Math.PI / n);
    return [
      { x: Math.cos(t) * vIn, z: Math.sin(t) * vIn },
      { x: d0.x * this.outer + p0.x * 1.5, z: d0.z * this.outer + p0.z * 1.5 },
      { x: Math.cos(t) * this.cornerRadius, z: Math.sin(t) * this.cornerRadius },
      { x: d1.x * this.outer - p1.x * 1.5, z: d1.z * this.outer - p1.z * 1.5 },
    ];
  }

  /** Outer board outline (N-gon whose edges face the arm tips). */
  outline(margin = 0): P2[] {
    const r = (this.outer + margin) / Math.cos(Math.PI / this.arms);
    return Array.from({ length: this.arms }, (_, i) => {
      const t = this.theta(i) + Math.PI / this.arms;
      return { x: Math.cos(t) * r, z: Math.sin(t) * r };
    });
  }

  /** Centre polygon vertices. */
  centre(): P2[] {
    const r = this.apothem / Math.cos(Math.PI / this.arms);
    return Array.from({ length: this.arms }, (_, i) => {
      const t = this.theta(i) + Math.PI / this.arms;
      return { x: Math.cos(t) * r, z: Math.sin(t) * r };
    });
  }

  finishSlot(color: Color, i: number): P2 {
    const d = this.dir(armOf(color));
    const p = this.perp(armOf(color));
    const along = this.apothem * 0.55;
    const lat = (i - (TOKENS_PER_PLAYER - 1) / 2) * 0.32;
    return { x: d.x * along + p.x * lat, z: d.z * along + p.z * lat };
  }

  /** Where a token at a given step stands (before stacking offsets). */
  stepPosition(color: Color, step: number, token: number): P2 {
    const len = ringLength(this.arms);
    if (step <= 0) return this.yardSlot(color, token);
    if (step >= finishStep(this.arms)) return this.finishSlot(color, token);
    if (step >= len) return this.homeCell(color, step - len);
    return this.ringCell((armOf(color) * CELLS_PER_ARM + step - 1) % len);
  }

  /** Stable key of the cell a token occupies, for stacking. */
  cellKey(color: Color, step: number): string {
    const len = ringLength(this.arms);
    if (step <= 0) return `yard:${color}`;
    if (step >= finishStep(this.arms)) return `done:${color}`;
    if (step >= len) return `home:${color}:${step}`;
    return `ring:${(armOf(color) * CELLS_PER_ARM + step - 1) % len}`;
  }
}

export const COLOR_HEX: Record<Color, string> = {
  red: "#D32F2F",
  green: "#388E3C",
  yellow: "#F9A825",
  blue: "#1565C0",
  purple: "#7B1FA2",
  orange: "#EF6C00",
};

export const COLOR_LIGHT: Record<Color, string> = {
  red: "#FFCDD2",
  green: "#C8E6C9",
  yellow: "#FFF59D",
  blue: "#BBDEFB",
  purple: "#E1BEE7",
  orange: "#FFE0B2",
};

export const armColor = (arm: number): Color => COLORS[arm]!;
