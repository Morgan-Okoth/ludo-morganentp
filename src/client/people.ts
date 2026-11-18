/**
 * The players at the table: one chair and one realistic seated person per
 * colour in the game, placed behind that colour's arm of the board.
 *
 * People come from public/models/people/<colour>.glb (see tools/people).
 * Their clips were measured (tools/people/out): seated hips end up 0.54 m
 * behind and 0.53 m above the standing root, so the root goes 0.54 m in
 * front of the chair. Scene units are 15 per metre; the table top is y = 0.
 */
import * as THREE from "three";
import { type Color, COLORS, armOf } from "../shared/rules";
import { ease, tween } from "./anim";
import { type Character, loadPerson } from "./assets";
import { COLOR_HEX, Layout } from "./layout";
import { CHAIR_SEAT } from "./procedural";
import { FLOOR_Y, type Stage } from "./stage";
import { labelTexture } from "./textures";

export const PER_METRE = 15;
/** Seated hips sit this far behind the standing position (from the sit clips). */
export const HIP_BACK = 0.537 * PER_METRE;
/** Seat top above the floor: hips height in the sit clips minus the buttock depth. */
const SEAT_TOP = 0.44 * PER_METRE;
/** Distance from the table centre to a seated player's hips. */
export const SEAT_R = 30;
/** Chair distance while someone stands in front of it, before pulling in. */
export const PULLED_R = 37;

export class Person {
  readonly root = new THREE.Group();
  private mixer: THREE.AnimationMixer;
  private actions = new Map<string, THREE.AnimationAction>();
  private current: THREE.AnimationAction | null = null;

  constructor(ch: Character) {
    ch.scene.scale.setScalar(PER_METRE);
    this.root.add(ch.scene);
    this.mixer = new THREE.AnimationMixer(ch.scene);
    for (const clip of ch.clips) this.actions.set(clip.name, this.mixer.clipAction(clip));
  }

  has(name: string) {
    return this.actions.has(name);
  }

  play(name: string, fade = 0.3, once = false, offset = 0): THREE.AnimationAction | null {
    const next = this.actions.get(name);
    if (!next) return null;
    if (next === this.current) return next;
    next.reset();
    next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    next.clampWhenFinished = once;
    next.time = offset;
    next.play();
    if (this.current && fade > 0) this.current.crossFadeTo(next, fade, false);
    else this.current?.stop();
    this.current = next;
    return next;
  }

  update(dt: number) {
    this.mixer.update(dt);
  }
}

export interface Seat {
  color: Color;
  group: THREE.Group;
  chair: THREE.Object3D;
  person: Person | null;
  label: THREE.Sprite;
  /** Direction from the table centre to this seat, on the XZ plane. */
  dir: THREE.Vector3;
}

/** Yaw that makes local +Z point from a seat towards the table centre. */
export const yawToCentre = (dir: THREE.Vector3) => Math.atan2(-dir.x, -dir.z);

export class Seating {
  private seats = new Map<Color, Seat>();
  private people = new Map<Color, Promise<Person | null>>();
  private names: Partial<Record<Color, string>> = {};
  private hidden: Color | null = null;
  private labelsOn = false;
  private active: Color | null = null;
  /** Colours whose person is being driven by someone else (the intro). */
  readonly borrowed = new Set<Color>();
  private t = 0;

  constructor(private stage: Stage) {
    stage.onFrame((dt) => this.update(dt));
  }

  /** Loads (once) the person for a colour. */
  person(color: Color): Promise<Person | null> {
    let p = this.people.get(color);
    if (!p) {
      p = loadPerson(color).then((ch) => (ch ? new Person(ch) : null));
      this.people.set(color, p);
    }
    return p;
  }

  seat(color: Color): Seat | undefined {
    return this.seats.get(color);
  }

  /** Resolves once every current seat has its person loaded (or failed). */
  async ready() {
    await Promise.all([...this.seats.keys()].map((c) => this.person(c)));
  }

  /**
   * Seats exactly these colours around a board with `arms` arms. Existing
   * seats slide to their new places, new ones pop in, others leave.
   */
  set(colors: Color[], arms: number, opts: { hide?: Color | null; names?: Partial<Record<Color, string>>; labels?: boolean } = {}) {
    const layout = new Layout(arms);
    this.hidden = opts.hide ?? null;
    this.names = opts.names ?? {};
    this.labelsOn = opts.labels ?? false;
    for (const [color, seat] of this.seats) {
      if (!colors.includes(color)) {
        this.seats.delete(color);
        void tween(260, (k) => seat.group.scale.setScalar(Math.max(0.001, 1 - ease.outCubic(k)))).then(() => this.stage.scene.remove(seat.group));
      }
    }
    for (const color of colors) {
      const t = layout.theta(armOf(color));
      const dir = new THREE.Vector3(Math.cos(t), 0, Math.sin(t));
      let seat = this.seats.get(color);
      if (!seat) {
        seat = this.create(color, dir);
        this.seats.set(color, seat);
        const s = seat;
        s.group.scale.setScalar(0.001);
        void tween(420, (k) => s.group.scale.setScalar(Math.max(0.001, ease.outBack(k))));
      } else if (seat.dir.angleTo(dir) > 1e-3) {
        this.slide(seat, dir);
      }
    }
    for (const seat of this.seats.values()) this.refresh(seat);
  }

  /** Highlights the label of the player whose turn it is. */
  setActive(color: Color | null) {
    this.active = color;
  }

  private create(color: Color, dir: THREE.Vector3): Seat {
    const group = new THREE.Group();
    const chair = this.stage.assets.chair();
    // Normalised chairs are 1 unit tall with the seat at CHAIR_SEAT.
    chair.scale.multiplyScalar(SEAT_TOP / CHAIR_SEAT);
    group.add(chair);
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false }));
    label.scale.set(9, 2.25, 1);
    label.visible = false;
    group.add(label);
    this.stage.scene.add(group);
    const seat: Seat = { color, group, chair, person: null, label, dir };
    this.place(seat, dir, SEAT_R);
    void this.person(color).then((person) => {
      if (!person || this.seats.get(color) !== seat) return;
      seat.person = person;
      group.add(person.root);
      person.play("sit_idle", 0, false, Math.random() * 1.5);
      this.place(seat, seat.dir, SEAT_R);
      this.refresh(seat);
    });
    return seat;
  }

  /** Puts a seat's chair at radius r and its person seated on it. */
  place(seat: Seat, dir: THREE.Vector3, r: number) {
    const yaw = yawToCentre(dir);
    seat.chair.position.copy(dir).multiplyScalar(r).setY(FLOOR_Y);
    seat.chair.rotation.y = yaw;
    if (seat.person && !this.borrowed.has(seat.color)) {
      seat.person.root.position.copy(dir).multiplyScalar(r - HIP_BACK).setY(FLOOR_Y);
      seat.person.root.rotation.y = yaw;
    }
    seat.label.position.copy(dir).multiplyScalar(r - 2).setY(FLOOR_Y + 1.45 * PER_METRE);
  }

  private slide(seat: Seat, to: THREE.Vector3) {
    const from = seat.dir.clone();
    const a0 = Math.atan2(from.z, from.x);
    let da = Math.atan2(to.z, to.x) - a0;
    if (da > Math.PI) da -= Math.PI * 2;
    if (da < -Math.PI) da += Math.PI * 2;
    seat.dir = to.clone();
    const tmp = new THREE.Vector3();
    void tween(600, (k) => {
      const a = a0 + da * ease.inOutCubic(k);
      this.place(seat, tmp.set(Math.cos(a), 0, Math.sin(a)), SEAT_R);
    });
  }

  private refresh(seat: Seat) {
    if (seat.person) seat.person.root.visible = seat.color !== this.hidden;
    // The local player "sits" in their own chair, so it would only block the view.
    seat.chair.visible = seat.color !== this.hidden;
    const name = this.names[seat.color];
    seat.label.visible = this.labelsOn && !!name && seat.color !== this.hidden;
    if (seat.label.visible && seat.label.userData.text !== name) {
      const mat = seat.label.material;
      mat.map?.dispose();
      mat.map = labelTexture(name!, COLOR_HEX[seat.color]);
      mat.needsUpdate = true;
      seat.label.userData.text = name;
    }
  }

  private update(dt: number) {
    this.t += dt;
    for (const color of COLORS) {
      const seat = this.seats.get(color);
      if (!seat) continue;
      seat.person?.update(dt);
      if (seat.label.visible) {
        const on = seat.color === this.active;
        const s = on ? 1.25 + Math.sin(this.t * 5) * 0.06 : 1;
        seat.label.scale.set(9 * s, 2.25 * s, 1);
        seat.label.material.opacity = on ? 1 : 0.7;
      }
    }
  }
}
