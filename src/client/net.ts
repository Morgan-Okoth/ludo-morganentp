/** WebSocket client for a GameRoom. Reconnects automatically. */
import type { Color, GameState } from "../shared/rules";
import type { StateMsg } from "./view";

export interface LobbySeat {
  id: string;
  color: Color | null;
  name: string;
  ai: boolean;
  connected: boolean;
}

export interface LobbyMsg {
  type: "lobby";
  started: boolean;
  you: string | null;
  host: string | null;
  seats: LobbySeat[];
}

export function clientId(): string {
  let id = localStorage.getItem("ludo.clientId");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("ludo.clientId", id);
  }
  return id;
}

export class RoomClient {
  private ws: WebSocket | null = null;
  private closed = false;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private ping: ReturnType<typeof setInterval> | undefined;
  lobby: LobbyMsg | null = null;
  onLobby: (m: LobbyMsg) => void = () => {};
  onState: (m: StateMsg & { state: GameState }) => void = () => {};
  onError: (message: string) => void = () => {};
  onStatus: (s: "connected" | "reconnecting") => void = () => {};

  constructor(
    readonly code: string,
    private name: string,
  ) {
    this.connect();
  }

  private connect() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${location.host}/api/rooms/${this.code}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.onStatus("connected");
      this.send({ type: "join", clientId: clientId(), name: this.name });
      clearInterval(this.ping);
      this.ping = setInterval(() => this.send({ type: "ping" }), 25_000);
    };
    ws.onmessage = (e) => {
      let m: { type: string; [k: string]: unknown };
      try {
        m = JSON.parse(String(e.data));
      } catch {
        return;
      }
      if (m.type === "lobby") {
        this.lobby = m as unknown as LobbyMsg;
        this.onLobby(this.lobby);
      } else if (m.type === "state" && m.state) {
        this.onState(m as unknown as StateMsg);
      } else if (m.type === "error") {
        this.onError(String(m.message));
      }
    };
    ws.onclose = () => {
      clearInterval(this.ping);
      if (this.closed || ws !== this.ws) return;
      this.onStatus("reconnecting");
      this.retry = setTimeout(() => this.connect(), 1500);
    };
  }

  send(msg: Record<string, unknown>) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  close() {
    this.closed = true;
    clearTimeout(this.retry);
    clearInterval(this.ping);
    this.ws?.close();
  }
}

export async function createRoom(): Promise<string> {
  const res = await fetch("/api/rooms", { method: "POST" });
  if (!res.ok) throw new Error("Could not create a room");
  const { code } = (await res.json()) as { code: string };
  return code;
}
