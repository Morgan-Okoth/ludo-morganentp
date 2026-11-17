/**
 * Pure Ludo rules for 2 to 6 players. No DOM, no Cloudflare APIs, so the same
 * code runs in the GameRoom Durable Object (authoritative) and in the browser
 * (local games and AI).
 *
 * The board has N "arms" (N = 4 for 2-4 players, otherwise one per player):
 * a regular N-gon centre with a 3x6 arm on each edge. N = 4 is the classic
 * cross, 5 is a pentagon, 6 a hexagon. Each arm contributes 13 cells to the
 * shared ring, so the ring has 13 * N cells.
 *
 * Token progress is a single number per token ("step"):
 *   0                      in the yard
 *   1 .. ringLen-1         on the shared ring (step 1 is the colour's entry cell)
 *   ringLen .. ringLen+4   in the colour's private home column (5 cells)
 *   ringLen+5              finished (centre)
 */

export type Color = "red" | "green" | "yellow" | "blue" | "purple" | "orange";

/** Arm order around the board. A colour always sits on arm COLORS.indexOf(color). */
export const COLORS: readonly Color[] = ["red", "green", "yellow", "blue", "purple", "orange"];

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;
export const TOKENS_PER_PLAYER = 4;
export const CELLS_PER_ARM = 13;
export const HOME_COLUMN = 5;
/** Star (safe) cell offset from each arm's entry cell, as on a classic board. */
export const STAR_OFFSET = 8;

/** Colours used for a game with n players. Two players sit opposite each other. */
export function colorsFor(n: number): Color[] {
  if (n < MIN_PLAYERS || n > MAX_PLAYERS) throw new Error(`Ludo needs ${MIN_PLAYERS} to ${MAX_PLAYERS} players`);
  if (n === 2) return ["red", "yellow"];
  return COLORS.slice(0, n) as Color[];
}

export function armCountFor(n: number): number {
  return Math.max(4, n);
}

export const ringLength = (arms: number) => CELLS_PER_ARM * arms;
export const finishStep = (arms: number) => ringLength(arms) + HOME_COLUMN;
export const armOf = (color: Color) => COLORS.indexOf(color);

export type Phase = "roll" | "move" | "over";

export interface GameState {
  arms: number;
  players: Color[];
  /** steps[color][tokenIndex] */
  steps: Record<string, number[]>;
  turn: number; // index into players
  die: number | null;
  phase: Phase;
  winner: Color | null;
  /** Finishing order, winner first. */
  finished: Color[];
}

export type GameEvent =
  | { type: "rolled"; color: Color; die: number }
  | { type: "skipped"; color: Color }
  | { type: "moved"; color: Color; token: number; from: number; to: number }
  | { type: "captured"; by: Color; victim: Color; token: number; from: number }
  | { type: "home"; color: Color; token: number }
  | { type: "won"; color: Color }
  | { type: "turn"; color: Color; extra: boolean };

export function createGame(players: Color[]): GameState {
  if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) {
    throw new Error(`Ludo needs ${MIN_PLAYERS} to ${MAX_PLAYERS} players`);
  }
  if (new Set(players).size !== players.length) throw new Error("Duplicate colours");
  if (players.some((c) => !COLORS.includes(c))) throw new Error("Unknown colour");
  const arms = armCountFor(players.length);
  if (players.some((c) => armOf(c) >= arms)) throw new Error("Colour does not fit this board");

  // Turn order follows the arms clockwise.
  const ordered = [...players].sort((a, b) => armOf(a) - armOf(b));
  const steps: Record<string, number[]> = {};
  for (const c of ordered) steps[c] = Array(TOKENS_PER_PLAYER).fill(0);
  return { arms, players: ordered, steps, turn: 0, die: null, phase: "roll", winner: null, finished: [] };
}

export function currentColor(state: GameState): Color {
  return state.players[state.turn]!;
}

/** Ring cell index of a token, or null if it is in the yard, home column, or done. */
export function ringIndex(arms: number, color: Color, step: number): number | null {
  const len = ringLength(arms);
  if (step < 1 || step >= len) return null;
  return (armOf(color) * CELLS_PER_ARM + step - 1) % len;
}

export function isSafeCell(ri: number): boolean {
  const off = ri % CELLS_PER_ARM;
  return off === 0 || off === STAR_OFFSET;
}

/** Roll a fair die using the supplied random source (default: Web Crypto). */
export function rollDie(random: () => number = cryptoRandom): number {
  return Math.floor(random() * 6) + 1;
}

function cryptoRandom(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0]! / 0x1_0000_0000;
}

/** Token indices the current player may move with the given die. */
export function legalMoves(state: GameState, die: number): number[] {
  const fin = finishStep(state.arms);
  const steps = state.steps[currentColor(state)]!;
  const out: number[] = [];
  steps.forEach((s, i) => {
    if (s === 0) {
      if (die === 6) out.push(i);
    } else if (s < fin && s + die <= fin) {
      out.push(i);
    }
  });
  return out;
}

function clone(state: GameState): GameState {
  const steps: Record<string, number[]> = {};
  for (const c of state.players) steps[c] = [...state.steps[c]!];
  return { ...state, players: [...state.players], steps, finished: [...state.finished] };
}

function isDone(state: GameState, color: Color): boolean {
  const fin = finishStep(state.arms);
  return state.steps[color]!.every((s) => s === fin);
}

function advanceTurn(state: GameState, events: GameEvent[]): void {
  let tries = 0;
  do {
    state.turn = (state.turn + 1) % state.players.length;
    tries++;
  } while (isDone(state, currentColor(state)) && tries < state.players.length);
  state.die = null;
  state.phase = "roll";
  events.push({ type: "turn", color: currentColor(state), extra: false });
}

export interface StepResult {
  state: GameState;
  events: GameEvent[];
}

/**
 * Register a die roll for the current player. If no move is possible the
 * turn passes automatically; otherwise the phase becomes "move".
 */
export function applyRoll(prev: GameState, die: number): StepResult {
  if (prev.phase !== "roll") throw new Error("Not in roll phase");
  if (!Number.isInteger(die) || die < 1 || die > 6) throw new Error("Bad die value");
  const state = clone(prev);
  const events: GameEvent[] = [];
  const color = currentColor(state);
  state.die = die;
  events.push({ type: "rolled", color, die });

  if (legalMoves(state, die).length === 0) {
    events.push({ type: "skipped", color });
    advanceTurn(state, events);
  } else {
    state.phase = "move";
  }
  return { state, events };
}

/** Move one of the current player's tokens by the pending die. */
export function applyMove(prev: GameState, token: number): StepResult {
  if (prev.phase !== "move" || prev.die === null) throw new Error("Not in move phase");
  if (!legalMoves(prev, prev.die).includes(token)) throw new Error("Illegal move");

  const state = clone(prev);
  const events: GameEvent[] = [];
  const color = currentColor(state);
  const die = state.die!;
  const fin = finishStep(state.arms);
  const steps = state.steps[color]!;
  const from = steps[token]!;
  const to = from === 0 ? 1 : from + die;
  steps[token] = to;
  events.push({ type: "moved", color, token, from, to });

  let bonus = die === 6;
  const ri = ringIndex(state.arms, color, to);
  if (ri !== null && !isSafeCell(ri)) {
    for (const other of state.players) {
      if (other === color) continue;
      state.steps[other]!.forEach((s, i) => {
        if (ringIndex(state.arms, other, s) === ri) {
          state.steps[other]![i] = 0;
          events.push({ type: "captured", by: color, victim: other, token: i, from: s });
          bonus = true; // capturing earns another roll
        }
      });
    }
  }

  if (to === fin) {
    events.push({ type: "home", color, token });
    bonus = true; // reaching home earns another roll
    if (isDone(state, color)) {
      state.finished.push(color);
      if (!state.winner) {
        state.winner = color;
        events.push({ type: "won", color });
      }
      // The game ends when only one player is left with tokens on the board.
      if (state.players.length - state.finished.length <= 1) {
        const last = state.players.find((c) => !state.finished.includes(c));
        if (last) state.finished.push(last);
        state.phase = "over";
        state.die = null;
        return { state, events };
      }
      advanceTurn(state, events);
      return { state, events };
    }
  }

  if (bonus) {
    state.die = null;
    state.phase = "roll";
    events.push({ type: "turn", color, extra: true });
  } else {
    advanceTurn(state, events);
  }
  return { state, events };
}

/** Simple AI used for computer players and for AI takeover of dropped seats. */
export function chooseAiMove(state: GameState): number {
  if (state.phase !== "move" || state.die === null) throw new Error("No move pending");
  const die = state.die;
  const moves = legalMoves(state, die);
  const color = currentColor(state);
  const steps = state.steps[color]!;
  const fin = finishStep(state.arms);

  const enemyAt = (ri: number) =>
    state.players.some(
      (o) => o !== color && state.steps[o]!.some((s) => ringIndex(state.arms, o, s) === ri),
    );

  let best = moves[0]!;
  let bestScore = -Infinity;
  for (const i of moves) {
    const from = steps[i]!;
    const to = from === 0 ? 1 : from + die;
    const ri = ringIndex(state.arms, color, to);
    let score = to; // progress
    if (to === fin) score += 120;
    if (from === 0) score += 80;
    if (ri !== null && !isSafeCell(ri) && enemyAt(ri)) score += 150;
    if (ri !== null && isSafeCell(ri)) score += 20;
    if (to >= ringLength(state.arms)) score += 30; // into the home column
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}
