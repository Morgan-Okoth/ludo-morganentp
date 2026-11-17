/**
 * Pure Ludo rules. No DOM, no Cloudflare APIs, so the same code can run in
 * the GameRoom Durable Object (authoritative) and in the browser (offline/AI).
 *
 * Token progress is a single number per token ("step"):
 *   0        in the yard
 *   1..51    on the shared ring (step 1 is the colour's entry square)
 *   52..57   in the colour's private home column
 *   58       finished (TOTAL)
 * These match the constants in the original index.html.
 */

export type Color = "red" | "green" | "yellow" | "blue";
export const COLORS: readonly Color[] = ["red", "green", "yellow", "blue"];

export const RING_LEN = 51;
export const TOTAL = RING_LEN + 7; // 58
export const TOKENS_PER_PLAYER = 4;

/** Ring index where each colour's step 1 sits (same as EI in index.html). */
export const ENTRY_INDEX: Record<Color, number> = {
  red: 0,
  green: 13,
  yellow: 38,
  blue: 25,
};

/**
 * Safe ring indices: the four entry squares plus the four star squares
 * behind them, derived from the SAFE set in index.html.
 */
export const SAFE_RING_INDICES: ReadonlySet<number> = new Set([
  0, 13, 25, 38, // entry squares [6,1] [1,8] [8,13] [13,6]
  1, 8, 14, 21, 26, 33, 39, 46, // [6,2] [2,6] [2,8] [6,12] [8,12] [12,8] [12,6] [8,2]
]);

export type Phase = "roll" | "move" | "over";

export interface GameState {
  players: Color[];
  /** steps[color][tokenIndex] */
  steps: Record<string, number[]>;
  turn: number; // index into players
  die: number | null;
  phase: Phase;
  winner: Color | null;
}

export type GameEvent =
  | { type: "rolled"; color: Color; die: number }
  | { type: "skipped"; color: Color }
  | { type: "moved"; color: Color; token: number; from: number; to: number }
  | { type: "captured"; by: Color; victim: Color; token: number }
  | { type: "home"; color: Color; token: number }
  | { type: "won"; color: Color }
  | { type: "turn"; color: Color; extra: boolean };

export function createGame(players: Color[]): GameState {
  if (players.length < 2 || players.length > 4) {
    throw new Error("Ludo needs 2 to 4 players");
  }
  if (new Set(players).size !== players.length) {
    throw new Error("Duplicate colours");
  }
  const steps: Record<string, number[]> = {};
  for (const c of players) steps[c] = Array(TOKENS_PER_PLAYER).fill(0);
  return { players: [...players], steps, turn: 0, die: null, phase: "roll", winner: null };
}

export function currentColor(state: GameState): Color {
  return state.players[state.turn]!;
}

/** Ring index of a token, or null if it is in the yard, home column, or done. */
export function ringIndex(color: Color, step: number): number | null {
  if (step < 1 || step > RING_LEN) return null;
  return (ENTRY_INDEX[color] + step - 1) % RING_LEN;
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
  const steps = state.steps[currentColor(state)]!;
  const out: number[] = [];
  steps.forEach((s, i) => {
    if (s === 0) {
      if (die === 6) out.push(i);
    } else if (s < TOTAL && s + die <= TOTAL) {
      out.push(i);
    }
  });
  return out;
}

function clone(state: GameState): GameState {
  const steps: Record<string, number[]> = {};
  for (const c of state.players) steps[c] = [...state.steps[c]!];
  return { ...state, players: [...state.players], steps };
}

function advanceTurn(state: GameState, events: GameEvent[]): void {
  let tries = 0;
  do {
    state.turn = (state.turn + 1) % state.players.length;
    tries++;
  } while (
    state.steps[currentColor(state)]!.every((s) => s === TOTAL) &&
    tries < state.players.length
  );
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
  const steps = state.steps[color]!;
  const from = steps[token]!;
  const to = from === 0 ? 1 : from + die;
  steps[token] = to;
  events.push({ type: "moved", color, token, from, to });

  const ri = ringIndex(color, to);
  if (ri !== null && !SAFE_RING_INDICES.has(ri)) {
    for (const other of state.players) {
      if (other === color) continue;
      state.steps[other]!.forEach((s, i) => {
        if (ringIndex(other, s) === ri) {
          state.steps[other]![i] = 0;
          events.push({ type: "captured", by: color, victim: other, token: i });
        }
      });
    }
  }

  if (to === TOTAL) {
    events.push({ type: "home", color, token });
    if (steps.every((s) => s === TOTAL)) {
      state.phase = "over";
      state.winner = color;
      state.die = null;
      events.push({ type: "won", color });
      return { state, events };
    }
  }

  // A 6 earns another roll (same rule as the original game).
  if (die === 6) {
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
  const moves = legalMoves(state, state.die);
  const color = currentColor(state);
  const steps = state.steps[color]!;

  // Prefer entering, then capturing, then the furthest token.
  const enter = moves.find((i) => steps[i] === 0);
  if (enter !== undefined) return enter;

  for (const i of moves) {
    const ri = ringIndex(color, steps[i]! + state.die);
    if (ri === null || SAFE_RING_INDICES.has(ri)) continue;
    const hit = state.players.some(
      (o) => o !== color && state.steps[o]!.some((s) => ringIndex(o, s) === ri),
    );
    if (hit) return i;
  }
  return moves.reduce((best, i) => (steps[i]! > steps[best]! ? i : best), moves[0]!);
}
