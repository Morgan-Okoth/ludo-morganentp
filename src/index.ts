import { GameRoom } from "./room";

export { GameRoom };

export interface Env {
  ROOM: DurableObjectNamespace;
  DB: D1Database;
  SESSIONS: KVNamespace;
  ASSETS: Fetcher;
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function newRoomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/rooms" && request.method === "POST") {
      return Response.json({ code: newRoomCode() });
    }

    const match = url.pathname.match(/^\/api\/rooms\/([A-Z0-9]{5})\/ws$/);
    if (match) {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("Expected WebSocket", { status: 426 });
      }
      const stub = env.ROOM.get(env.ROOM.idFromName(match[1]));
      return stub.fetch(request);
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
