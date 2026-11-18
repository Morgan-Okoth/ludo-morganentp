/**
 * Opening scene: the door opens, a lady walks across the room to the table,
 * turns, sits down opposite the player already waiting there, pulls her
 * chair in, and the camera rises to frame the table.
 *
 * People are the seated players from people.ts: yellow (the lady, who has
 * walk and sit clips) and red. The seating must hold both before play().
 */
import * as THREE from "three";
import { ease, tween, wait } from "./anim";
import { sfx } from "./audio";
import { HIP_BACK, PER_METRE, PULLED_R, SEAT_R, type Seating, yawToCentre } from "./people";
import { DOOR, HALF, type Room } from "./room";
import { FLOOR_Y, type Stage } from "./stage";

export const INTRO_COLORS = ["red", "yellow"] as const;
const LADY = "yellow";
/** Planted-foot speed of the walk clip, measured at 1.3 m/s. */
const WALK_SPEED = 1.3 * PER_METRE;
const EYE = 1.55 * PER_METRE;

export function playIntro(
  stage: Stage,
  seating: Seating,
  room: Room,
  onTitle: () => void,
  onTitleEnd: () => void,
): { done: Promise<void>; skip: () => void } {
  const cam = stage.camera;
  let skipped = false;
  let resolveDone!: () => void;
  const done = new Promise<void>((r) => (resolveDone = r));
  const step = (ms: number, fn: (t: number) => void) => tween(ms, (t) => !skipped && fn(t));
  const seat = seating.seat(LADY);
  const lady = seat?.person && seat.person.has("walk") ? seat.person : null;

  const settle = () => {
    seating.borrowed.delete(LADY);
    if (seat) seating.place(seat, seat.dir, SEAT_R);
    lady?.play("sit_idle", 0.4);
    room.door.rotation.y = 0;
  };
  const finish = () => {
    stage.cinematic = false;
    resolveDone();
  };
  const skip = () => {
    if (skipped) return;
    skipped = true;
    settle();
    void stage.menuView(false);
    onTitleEnd();
    finish();
  };

  stage.cinematic = true;
  stage.spin = 0;
  const look = new THREE.Vector3();
  const aim = (x: number, y: number, z: number, k: number) => {
    look.lerp(new THREE.Vector3(x, y, z), k);
    cam.lookAt(look);
  };

  const run = async () => {
    if (!seat || !lady) {
      // Characters missing: a slow drift over the table instead.
      cam.position.set(60, FLOOR_Y + 30, 60);
      look.set(0, 0, 0);
      await step(2500, (t) => {
        cam.position.lerpVectors(new THREE.Vector3(60, FLOOR_Y + 30, 60), new THREE.Vector3(30, 20, 60), ease.inOutCubic(t));
        aim(0, 0, 0, 0.1);
      });
      if (skipped) return;
      onTitle();
      await wait(1500);
      onTitleEnd();
      if (!skipped) await stage.menuView(true, 2200);
      if (!skipped) finish();
      return;
    }

    // Her chair waits pulled out; she walks in from the corridor behind the door.
    seating.borrowed.add(LADY);
    seating.place(seat, seat.dir, PULLED_R);
    const yaw = yawToCentre(seat.dir);
    const standAt = seat.dir.clone().multiplyScalar(PULLED_R - HIP_BACK).setY(FLOOR_Y);
    const side = new THREE.Vector3(-seat.dir.z, 0, seat.dir.x); // along the table edge
    const path = [
      new THREE.Vector3(-HALF - 12, FLOOR_Y, DOOR.z),
      new THREE.Vector3(-HALF + 14, FLOOR_Y, DOOR.z),
      new THREE.Vector3(-38, FLOOR_Y, -46),
      // Approach along the table edge from the door's side, then step in front of the chair.
      standAt.clone().addScaledVector(side, side.x > 0 ? -12 : 12).addScaledVector(seat.dir, 1),
      standAt,
    ];
    lady.root.position.copy(path[0]!);
    lady.root.rotation.y = Math.PI / 2; // facing into the room (+X)
    lady.play("idle", 0);

    // Shot 1: across the room towards the door.
    const c0 = new THREE.Vector3(34, FLOOR_Y + EYE + 2, -8);
    const c1 = new THREE.Vector3(26, FLOOR_Y + EYE + 6, 4);
    cam.position.copy(c0);
    look.set(-HALF, FLOOR_Y + 18, DOOR.z);
    cam.lookAt(look);

    // The door swings open into the room.
    sfx.door();
    await step(900, (t) => (room.door.rotation.y = -1.75 * ease.outCubic(t)));
    if (skipped) return;

    const lens = path.slice(1).map((p, i) => p.distanceTo(path[i]!));
    const total = lens.reduce((a, b) => a + b, 0);
    const dur = (total / WALK_SPEED) * 1000;
    lady.play("walk", 0.25);
    let nextStep = 150;
    let doorClosed = false;
    await step(dur, (t) => {
      let d = t * total;
      let i = 0;
      while (i < lens.length - 1 && d > lens[i]!) d -= lens[i++]!;
      const a = path[i]!;
      const b = path[i + 1]!;
      const p = a.clone().lerp(b, Math.min(1, d / lens[i]!));
      lady.root.position.copy(p);
      const want = Math.atan2(b.x - a.x, b.z - a.z);
      lady.root.rotation.y += shortest(lady.root.rotation.y, want) * 0.1;
      if (t * dur >= nextStep) {
        sfx.footstep();
        nextStep += 535; // two steps per 1.07 s walk cycle
      }
      if (!doorClosed && t > 0.45) {
        doorClosed = true;
        void tween(1100, (k) => (room.door.rotation.y = -1.75 * (1 - ease.inOutCubic(k))));
      }
      cam.position.lerpVectors(c0, c1, ease.inOutCubic(t));
      aim(p.x, FLOOR_Y + EYE * 0.85, p.z, 0.07);
    });
    if (skipped) return;

    // Turn to the table, then sit down on the chair behind her.
    lady.play("idle", 0.3);
    const from = lady.root.rotation.y;
    const delta = shortest(from, yaw);
    await step(600, (t) => {
      lady.root.rotation.y = from + delta * ease.inOutCubic(t);
      aim(standAt.x, FLOOR_Y + EYE * 0.7, standAt.z, 0.1);
    });
    if (skipped) return;
    lady.root.rotation.y = yaw;
    lady.play("sit_down", 0.25, true);
    await step(1900, () => aim(standAt.x, FLOOR_Y + EYE * 0.55, standAt.z - 0, 0.06));
    if (skipped) return;
    lady.play("sit_idle", 0.4);

    // Shot 2: she pulls her chair in while the camera opens up on the table.
    onTitle();
    sfx.chair();
    const camFrom = cam.position.clone();
    const lookFrom = look.clone();
    const c2 = new THREE.Vector3(30, 24, 64);
    void step(1000, (t) => {
      const r = PULLED_R + (SEAT_R - PULLED_R) * ease.inOutCubic(t);
      seat.chair.position.copy(seat.dir).multiplyScalar(r).setY(FLOOR_Y);
      lady.root.position.copy(seat.dir).multiplyScalar(r - HIP_BACK).setY(FLOOR_Y);
    });
    await step(2200, (t) => {
      const e = ease.inOutCubic(t);
      cam.position.lerpVectors(camFrom, c2, e);
      look.lerpVectors(lookFrom, new THREE.Vector3(0, 0, 0), e);
      cam.lookAt(look);
    });
    if (skipped) return;
    settle();
    await wait(600);
    if (skipped) return;

    // Shot 3: rise and settle on the table, everyone in frame.
    onTitleEnd();
    await stage.menuView(true, 2400);
    if (skipped) return;
    finish();
  };
  void run();
  return { done, skip };
}

function shortest(from: number, to: number) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
