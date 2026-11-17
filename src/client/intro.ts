/**
 * Opening scene: a lady walks out of the dark to the table, sits down across
 * from her partner, pulls her chair in, and the camera cranes up to the board.
 *
 * Characters are KayKit Adventurers (CC0) with their own walk/sit clips;
 * chairs come from Clay (procedural fallback). All sizes below are in world
 * units; K converts KayKit character units (measured from the rig) to world.
 */
import * as THREE from "three";
import { ease, tween, wait } from "./anim";
import type { Assets, Character } from "./assets";
import { sfx } from "./audio";
import { CHAIR_SEAT } from "./procedural";
import { FLOOR_Y, type Stage } from "./stage";

const K = 13;
/** Seat top above the floor, matched to the Sit_Chair clips (feet hang at 0.40). */
const SEAT_TOP = 0.42 * K;
/** Sit_Chair_Down moves the hips this far back from where the character stood. */
const HIP_BACK = 0.397 * K;
/** Seat centre distance from the table centre once pulled in, and while waiting. */
const SEATED_D = 33;
const PULLED_D = 40;
/** Walking speed matched to the Walking_B stride. */
const WALK_SPEED = 1.05 * K;

class Person {
  readonly root = new THREE.Group();
  private mixer: THREE.AnimationMixer;
  private actions = new Map<string, THREE.AnimationAction>();
  private current: THREE.AnimationAction | null = null;

  constructor(ch: Character) {
    ch.scene.scale.setScalar(K);
    this.root.add(ch.scene);
    this.mixer = new THREE.AnimationMixer(ch.scene);
    for (const clip of ch.clips) this.actions.set(clip.name, this.mixer.clipAction(clip));
  }

  play(name: string, fade = 0.25, once = false): THREE.AnimationAction | null {
    const next = this.actions.get(name);
    if (!next) return null;
    if (next === this.current) return next;
    next.reset();
    next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    next.clampWhenFinished = once;
    next.enabled = true;
    next.play();
    if (this.current && fade > 0) this.current.crossFadeTo(next, fade, false);
    else if (this.current) this.current.stop();
    this.current = next;
    return next;
  }

  update(dt: number) {
    this.mixer.update(dt);
  }
}

/** Direction a seat on side +1 (right, +X) or -1 (left) faces: towards the table. */
const yawFor = (side: 1 | -1) => (side > 0 ? -Math.PI / 2 : Math.PI / 2);
const facing = (yaw: number) => new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));

export class Room {
  readonly group = new THREE.Group();
  readonly lady: Person | null;
  readonly partner: Person | null;
  private ladyChair: THREE.Object3D;
  private partnerChair: THREE.Object3D;

  constructor(
    private stage: Stage,
    assets: Assets,
    chars: { lady: Character | null; partner: Character | null },
  ) {
    const makeChair = () => {
      const c = assets.chair();
      // KayKit characters are chibi: a wide, low chair suits them.
      const h = SEAT_TOP / CHAIR_SEAT;
      c.scale.set(h * 1.9, h, h * 1.7);
      return c;
    };
    this.ladyChair = makeChair();
    this.partnerChair = makeChair();
    this.group.add(this.ladyChair, this.partnerChair);
    this.lady = chars.lady ? new Person(chars.lady) : null;
    this.partner = chars.partner ? new Person(chars.partner) : null;
    if (this.lady) this.group.add(this.lady.root);
    if (this.partner) this.group.add(this.partner.root);
    stage.scene.add(this.group);
    stage.onFrame((dt) => {
      this.lady?.update(dt);
      this.partner?.update(dt);
    });
    this.seat(this.partner, this.partnerChair, -1, SEATED_D);
    this.partner?.play("Sit_Chair_Idle", 0);
    this.finalPose();
  }

  /** Puts a chair (and its person, seated) at distance d on a side of the table. */
  seat(person: Person | null, chair: THREE.Object3D, side: 1 | -1, d: number) {
    const yaw = yawFor(side);
    chair.position.set(side * d, FLOOR_Y, 0);
    chair.rotation.y = yaw;
    if (person) {
      person.root.position.copy(chair.position).addScaledVector(facing(yaw), HIP_BACK);
      person.root.rotation.y = yaw;
    }
  }

  /** Everyone seated and pulled in: the state after the intro. */
  finalPose() {
    this.seat(this.lady, this.ladyChair, 1, SEATED_D);
    this.lady?.play("Sit_Chair_Idle", 0);
  }

  setPeopleVisible(on: boolean) {
    if (this.lady) this.lady.root.visible = on;
    if (this.partner) this.partner.root.visible = on;
  }

  /**
   * Plays the opening. Resolves when finished or skipped. `onTitle` fires
   * when the title card should appear.
   */
  play(onTitle: () => void, onTitleEnd: () => void): { done: Promise<void>; skip: () => void } {
    const stage = this.stage;
    const cam = stage.camera;
    let skipped = false;
    let resolveDone!: () => void;
    const done = new Promise<void>((r) => (resolveDone = r));
    const step = (ms: number, fn: (t: number) => void) => tween(ms, (t) => !skipped && fn(t));

    const finish = () => {
      stage.cinematic = false;
      resolveDone();
    };
    const skip = () => {
      if (skipped) return;
      skipped = true;
      this.finalPose();
      void stage.menuView(false);
      onTitleEnd();
      finish();
    };

    stage.cinematic = true;
    stage.spin = 0;
    const look = new THREE.Vector3();

    const run = async () => {
      const lady = this.lady;
      const yaw = yawFor(1);
      const chairAt = new THREE.Vector3(PULLED_D, FLOOR_Y, 0);
      const stand = chairAt.clone().addScaledVector(facing(yaw), HIP_BACK);
      this.ladyChair.position.copy(chairAt);
      this.ladyChair.rotation.y = yaw;

      // Shot 1: she walks in from the dark, the camera drifts with her.
      const path = [new THREE.Vector3(82, FLOOR_Y, 74), new THREE.Vector3(50, FLOOR_Y, 20), stand];
      const c0 = new THREE.Vector3(-34, FLOOR_Y + 13, 104);
      const c1 = new THREE.Vector3(6, FLOOR_Y + 19, 76);
      cam.position.copy(c0);
      look.set(path[0]!.x, FLOOR_Y + 14, path[0]!.z);
      cam.lookAt(look);

      if (lady) {
        lady.root.position.copy(path[0]!);
        lady.play("Walking_B", 0);
        const lens = [path[0]!.distanceTo(path[1]!), path[1]!.distanceTo(stand)];
        const total = lens[0]! + lens[1]!;
        const dur = (total / WALK_SPEED) * 1000;
        let nextStep = 0;
        await step(dur, (t) => {
          const dist = t * total;
          const [a, b, l0] = dist < lens[0]! ? [path[0]!, path[1]!, 0] : [path[1]!, stand, lens[0]!];
          const seg = dist < lens[0]! ? lens[0]! : lens[1]!;
          const p = a.clone().lerp(b, Math.min(1, (dist - l0) / seg));
          const dir = b.clone().sub(a);
          lady.root.position.copy(p);
          // Smoothly face the walking direction.
          const want = Math.atan2(dir.x, dir.z);
          lady.root.rotation.y += shortest(lady.root.rotation.y, want) * 0.12;
          if (t * dur >= nextStep) {
            sfx.footstep();
            nextStep += 535; // two steps per 1.07 s walk cycle
          }
          cam.position.lerpVectors(c0, c1, ease.inOutCubic(t));
          look.lerp(new THREE.Vector3(p.x, FLOOR_Y + 15, p.z), 0.08);
          cam.lookAt(look);
        });
        if (skipped) return;

        // Turn her back to the chair, then sit.
        lady.play("Idle", 0.25);
        const from = lady.root.rotation.y;
        const delta = shortest(from, yaw);
        await step(450, (t) => {
          lady.root.rotation.y = from + delta * ease.inOutCubic(t);
          look.lerp(new THREE.Vector3(stand.x, FLOOR_Y + 13, stand.z), 0.1);
          cam.lookAt(look);
        });
        if (skipped) return;
        lady.play("Sit_Chair_Down", 0.2, true);
        await wait(800);
        if (skipped) return;
        lady.play("Sit_Chair_Idle", 0.3);
      } else {
        // No characters available: just drift towards the table.
        await step(2500, (t) => {
          cam.position.lerpVectors(c0, c1, ease.inOutCubic(t));
          look.lerp(new THREE.Vector3(0, 0, 0), 0.05);
          cam.lookAt(look);
        });
        if (skipped) return;
      }

      // Shot 2: she pulls her chair in while the camera frames the table.
      onTitle();
      const c2 = new THREE.Vector3(0, FLOOR_Y + 26, 80);
      const camFrom = cam.position.clone();
      const lookFrom = look.clone();
      sfx.chair();
      const scoot = step(900, (t) => this.seat(lady, this.ladyChair, 1, PULLED_D + (SEATED_D - PULLED_D) * ease.inOutCubic(t)));
      await step(1900, (t) => {
        const e = ease.inOutCubic(t);
        cam.position.lerpVectors(camFrom, c2, e);
        look.lerpVectors(lookFrom, new THREE.Vector3(0, 0, 0), e);
        cam.lookAt(look);
      });
      await scoot;
      if (skipped) return;
      await wait(500);
      if (skipped) return;

      // Shot 3: rise and settle on the table with both players in frame.
      onTitleEnd();
      await stage.menuView(true, 2600);
      if (skipped) return;
      finish();
    };
    void run();
    return { done, skip };
  }
}

function shortest(from: number, to: number) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
