/**
 * The room around the table: plank floor, rug, papered walls with wood
 * panelling, a door the lady walks in through, and writing on the walls
 * (the "Stanl3y" neon, "LUDO ARENA", "MORGANENTP", a chalkboard of house
 * rules). Scene units: 15 per metre, table top at y = 0.
 */
import * as THREE from "three";
import {
  boardPosterTexture,
  chalkboardTexture,
  feltTexture,
  neonTexture,
  paintedTexture,
  plankTexture,
  wallpaperTexture,
  woodTexture,
} from "./textures";

/** Room half-width: walls stand at x, z = +-HALF. */
export const HALF = 92;
export const WALL_H = 130;
const PANEL_H = 15; // wainscot, about 1 m
/** Door in the -X wall; the lady enters here. */
export const DOOR = { z: -58, width: 12, height: 32 };

export interface Room {
  group: THREE.Group;
  /** Hinge pivot of the door; rotate around Y to open (positive = into the room). */
  door: THREE.Object3D;
}

type Wall = "north" | "south" | "east" | "west";

/** Origin and yaw for each wall, so local +Z points into the room. */
function wallFrame(wall: Wall, floorY: number): { pos: THREE.Vector3; yaw: number } {
  switch (wall) {
    case "north": // z = -HALF, faces +Z
      return { pos: new THREE.Vector3(0, floorY, -HALF), yaw: 0 };
    case "south": // z = +HALF, faces -Z
      return { pos: new THREE.Vector3(0, floorY, HALF), yaw: Math.PI };
    case "west": // x = -HALF, faces +X
      return { pos: new THREE.Vector3(-HALF, floorY, 0), yaw: Math.PI / 2 };
    case "east": // x = +HALF, faces -X
      return { pos: new THREE.Vector3(HALF, floorY, 0), yaw: -Math.PI / 2 };
  }
}

export function buildRoom(scene: THREE.Scene, floorY: number): Room {
  const group = new THREE.Group();
  scene.add(group);

  // Floor and rug.
  const planks = plankTexture();
  planks.repeat.set(5, 5);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2, HALF * 2), new THREE.MeshStandardMaterial({ map: planks, roughness: 0.55 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = floorY;
  floor.receiveShadow = true;
  group.add(floor);
  const rug = new THREE.Mesh(new THREE.CircleGeometry(58, 96), new THREE.MeshStandardMaterial({ map: feltTexture("#5a0f1c"), roughness: 0.95 }));
  rug.rotation.x = -Math.PI / 2;
  rug.position.y = floorY + 0.06;
  rug.receiveShadow = true;
  group.add(rug);
  const rugRing = new THREE.Mesh(new THREE.RingGeometry(53, 55, 128), new THREE.MeshStandardMaterial({ color: "#c9a227", metalness: 0.8, roughness: 0.4 }));
  rugRing.rotation.x = -Math.PI / 2;
  rugRing.position.y = floorY + 0.08;
  group.add(rugRing);

  const paper = wallpaperTexture();
  // Shape UVs are in scene units: one stripe tile per 30 units, full height once.
  paper.repeat.set(1 / 30, 1 / WALL_H);
  const paperMat = new THREE.MeshStandardMaterial({ map: paper, roughness: 0.9 });
  const panelWood = woodTexture("#4a2410", "#170800", 17);
  panelWood.repeat.set(0.05, 0.08);
  const panelMat = new THREE.MeshStandardMaterial({ map: panelWood, roughness: 0.5 });
  const trimMat = new THREE.MeshStandardMaterial({ color: "#2a1405", roughness: 0.45 });
  const gold = new THREE.MeshStandardMaterial({ color: "#c9a227", metalness: 0.9, roughness: 0.3 });

  const walls: Record<Wall, THREE.Group> = { north: new THREE.Group(), south: new THREE.Group(), east: new THREE.Group(), west: new THREE.Group() };
  for (const wall of Object.keys(walls) as Wall[]) {
    const { pos, yaw } = wallFrame(wall, floorY);
    const g = walls[wall];
    g.position.copy(pos);
    g.rotation.y = yaw;
    group.add(g);

    // Wall face (with a door opening on the west wall).
    const shape = new THREE.Shape();
    shape.moveTo(-HALF, 0);
    shape.lineTo(HALF, 0);
    shape.lineTo(HALF, WALL_H);
    shape.lineTo(-HALF, WALL_H);
    shape.closePath();
    // West wall local x runs along -Z in the world (yaw +90deg), so world z = -local x.
    const doorX = -DOOR.z;
    if (wall === "west") {
      const hole = new THREE.Path();
      hole.moveTo(doorX - DOOR.width / 2, 0);
      hole.lineTo(doorX + DOOR.width / 2, 0);
      hole.lineTo(doorX + DOOR.width / 2, DOOR.height);
      hole.lineTo(doorX - DOOR.width / 2, DOOR.height);
      hole.closePath();
      shape.holes.push(hole);
    }
    const face = new THREE.Mesh(new THREE.ShapeGeometry(shape), paperMat);
    face.receiveShadow = true;
    g.add(face);

    // Wainscot panels, chair rail and skirting, skipping the doorway.
    const spans: [number, number][] = wall === "west" ? [[-HALF, doorX - DOOR.width / 2 - 1.2], [doorX + DOOR.width / 2 + 1.2, HALF]] : [[-HALF, HALF]];
    for (const [a, b] of spans) {
      const w = b - a;
      const mid = (a + b) / 2;
      const panel = new THREE.Mesh(new THREE.BoxGeometry(w, PANEL_H, 0.6), panelMat);
      panel.position.set(mid, PANEL_H / 2, 0.3);
      panel.receiveShadow = true;
      g.add(panel);
      const rail = new THREE.Mesh(new THREE.BoxGeometry(w, 0.9, 1.2), trimMat);
      rail.position.set(mid, PANEL_H, 0.6);
      g.add(rail);
      const skirt = new THREE.Mesh(new THREE.BoxGeometry(w, 1.6, 1.0), trimMat);
      skirt.position.set(mid, 0.8, 0.5);
      g.add(skirt);
      // Raised panel frames every ~14 units.
      const n = Math.max(1, Math.round(w / 14));
      for (let i = 0; i < n; i++) {
        const fx = a + (w / n) * (i + 0.5);
        const frame = new THREE.Mesh(new THREE.BoxGeometry(w / n - 3, PANEL_H - 5, 0.3), trimMat);
        frame.position.set(fx, PANEL_H / 2, 0.75);
        g.add(frame);
      }
    }
    // Crown moulding where the light fades out.
    const crown = new THREE.Mesh(new THREE.BoxGeometry(HALF * 2, 1.4, 1.6), trimMat);
    crown.position.set(0, 72, 0.8);
    g.add(crown);
  }

  // ---- Writings on the walls ----
  const addSign = (wall: Wall, tex: THREE.CanvasTexture, x: number, y: number, w: number, glow?: string) => {
    const img = tex.image as HTMLCanvasElement;
    const h = (w * img.height) / img.width;
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }),
    );
    m.position.set(x, y, 1.1);
    walls[wall].add(m);
    if (glow) {
      const light = new THREE.PointLight(glow, 900, 70, 2);
      light.position.set(x, y, 8);
      walls[wall].add(light);
    }
    return m;
  };

  // Signs sit off-centre so the in-game "LUDO" title never covers them.
  // North wall: the big "Stanl3y" neon, seen across the table from the red seat.
  addSign("north", neonTexture("Stanl3y", "#ff3fd0"), -36, 25, 44, "#ff3fd0");
  // South wall: gold MORGANENTP lettering with a smaller neon tag.
  addSign("south", paintedTexture([{ text: "MORGANENTP", size: 120 }, { text: "KISII UNIVERSITY", size: 52, color: "#d9c79a" }]), 34, 26, 46);
  addSign("south", neonTexture("Stanl3y was here", "#3fe8ff"), -36, 24, 30, "#3fe8ff");
  // East wall: LUDO ARENA neon.
  addSign("east", neonTexture("LUDO ARENA", "#ffb020", '"Cinzel Decorative","Cinzel",Georgia,serif'), 34, 27, 50, "#ffb020");
  addSign("east", paintedTexture([{ text: "est. 2026 · by Stanl3y & Morgan Okoth", size: 44, color: "#e8d4a0", font: '"Cinzel",Georgia,serif' }], 1024, 110), 34, 18.4, 38);

  // West wall: chalkboard of house rules beside the door, and a framed poster.
  const board = chalkboardTexture(
    "HOUSE RULES",
    ["• Roll a 6 to leave the yard", "• Capture = another roll", "• Exact roll to get home", "• No crying over captures"],
    "— Stanl3y",
  );
  const boardW = 30;
  const boardH = (boardW * 512) / 768;
  const chalk = new THREE.Mesh(new THREE.PlaneGeometry(boardW, boardH), new THREE.MeshStandardMaterial({ map: board, roughness: 0.95 }));
  chalk.position.set(10, 27, 1.2);
  walls.west.add(chalk);
  const chalkFrame = new THREE.Mesh(new THREE.BoxGeometry(boardW + 2, boardH + 2, 0.8), panelMat);
  chalkFrame.position.set(10, 27, 0.7);
  walls.west.add(chalkFrame);
  const posterW = 18;
  const poster = new THREE.Mesh(new THREE.PlaneGeometry(posterW, posterW), new THREE.MeshStandardMaterial({ map: boardPosterTexture(), roughness: 0.6 }));
  poster.position.set(-40, 28, 1.3);
  walls.west.add(poster);
  const posterFrame = new THREE.Mesh(new THREE.BoxGeometry(posterW + 2.4, posterW + 2.4, 1), gold);
  posterFrame.position.set(-40, 28, 0.7);
  walls.west.add(posterFrame);

  // Wall sconces: a warm pool of light on every wall.
  for (const wall of Object.keys(walls) as Wall[]) {
    for (const x of [-46, 46]) {
      const cup = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 0.8, 2.6, 20, 1, true), new THREE.MeshStandardMaterial({ color: "#c9a227", metalness: 0.9, roughness: 0.3, side: THREE.DoubleSide }));
      cup.position.set(x, 30, 2.2);
      walls[wall].add(cup);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 8), new THREE.MeshBasicMaterial({ color: "#ffe2a8" }));
      bulb.position.set(x, 31, 2.2);
      walls[wall].add(bulb);
    }
    const light = new THREE.PointLight("#ffcf8a", 700, 95, 2);
    light.position.set(0, 40, 12);
    walls[wall].add(light);
  }

  // ---- Door (west wall) ----
  const doorWood = woodTexture("#5a2c12", "#1c0a02", 29);
  doorWood.repeat.set(0.08, 0.04);
  const doorMat = new THREE.MeshStandardMaterial({ map: doorWood, roughness: 0.5 });
  // Door frame.
  for (const side of [-1, 1]) {
    const jamb = new THREE.Mesh(new THREE.BoxGeometry(1.4, DOOR.height + 1.4, 2), trimMat);
    jamb.position.set(-DOOR.z + side * (DOOR.width / 2 + 0.7), DOOR.height / 2, 0.4);
    walls.west.add(jamb);
  }
  const head = new THREE.Mesh(new THREE.BoxGeometry(DOOR.width + 2.8, 1.4, 2), trimMat);
  head.position.set(-DOOR.z, DOOR.height + 0.7, 0.4);
  walls.west.add(head);
  // Dark corridor behind the doorway with a faint light.
  const corridor = new THREE.Mesh(
    new THREE.BoxGeometry(DOOR.width + 2, DOOR.height + 4, 40),
    new THREE.MeshStandardMaterial({ color: "#1a0e06", roughness: 1, side: THREE.BackSide }),
  );
  corridor.position.set(-DOOR.z, DOOR.height / 2, -20);
  walls.west.add(corridor);
  const hallLight = new THREE.PointLight("#ffbf7a", 160, 40, 2);
  hallLight.position.set(-DOOR.z, DOOR.height - 4, -18);
  walls.west.add(hallLight);
  // The leaf hangs on a hinge at the doorway's +Z edge (local -x side).
  const hinge = new THREE.Group();
  hinge.position.set(-DOOR.z - DOOR.width / 2, 0, 0.2);
  walls.west.add(hinge);
  const leaf = new THREE.Mesh(new THREE.BoxGeometry(DOOR.width, DOOR.height, 0.8), doorMat);
  leaf.position.set(DOOR.width / 2, DOOR.height / 2, 0);
  leaf.castShadow = true;
  hinge.add(leaf);
  for (const [px, py] of [[DOOR.width / 2, DOOR.height * 0.72], [DOOR.width / 2, DOOR.height * 0.3]]) {
    const inset = new THREE.Mesh(new THREE.BoxGeometry(DOOR.width - 3, DOOR.height * 0.32, 0.3), trimMat);
    inset.position.set(px, py, 0.5);
    hinge.add(inset);
  }
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 8), gold);
  knob.position.set(DOOR.width - 1.4, DOOR.height * 0.47, 0.9);
  hinge.add(knob);

  return { group, door: hinge };
}
