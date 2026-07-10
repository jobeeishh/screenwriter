import { DurableObject } from "cloudflare:workers";

/* ============================================================================
   One Room per script id. A pure relay: presence + message fan-out, nothing
   stored. The script itself never rests here -- a newcomer gets the latest
   copy by asking connected peers (sync-request), so the server holds no
   document data and hibernates freely between messages.
   ==========================================================================*/

const MAX_MSG = 900_000; // Workers caps WS messages at 1MiB; leave headroom

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    // keepalive pings answered without waking the object
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket")
      return new Response("expected websocket", { status: 426 });
    const url = new URL(request.url);
    const name = (url.searchParams.get("name") || "Someone").slice(0, 40);
    const [client, server] = Object.values(new WebSocketPair());
    server.serializeAttachment({ name });
    this.ctx.acceptWebSocket(server);

    server.send(JSON.stringify({ type: "roster", names: this.roster(server) }));
    this.broadcast(server, { type: "join", name });
    return new Response(null, { status: 101, webSocket: client });
  }

  roster(except) {
    return this.ctx.getWebSockets()
      .filter((s) => s !== except)
      .map((s) => ((s.deserializeAttachment() || {}).name || "Someone"));
  }

  broadcast(from, msg) {
    const data = typeof msg === "string" ? msg : JSON.stringify(msg);
    for (const s of this.ctx.getWebSockets()) {
      if (s === from) continue;
      try { s.send(data); } catch {}
    }
  }

  async webSocketMessage(ws, message) {
    if (typeof message !== "string" || message.length > MAX_MSG) {
      try { ws.send(JSON.stringify({ type: "error", error: "message too large" })); } catch {}
      return;
    }
    let msg;
    try { msg = JSON.parse(message); } catch { return; }
    const from = (ws.deserializeAttachment() || {}).name || "Someone";

    switch (msg.type) {
      case "doc":          // a saved copy of the script: fan out to peers
      case "editing":      // typing indicator
      case "sync-request": // newcomer asking peers for the latest copy
        this.broadcast(ws, JSON.stringify({ ...msg, from }));
        break;
      default:
        break; // unknown types are dropped, never relayed
    }
  }

  async webSocketClose(ws, code, reason) {
    this.broadcast(ws, { type: "leave", name: (ws.deserializeAttachment() || {}).name || "Someone" });
    try { ws.close(code, reason); } catch {}
  }

  async webSocketError(ws) {
    this.broadcast(ws, { type: "leave", name: (ws.deserializeAttachment() || {}).name || "Someone" });
  }
}

export default {
  async fetch(request, env) {
    const m = new URL(request.url).pathname.match(/^\/room\/([a-z0-9-]{1,64})$/);
    if (!m) return new Response("not found", { status: 404 });
    return env.ROOM.getByName(m[1]).fetch(request);
  },
};
