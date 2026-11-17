import { DurableObject } from "cloudflare:workers";
import type { Env } from "./index";
import {
  COLORS,
  type Color,
  type GameEvent,
  type GameState,
  applyMove,
  applyRoll,
  chooseAiMove,
  createGame,
  currentColor,
  legalMoves,
  rollDie,
} from "./shared/rules";

interface Seat {
  color: Color;
  name: string;
  ai: boolean;
  /** Stable id supplied by the client so a refresh reclaims the same seat. */
  clientId: string | null;
}

interface RoomData {
  seats: Seat[];
  hostId: string | null;
  game: GameState | null;
}

type ClientMessage =
  | { type: "join"; clientId: string; name?: string }
  | { type: "addAi" }
  | { type: "removeAi"; color: Color }
  | { type: "start" }
  | { type: "roll" }
  | { type: "move"; token: number }
  | { type: "ping" };

/** Long enough for clients to finish the dice and token animations. */
const AI_DELAY_MS = 2400;
const MAX_NAME = 20;

/**
 * One GameRoom per room code. Owns the authoritative game state: dice are
 * rolled here and every move is validated by the shared rules module.
 */
export class GameRoom extends DurableObject<Env> {
  private data: RoomData = { seats: [], hostId: null, game: null };

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      const saved = await ctx.storage.get<RoomData>("room");
      if (saved) this.data = saved;
    });
  }

  async fetch(_request: Request): Promise<Response> {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== "string" || raw.length > 2048) return;
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw) as ClientMessage;
    } catch {
      return;
    }

    if (msg.type === "ping") {
      ws.send(JSON.stringify({ type: "pong" }));
      return;
    }
    if (msg.type === "join") {
      await this.handleJoin(ws, msg);
      return;
    }

    const clientId = this.clientIdOf(ws);
    if (!clientId) return this.error(ws, "Join the room first");

    let events: GameEvent[] = [];
    try {
      switch (msg.type) {
        case "addAi":
          this.requireHost(clientId);
          this.requireLobby();
          this.addSeat({ name: "", ai: true, clientId: null });
          break;
        case "removeAi":
          this.requireHost(clientId);
          this.requireLobby();
          this.data.seats = this.data.seats.filter((s) => !(s.ai && s.color === msg.color));
          break;
        case "start":
          this.requireHost(clientId);
          this.requireLobby();
          if (this.data.seats.length < 2) throw new Error("Need at least 2 players");
          this.data.game = createGame(this.sortedSeats().map((s) => s.color));
          break;
        case "roll":
          events = this.humanAction(clientId, (game) => {
            if (game.phase !== "roll") throw new Error("Not your roll");
            return applyRoll(game, rollDie());
          });
          break;
        case "move":
          events = this.humanAction(clientId, (game) => {
            if (game.phase !== "move") throw new Error("Roll first");
            return applyMove(game, Number(msg.token));
          });
          break;
        default:
          return;
      }
    } catch (e) {
      return this.error(ws, e instanceof Error ? e.message : "Error");
    }
    await this.afterChange(events);
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    try {
      ws.close(code === 1005 ? 1000 : code);
    } catch {
      /* already closed */
    }
    this.broadcastLobby();
    await this.scheduleAi();
  }

  async alarm(): Promise<void> {
    const game = this.data.game;
    if (!game || game.phase === "over") return;
    const seat = this.seatFor(currentColor(game));
    if (!seat || !this.isAiControlled(seat)) return;

    let result;
    if (game.phase === "roll") result = applyRoll(game, rollDie());
    else result = applyMove(game, chooseAiMove(game));
    this.data.game = result.state;
    await this.save();
    this.broadcastState(result.events);
    await this.scheduleAi();
  }

  // ---- handlers ---------------------------------------------------------

  private async handleJoin(ws: WebSocket, msg: Extract<ClientMessage, { type: "join" }>) {
    const clientId = String(msg.clientId ?? "").slice(0, 64);
    if (!clientId) return this.error(ws, "Missing clientId");
    const name = String(msg.name ?? "").trim().slice(0, MAX_NAME) || "Player";

    ws.serializeAttachment({ clientId });
    let seat = this.data.seats.find((s) => s.clientId === clientId);
    if (!seat) {
      if (this.data.game) return this.error(ws, "Game already started");
      if (this.data.seats.length >= COLORS.length) return this.error(ws, "Room is full");
      seat = this.addSeat({ name, ai: false, clientId });
    } else if (!this.data.game) {
      seat.name = name;
    }
    if (!this.data.hostId) this.data.hostId = clientId;

    await this.save();
    this.broadcastLobby();
    if (this.data.game) ws.send(JSON.stringify(this.statePayload([], clientId)));
    await this.scheduleAi();
  }

  private async afterChange(events: GameEvent[] = []): Promise<void> {
    await this.save();
    this.broadcastLobby();
    if (this.data.game) this.broadcastState(events);
    await this.scheduleAi();
  }

  // ---- helpers ----------------------------------------------------------

  private humanAction(
    clientId: string,
    run: (game: GameState) => { state: GameState; events: GameEvent[] },
  ): GameEvent[] {
    const game = this.data.game;
    if (!game || game.phase === "over") throw new Error("No game in progress");
    const seat = this.seatFor(currentColor(game));
    if (!seat || seat.clientId !== clientId) throw new Error("Not your turn");
    const result = run(game);
    this.data.game = result.state;
    return result.events;
  }

  private addSeat(init: Omit<Seat, "color">): Seat {
    const taken = new Set(this.data.seats.map((s) => s.color));
    const color = COLORS.find((c) => !taken.has(c));
    if (!color) throw new Error("Room is full");
    const seat: Seat = { ...init, color };
    if (seat.ai) seat.name = `AI ${color}`;
    this.data.seats.push(seat);
    return seat;
  }

  private sortedSeats(): Seat[] {
    return [...this.data.seats].sort((a, b) => COLORS.indexOf(a.color) - COLORS.indexOf(b.color));
  }

  private seatFor(color: Color): Seat | undefined {
    return this.data.seats.find((s) => s.color === color);
  }

  private clientIdOf(ws: WebSocket): string | null {
    const att = ws.deserializeAttachment() as { clientId?: string } | null;
    return att?.clientId ?? null;
  }

  private connectedIds(): Set<string> {
    const ids = new Set<string>();
    for (const ws of this.ctx.getWebSockets()) {
      const id = this.clientIdOf(ws);
      if (id) ids.add(id);
    }
    return ids;
  }

  /** AI seats always play; a human seat is taken over by AI while disconnected. */
  private isAiControlled(seat: Seat): boolean {
    return seat.ai || (seat.clientId !== null && !this.connectedIds().has(seat.clientId));
  }

  private requireHost(clientId: string) {
    if (this.data.hostId !== clientId) throw new Error("Only the host can do that");
  }

  private requireLobby() {
    if (this.data.game) throw new Error("Game already started");
  }

  private async scheduleAi(): Promise<void> {
    const game = this.data.game;
    if (!game || game.phase === "over") return;
    const seat = this.seatFor(currentColor(game));
    if (seat && this.isAiControlled(seat)) {
      await this.ctx.storage.setAlarm(Date.now() + AI_DELAY_MS);
    }
  }

  private async save(): Promise<void> {
    await this.ctx.storage.put("room", this.data);
  }

  private error(ws: WebSocket, message: string): void {
    ws.send(JSON.stringify({ type: "error", message }));
  }

  /** Client ids are credentials, so they are never sent to other players. */
  private lobbyPayload(clientId: string | null) {
    const connected = this.connectedIds();
    const mine = this.data.seats.find((s) => s.clientId !== null && s.clientId === clientId);
    const host = this.data.seats.find((s) => s.clientId === this.data.hostId);
    return {
      type: "lobby" as const,
      started: this.data.game !== null,
      you: mine?.color ?? null,
      host: host?.color ?? null,
      seats: this.sortedSeats().map((s) => ({
        color: s.color,
        name: s.name,
        ai: s.ai,
        connected: s.ai || (s.clientId !== null && connected.has(s.clientId)),
      })),
    };
  }

  private statePayload(events: GameEvent[], clientId: string) {
    const seat = this.data.seats.find((s) => s.clientId === clientId);
    const game = this.data.game;
    const legal =
      game && game.phase === "move" && game.die !== null ? legalMoves(game, game.die) : [];
    return { type: "state" as const, state: game, events, legal, you: seat?.color ?? null };
  }

  private broadcastLobby(): void {
    for (const ws of this.ctx.getWebSockets()) {
      ws.send(JSON.stringify(this.lobbyPayload(this.clientIdOf(ws))));
    }
  }

  private broadcastState(events: GameEvent[]): void {
    for (const ws of this.ctx.getWebSockets()) {
      const id = this.clientIdOf(ws);
      if (id) ws.send(JSON.stringify(this.statePayload(events, id)));
    }
  }
}
