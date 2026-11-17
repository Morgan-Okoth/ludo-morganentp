/** Local (same device) match: runs the shared rules in the browser. */
import {
  type GameEvent,
  type GameState,
  applyMove,
  applyRoll,
  chooseAiMove,
  createGame,
  currentColor,
  legalMoves,
  rollDie,
} from "../shared/rules";
import { ms } from "./anim";
import type { GameView, SeatInfo } from "./view";

export class LocalMatch {
  private state: GameState;
  private stopped = false;

  constructor(
    private view: GameView,
    readonly seats: SeatInfo[],
  ) {
    this.state = createGame(seats.map((s) => s.color));
    const humans = seats.filter((s) => !s.ai);
    view.canAct = (c) => !this.isAi(c);
    view.followTurn = humans.length > 1;
    view.onRoll = () => this.humanRoll();
    view.onMove = (i) => this.humanMove(i);
    view.begin(this.state, seats, humans[0]?.color ?? null);
    void this.emit([]);
  }

  stop() {
    this.stopped = true;
  }

  private isAi(color: string) {
    return this.seats.find((s) => s.color === color)?.ai ?? true;
  }

  private async emit(events: GameEvent[]) {
    const s = this.state;
    const legal = s.phase === "move" && s.die !== null ? legalMoves(s, s.die) : [];
    await this.view.push({ state: s, events, legal, you: null });
    if (this.stopped || s !== this.state || s.phase === "over") return;
    if (this.isAi(currentColor(s))) setTimeout(() => this.aiStep(s), ms(380));
  }

  private aiStep(expected: GameState) {
    if (this.stopped || this.state !== expected) return;
    const s = this.state;
    const r = s.phase === "roll" ? applyRoll(s, rollDie()) : applyMove(s, chooseAiMove(s));
    this.state = r.state;
    void this.emit(r.events);
  }

  private humanRoll() {
    const s = this.state;
    if (this.stopped || s.phase !== "roll" || this.isAi(currentColor(s))) return;
    const r = applyRoll(s, rollDie());
    this.state = r.state;
    void this.emit(r.events);
  }

  private humanMove(token: number) {
    const s = this.state;
    if (this.stopped || s.phase !== "move" || this.isAi(currentColor(s))) return;
    try {
      const r = applyMove(s, token);
      this.state = r.state;
      void this.emit(r.events);
    } catch (e) {
      console.warn(e);
      void this.emit([]);
    }
  }
}
