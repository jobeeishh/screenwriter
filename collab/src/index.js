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
      case "caret":        // live cursor position {blkId, off}
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

/* ============================================================================
   One Share per published link. Unlike a Room, a Share DOES rest here: that is
   the point -- the reader has no copy and the writer may be offline. It holds
   one snapshot, pushed explicitly, plus a tally of who opened it.

   Capability, not identity: whoever holds the ownerKey may replace or revoke
   the snapshot and read the tally. There are no accounts involved.
   ==========================================================================*/

const MAX_DOC = 4_000_000;   // a very long script, JSON-encoded
const MAX_READS = 200;       // bound the tally; oldest sessions fall off

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const sha = async (s) => hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
const rand = () => hex(crypto.getRandomValues(new Uint8Array(16)));

/* Constant-time compare, so a wrong guess can't be narrowed by timing. */
const same = (a, b) => {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
};

export class Share extends DurableObject {
  async meta() { return (await this.ctx.storage.get("meta")) || null; }

  /* PUT: create on first call, replace afterwards. The first caller's ownerKey
     is the one that sticks. */
  async put(body) {
    const meta = await this.meta();
    if (meta && !same(meta.ownerKey, body.ownerKey || "")) return json({ error: "not yours" }, 403);

    const doc = JSON.stringify(body.doc || {});
    if (doc.length > MAX_DOC) return json({ error: "script too large to share" }, 413);

    const salt = (meta && meta.salt) || rand();
    let pass = meta ? meta.pass : null;
    if (body.password === "") pass = null;                       // explicitly removed
    else if (body.password) pass = await sha(salt + body.password);

    const next = {
      ownerKey: meta ? meta.ownerKey : (body.ownerKey || rand()),
      salt,
      pass,
      title: String(body.title || "Untitled").slice(0, 200),
      createdAt: meta ? meta.createdAt : Date.now(),
      updatedAt: Date.now(),
    };
    await this.ctx.storage.put("meta", next);
    await this.ctx.storage.put("doc", doc);
    return json({ ok: true, ownerKey: next.ownerKey, hasPassword: !!next.pass });
  }

  async open(body) {
    const meta = await this.meta();
    if (!meta) return json({ error: "gone" }, 404);
    if (meta.pass && !same(meta.pass, await sha(meta.salt + (body.password || ""))))
      return json({ needsPassword: true }, 401);
    const doc = await this.ctx.storage.get("doc");
    if (!doc) return json({ error: "gone" }, 404);
    return json({ title: meta.title, doc: JSON.parse(doc) });
  }

  /* One record per reader session, updated in place, so re-pinging while
     scrolling reports progress instead of inflating the count. */
  async read(body) {
    const meta = await this.meta();
    if (!meta) return json({ error: "gone" }, 404);
    const token = String(body.token || "").slice(0, 64);
    if (!token) return json({ ok: false });
    const reads = (await this.ctx.storage.get("reads")) || {};
    const prev = reads[token] || { at: Date.now(), depth: 0, seconds: 0 };
    reads[token] = {
      at: prev.at,
      depth: Math.max(prev.depth, Math.min(1, Number(body.depth) || 0)),
      seconds: Math.max(prev.seconds, Math.min(86400, Number(body.seconds) || 0)),
    };
    const keys = Object.keys(reads);
    if (keys.length > MAX_READS) {
      keys.sort((a, b) => reads[a].at - reads[b].at)
        .slice(0, keys.length - MAX_READS)
        .forEach((k) => delete reads[k]);
    }
    await this.ctx.storage.put("reads", reads);
    return json({ ok: true });
  }

  async stats(body) {
    const meta = await this.meta();
    if (!meta) return json({ error: "gone" }, 404);
    if (!same(meta.ownerKey, body.ownerKey || "")) return json({ error: "not yours" }, 403);
    const reads = (await this.ctx.storage.get("reads")) || {};
    const list = Object.values(reads).sort((a, b) => b.at - a.at);
    return json({
      title: meta.title,
      hasPassword: !!meta.pass,
      updatedAt: meta.updatedAt,
      opens: list.length,
      finished: list.filter((r) => r.depth >= 0.9).length,
      reads: list.slice(0, 50),
    });
  }

  async revoke(body) {
    const meta = await this.meta();
    if (!meta) return json({ ok: true });
    if (!same(meta.ownerKey, body.ownerKey || "")) return json({ error: "not yours" }, 403);
    await this.ctx.storage.deleteAll();
    return json({ ok: true });
  }

  async fetch(request) {
    const url = new URL(request.url);
    const action = url.pathname.split("/").pop();
    let body = {};
    try { body = await request.json(); } catch {}
    switch (action) {
      case "put":    return this.put(body);
      case "open":   return this.open(body);
      case "read":   return this.read(body);
      case "stats":  return this.stats(body);
      case "revoke": return this.revoke(body);
      default:       return json({ error: "not found" }, 404);
    }
  }
}

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });

/* Reflect the caller's origin rather than answering "*". sendBeacon always
   sends credentialed, and a wildcard is rejected outright for those -- which is
   how the read pings silently vanished. Access is a capability (the ownerKey),
   never the origin, so reflecting any caller is safe here. */
const cors = (origin) => ({
  "Access-Control-Allow-Origin": origin || "*",
  "Access-Control-Allow-Credentials": "true",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Max-Age": "86400",
  Vary: "Origin",
});

const withCORS = (res, origin) => {
  const h = new Headers(res.headers);
  Object.entries(cors(origin)).forEach(([k, v]) => h.set(k, v));
  return new Response(res.body, { status: res.status, headers: h });
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });

    const room = url.pathname.match(/^\/room\/([a-z0-9-]{1,64})$/);
    if (room) return env.ROOM.getByName(room[1]).fetch(request);

    /* /share/<id>/<action>, all POST: a password must never ride in a URL. */
    const share = url.pathname.match(/^\/share\/([A-Za-z0-9_-]{1,64})\/(put|open|read|stats|revoke)$/);
    if (share) {
      if (request.method !== "POST") return withCORS(json({ error: "use POST" }, 405), origin);
      return withCORS(await env.SHARE.getByName(share[1]).fetch(request), origin);
    }

    return new Response("not found", { status: 404 });
  },
};
