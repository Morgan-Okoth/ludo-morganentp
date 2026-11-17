import { DurableObject } from "cloudflare:workers";
import type { Env } from "./index";

/**
 * One GameRoom per room code. It will own the authoritative game state,
 * roll the dice, and validate moves. For now it only relays join/leave
 * and echoes presence so clients can connect end to end.
 */
export class GameRoom extends DurableObject<Env> {
  async fetch(_request: Request): Promise<Response> {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    this.broadcast({ type: "presence", players: this.ctx.getWebSockets().length });
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string") return;
    let msg: { type?: string };
    try {
      msg = JSON.parse(message);
    } catch {
      return;
    }
    if (msg.type === "ping") ws.send(JSON.stringify({ type: "pong" }));
    // TODO: "roll" and "move" handled by shared rules module.
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    ws.close(code);
    this.broadcast({ type: "presence", players: this.ctx.getWebSockets().length });
  }

  private broadcast(data: unknown): void {
    const text = JSON.stringify(data);
    for (const ws of this.ctx.getWebSockets()) ws.send(text);
  }
}
