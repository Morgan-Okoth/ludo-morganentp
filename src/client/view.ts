/**
 * Turns authoritative game messages (from the GameRoom or the local match)
 * into animations on the 3D stage, and turns taps into roll/move intents.
 */
import * as THREE from "three";
import { type Color, type GameEvent, type GameState, armOf, currentColor } from "../shared/rules";
import { ms, wait } from "./anim";
import { sfx } from "./audio";
import { TILE_TOP } from "./board3d";
import type { Hud } from "./hud";
import { COLOR_HEX } from "./layout";
import type { Seating } from "./people";
import { Pawns } from "./tokens";
import type { Stage } from "./stage";

export interface SeatInfo {
  color: Color;
  name: string;
  ai: boolean;
}

export interface StateMsg {
  state: GameState;
  events: GameEvent[];
  legal: number[];
  you: Color | null;
}

export class GameView {
  pawns: Pawns | null = null;
  seats: SeatInfo[] = [];
  state: GameState | null = null;
  private legal: number[] = [];
  private queue: Promise<void> = Promise.resolve();
  private trophy: THREE.Object3D | null = null;
  private awaiting: "roll" | "move" | null = null;
  private lastMine = false;
  /** Whether this client may act for a colour. */
  canAct: (color: Color) => boolean = () => false;
  /** The people at the table; set by main. */
  seating: Seating | null = null;
  onRoll: () => void = () => {};
  onMove: (token: number) => void = () => {};
  onGameOver: (state: GameState) => void = () => {};

  constructor(
    readonly stage: Stage,
    readonly hud: Hud,
  ) {
    stage.onFrame((dt) => this.pawns?.update(dt));
    stage.onTap = (hit, ground) => this.tap(hit, ground);
    hud.onRoll = () => this.requestRoll();
  }

  name(color: Color) {
    return this.seats.find((s) => s.color === color)?.name ?? color;
  }

  /** Sets up a fresh board for a game. `viewColor` decides the camera side. */
  begin(state: GameState, seats: SeatInfo[], viewColor: Color | null) {
    this.queue = Promise.resolve();
    this.seats = seats;
    this.state = state;
    this.removeTrophy();
    this.stage.fx.clear();
    this.stage.spin = 0;
    this.stage.setLayout(state.arms);
    if (this.pawns) this.stage.world.remove(this.pawns.group);
    this.pawns = new Pawns(this.stage.layout, this.stage.assets.pawn, state.players, this.stage.fx);
    this.stage.world.add(this.pawns.group);
    for (const c of state.players) state.steps[c]!.forEach((s, i) => (this.pawns!.get(c, i).step = s));
    this.pawns.snapAll();
    this.parkDie(currentColor(state), state.die ?? 6);
    // You sit at your own colour's place; your own body is hidden so it never blocks the view.
    const names = Object.fromEntries(seats.map((s) => [s.color, s.name]));
    this.seating?.set(state.players, state.arms, { hide: viewColor, names, labels: true });
    void this.stage.lookFrom(viewColor ? armOf(viewColor) : 0, true, 1600);
    this.hud.setPlayers(seats, state);
    this.present(state);
  }

  /** Board preview behind the menu: pawns sitting in their yards. */
  preview(colors: Color[], arms: number) {
    this.stage.setLayout(arms);
    this.seating?.set(colors, arms);
    this.seating?.setActive(null);
    if (this.pawns) this.stage.world.remove(this.pawns.group);
    this.pawns = new Pawns(this.stage.layout, this.stage.assets.pawn, colors, this.stage.fx);
    this.pawns.snapAll();
    this.stage.world.add(this.pawns.group);
    this.parkDie(colors[0]!, 6);
    this.removeTrophy();
  }

  push(msg: StateMsg): Promise<void> {
    this.queue = this.queue.then(() => this.handle(msg)).catch((e) => console.error("view error", e));
    return this.queue;
  }

  private async handle(msg: StateMsg) {
    if (!this.pawns) return;
    this.setAwaiting(null);
    for (const ev of msg.events) await this.play(ev);
    this.state = msg.state;
    this.legal = msg.legal;
    // Resync in case anything drifted (e.g. reconnect mid-animation).
    let drift = false;
    for (const c of msg.state.players) {
      msg.state.steps[c]!.forEach((s, i) => {
        const p = this.pawns!.get(c, i);
        if (p.step !== s) {
          p.step = s;
          drift = true;
        }
      });
    }
    if (drift) await this.pawns.settle();
    this.hud.setPlayers(this.seats, msg.state);
    this.present(msg.state);
  }

  private dieSpot(color: Color) {
    const l = this.stage.layout;
    const t = l.theta(armOf(color)) + 0.32;
    const r = l.outer + 2.6;
    return new THREE.Vector3(Math.cos(t) * r, 0.03, Math.sin(t) * r);
  }

  private parkDie(color: Color, value: number) {
    const at = this.dieSpot(color);
    this.stage.die.place(at, value, -this.stage.layout.theta(armOf(color)) + Math.PI / 2);
    this.stage.die.setGlowColor(COLOR_HEX[color]);
  }

  private async play(ev: GameEvent) {
    const pawns = this.pawns!;
    switch (ev.type) {
      case "rolled": {
        const l = this.stage.layout;
        const to = this.dieSpot(ev.color);
        const t = l.theta(armOf(ev.color)) + 0.32;
        const from = new THREE.Vector3(Math.cos(t) * (l.outer + 7), 5, Math.sin(t) * (l.outer + 7));
        this.stage.die.setGlowColor(COLOR_HEX[ev.color]);
        this.hud.message(`${this.name(ev.color)} rolls...`, ev.color);
        await this.stage.die.roll(from, to, ev.die, -l.theta(armOf(ev.color)) + Math.PI / 2 + (Math.random() - 0.5) * 0.6);
        this.hud.showDie(ev.die, ev.color);
        if (ev.die === 6) this.stage.fx.burst(this.stage.die.mesh.position.clone(), "#FFD700", 24, 3);
        this.hud.message(`${this.name(ev.color)} rolled ${ev.die}${ev.die === 6 ? "!" : ""}`, ev.color);
        await wait(ms(250));
        break;
      }
      case "skipped":
        sfx.skip();
        this.hud.message(`${this.name(ev.color)} has no move`, ev.color);
        await wait(ms(650));
        break;
      case "moved":
        await pawns.move(ev.color, ev.token, ev.from, ev.to);
        break;
      case "captured":
        this.hud.message(`${this.name(ev.by)} captures ${this.name(ev.victim)}! 💥`, ev.by);
        await pawns.capture(ev.victim, ev.token);
        break;
      case "home": {
        sfx.home();
        const p = this.stage.layout.finishSlot(ev.color, ev.token);
        this.stage.fx.burst(new THREE.Vector3(p.x, TILE_TOP + 0.6, p.z), COLOR_HEX[ev.color], 50, 5);
        this.stage.fx.shockwave(new THREE.Vector3(p.x, TILE_TOP + 0.05, p.z), "#FFD700");
        this.hud.message(`${this.name(ev.color)} brings a pawn home!`, ev.color);
        await wait(ms(350));
        break;
      }
      case "won":
        sfx.win();
        this.hud.message(`🏆 ${this.name(ev.color)} finishes first!`, ev.color);
        this.stage.fx.confetti(new THREE.Vector3(0, 0, 0), [COLOR_HEX[ev.color], "#FFD700", "#ffffff"], 160);
        await wait(ms(900));
        break;
      case "turn":
        if (ev.extra) this.hud.message(`${this.name(ev.color)} gets another roll!`, ev.color);
        break;
    }
  }

  private present(state: GameState) {
    const pawns = this.pawns!;
    pawns.setClickable(null, []);
    this.stage.die.ready = false;
    this.hud.setRollEnabled(false);

    this.seating?.setActive(state.phase === "over" ? null : currentColor(state));
    if (this.stage.board) {
      this.stage.board.yardGlow.forEach((g, arm) => {
        const on = state.phase !== "over" && armOf(currentColor(state)) === arm;
        (g.material as THREE.MeshBasicMaterial).opacity = on ? 0.9 : 0;
      });
    }

    if (state.phase === "over") {
      this.celebrate(state);
      this.onGameOver(state);
      return;
    }

    const color = currentColor(state);
    const mine = this.canAct(color);
    if (mine && !this.lastMine) sfx.yourTurn();
    this.lastMine = mine;
    this.parkDieIfIdle(color);

    if (!mine) {
      const seat = this.seats.find((s) => s.color === color);
      this.hud.message(`${this.name(color)}${seat?.ai ? " is thinking..." : "'s turn"}`, color);
      this.hud.instruction("");
      return;
    }

    if (state.phase === "roll") {
      this.setAwaiting("roll");
      this.stage.die.ready = true;
      this.hud.setRollEnabled(true, color);
      this.hud.message(`${this.name(color)}, your roll!`, color);
      this.hud.instruction("Tap the die, press ROLL or hit Space");
    } else {
      this.setAwaiting("move");
      pawns.setClickable(color, this.legal);
      this.hud.message(`${this.name(color)} rolled ${state.die} — pick a pawn`, color);
      this.hud.instruction("Tap a glowing pawn");
      if (this.legal.length === 1) {
        const only = this.legal[0]!;
        setTimeout(() => {
          if (this.awaiting === "move") this.chooseMove(only);
        }, 450);
      }
    }
  }

  private parkDieIfIdle(color: Color) {
    if (this.stage.die.rolling) return;
    this.stage.die.setGlowColor(COLOR_HEX[color]);
  }

  private setAwaiting(a: "roll" | "move" | null) {
    this.awaiting = a;
  }

  requestRoll() {
    if (this.awaiting !== "roll") return;
    this.setAwaiting(null);
    this.stage.die.ready = false;
    this.hud.setRollEnabled(false);
    this.onRoll();
  }

  private chooseMove(token: number) {
    if (this.awaiting !== "move") return;
    this.setAwaiting(null);
    this.pawns?.setClickable(null, []);
    this.hud.instruction("");
    this.onMove(token);
  }

  private tap(hit: THREE.Intersection | null, ground: THREE.Vector3 | null) {
    if (this.awaiting === "roll") {
      if (hit && (hit.object.name === "die" || hit.object.parent?.name === "die")) return this.requestRoll();
      if (ground && ground.distanceTo(this.stage.die.mesh.position) < 2.2) return this.requestRoll();
    }
    if (this.awaiting === "move" && this.pawns) {
      const pawn = hit?.object.userData.pawn as import("./tokens").Pawn | undefined;
      if (pawn?.clickable) return this.chooseMove(pawn.index);
      if (ground) {
        const near = this.pawns.nearestClickable(ground);
        if (near) return this.chooseMove(near.index);
      }
    }
  }

  private celebrate(state: GameState) {
    const winner = state.winner ?? state.finished[0];
    if (!winner) return;
    this.hud.message(`🏆 ${this.name(winner)} wins!`, winner);
    this.hud.instruction("");
    this.removeTrophy();
    const trophy = this.stage.assets.trophy();
    trophy.scale.multiplyScalar(1.6);
    trophy.position.set(0, TILE_TOP + 0.6, 0);
    this.stage.world.add(trophy);
    this.trophy = trophy;
    this.stage.fx.confetti(new THREE.Vector3(0, 0, 0), state.finished.map((c) => COLOR_HEX[c]).concat("#FFD700"), 320);
    this.stage.spin = 0.12;
    const t0 = performance.now();
    this.stage.onFrame(() => {
      if (this.trophy === trophy) trophy.rotation.y = (performance.now() - t0) / 900;
    });
  }

  private removeTrophy() {
    if (this.trophy) this.stage.world.remove(this.trophy);
    this.trophy = null;
  }
}
