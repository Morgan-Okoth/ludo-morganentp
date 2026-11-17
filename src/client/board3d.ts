/** Builds the 3D board for any arm count from the Layout geometry. */
import * as THREE from "three";
import { ringLength } from "../shared/rules";
import { COLOR_HEX, COLOR_LIGHT, type Layout, type P2, armColor } from "./layout";
import { textTexture, woodTexture } from "./textures";

/** Height of the playing surface above the board origin. */
export const SURFACE_Y = 0.42;
const TILE_H = 0.05;
export const TILE_TOP = SURFACE_Y + TILE_H;

function shapeOf(points: P2[]): THREE.Shape {
  // Shapes live in XY; after rotateX(-90deg), shape y becomes world -z.
  const s = new THREE.Shape();
  points.forEach((p, i) => (i === 0 ? s.moveTo(p.x, -p.z) : s.lineTo(p.x, -p.z)));
  s.closePath();
  return s;
}

function flatSlab(points: P2[], depth: number, material: THREE.Material, bevel = 0, hole?: P2[]): THREE.Mesh {
  const shape = shapeOf(points);
  if (hole) shape.holes.push(new THREE.Path(shapeOf(hole).getPoints()));
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelSize: bevel,
    bevelThickness: bevel,
    bevelSegments: 3,
    curveSegments: 24,
  });
  geo.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, material);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function starShape(outer: number, inner: number): THREE.Shape {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = Math.PI / 2 + (i * Math.PI) / 5;
    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  s.closePath();
  return s;
}

export interface BoardMeshes {
  group: THREE.Group;
  /** Per-arm highlight ring around the yard, pulsed on that player's turn. */
  yardGlow: THREE.Mesh[];
}

export function buildBoard(layout: Layout): BoardMeshes {
  const group = new THREE.Group();
  const n = layout.arms;

  // Frame and base.
  const frameWood = woodTexture("#7a3a0c", "#2d1200", 11);
  frameWood.repeat.set(0.08, 0.08);
  const frameMat = new THREE.MeshStandardMaterial({ map: frameWood, roughness: 0.55, metalness: 0.05 });
  // The frame rim stands 0.08 above the playing surface, like a tray lip.
  const frame = flatSlab(layout.outline(1.15), SURFACE_Y, frameMat, 0.08, layout.outline(0.12));
  frame.position.y = 0.08;
  group.add(frame);
  // Solid base under the playing surface.
  const base = flatSlab(layout.outline(0.2), SURFACE_Y - 0.06, frameMat);
  group.add(base);

  const surfaceMat = new THREE.MeshStandardMaterial({ color: "#f5e6c8", roughness: 0.85 });
  const surface = flatSlab(layout.outline(0.12), 0.06, surfaceMat);
  surface.position.y = SURFACE_Y - 0.055;
  group.add(surface);

  // Coloured yard corners.
  const yardGlow: THREE.Mesh[] = [];
  for (let a = 0; a < n; a++) {
    const color = armColor(a);
    const mat = new THREE.MeshStandardMaterial({ color: COLOR_HEX[color], roughness: 0.6 });
    const region = flatSlab(layout.yardRegion(a), 0.03, mat);
    region.position.y = SURFACE_Y;
    group.add(region);

    const c = layout.yardCentre(a);
    const tray = new THREE.Mesh(
      new THREE.CylinderGeometry(layout.yardRadius, layout.yardRadius * 1.04, 0.1, 64),
      new THREE.MeshStandardMaterial({ color: "#fafafa", roughness: 0.4 }),
    );
    tray.position.set(c.x, SURFACE_Y + 0.08, c.z);
    tray.castShadow = tray.receiveShadow = true;
    group.add(tray);

    const glow = new THREE.Mesh(
      new THREE.TorusGeometry(layout.yardRadius + 0.08, 0.06, 12, 96),
      new THREE.MeshBasicMaterial({ color: COLOR_HEX[color], transparent: true, opacity: 0 }),
    );
    glow.rotation.x = Math.PI / 2;
    glow.position.set(c.x, SURFACE_Y + 0.14, c.z);
    group.add(glow);
    yardGlow.push(glow);

    for (let i = 0; i < 4; i++) {
      const slot = layout.yardSlot(color, i);
      const cup = new THREE.Mesh(
        new THREE.CylinderGeometry(0.42, 0.42, 0.04, 40),
        new THREE.MeshStandardMaterial({ color: COLOR_HEX[color], roughness: 0.5 }),
      );
      cup.position.set(slot.x, SURFACE_Y + 0.15, slot.z);
      cup.receiveShadow = true;
      group.add(cup);
    }
  }

  // Track tiles, as one instanced mesh with per-tile colour.
  const len = ringLength(n);
  const tiles = len + n * 5;
  const tileGeo = new THREE.BoxGeometry(0.94, TILE_H, 0.94);
  const tileMat = new THREE.MeshStandardMaterial({ roughness: 0.55 });
  const inst = new THREE.InstancedMesh(tileGeo, tileMat, tiles);
  inst.receiveShadow = true;
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const yAxis = new THREE.Vector3(0, 1, 0);
  const col = new THREE.Color();
  let k = 0;
  const place = (x: number, z: number, rot: number, color: string) => {
    q.setFromAxisAngle(yAxis, rot);
    m4.compose(new THREE.Vector3(x, SURFACE_Y + TILE_H / 2, z), q, new THREE.Vector3(1, 1, 1));
    inst.setMatrixAt(k, m4);
    inst.setColorAt(k, col.set(color));
    k++;
  };
  const starMat = new THREE.MeshStandardMaterial({ color: "#FF8F00", roughness: 0.3, metalness: 0.4 });
  const starGeo = new THREE.ExtrudeGeometry(starShape(0.34, 0.15), { depth: 0.03, bevelEnabled: false });
  starGeo.rotateX(-Math.PI / 2);

  for (let ri = 0; ri < len; ri++) {
    const cell = layout.ringCell(ri);
    const entryOf = layout.isEntry(ri) ? armColor(Math.floor(ri / 13)) : null;
    place(cell.x, cell.z, cell.rot, entryOf ? COLOR_HEX[entryOf] : "#fafafa");
    if (layout.isStar(ri) || entryOf) {
      const star = new THREE.Mesh(starGeo, entryOf ? new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.3 }) : starMat);
      star.position.set(cell.x, TILE_TOP + 0.001, cell.z);
      star.rotation.y = cell.rot;
      group.add(star);
    }
  }
  for (let a = 0; a < n; a++) {
    const color = armColor(a);
    for (let s = 0; s < 5; s++) {
      const cell = layout.homeCell(color, s);
      place(cell.x, cell.z, cell.rot, s === 4 ? COLOR_HEX[color] : COLOR_LIGHT[color]);
    }
    // Arrow on the arm tip pointing into the home column.
    const tip = layout.armCell(a, 0, 5);
    const arrow = new THREE.Mesh(
      new THREE.ConeGeometry(0.22, 0.5, 3),
      new THREE.MeshStandardMaterial({ color: COLOR_HEX[color], roughness: 0.4 }),
    );
    const d = layout.dir(a);
    arrow.position.set(tip.x, TILE_TOP + 0.03, tip.z);
    arrow.rotation.set(Math.PI / 2, 0, 0);
    arrow.rotateOnWorldAxis(yAxis, Math.atan2(-d.x, -d.z));
    arrow.scale.set(1, 1, 0.12);
    group.add(arrow);
  }
  inst.instanceMatrix.needsUpdate = true;
  if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
  group.add(inst);

  // Centre: one raised triangle per arm, meeting at a gold cap.
  const centre = layout.centre();
  const peak = 0.55;
  for (let a = 0; a < n; a++) {
    const v1 = centre[(a - 1 + n) % n]!;
    const v2 = centre[a]!;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(
        [0, SURFACE_Y + peak, 0, v2.x, SURFACE_Y + 0.02, v2.z, v1.x, SURFACE_Y + 0.02, v1.z],
        3,
      ),
    );
    geo.computeVertexNormals();
    const tri = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ color: COLOR_HEX[armColor(a)], roughness: 0.45, side: THREE.DoubleSide }),
    );
    tri.castShadow = tri.receiveShadow = true;
    group.add(tri);
  }
  const cap = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 24, 16),
    new THREE.MeshStandardMaterial({ color: "#FFD700", metalness: 1, roughness: 0.2 }),
  );
  cap.position.y = SURFACE_Y + peak;
  group.add(cap);

  // Engraved "MORGAN OKOTH" on every frame edge.
  const tex = textTexture("✦ MORGAN OKOTH ✦");
  const outline = layout.outline(0.62);
  for (let i = 0; i < n; i++) {
    const p1 = outline[i]!;
    const p2 = outline[(i + 1) % n]!;
    const mid = { x: (p1.x + p2.x) / 2, z: (p1.z + p2.z) / 2 };
    const edgeLen = Math.hypot(p2.x - p1.x, p2.z - p1.z);
    const w = Math.min(edgeLen * 0.62, 9);
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(w, w / 10.7),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
    );
    plane.rotation.x = -Math.PI / 2;
    // Text baseline faces outward so it reads from that side of the table.
    const outward = Math.atan2(mid.x, mid.z);
    plane.rotation.z = outward;
    plane.position.set(mid.x, SURFACE_Y + 0.165, mid.z);
    group.add(plane);
  }

  return { group, yardGlow };
}
