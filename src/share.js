/* ============================================================================
   Share links: publish a snapshot of the script to a URL anyone can read.

   The reader never gets the project, only a copy that was pushed on purpose.
   Ownership is a capability, not an account: the ownerKey minted on the first
   publish is what lets you replace, revoke, or read the tally afterwards, and
   it lives in localStorage next to the script.
   ==========================================================================*/

import { COLLAB_URL } from "./config.js";

/* The collab worker speaks wss:// for rooms and https:// for shares. */
export const SHARE_BASE = String(COLLAB_URL || "").replace(/^ws/, "http").replace(/\/$/, "");
export const shareEnabled = () => !!SHARE_BASE;

const KEYS = "screenwriter-share-keys-v1";

const allKeys = () => {
  try { return JSON.parse(localStorage.getItem(KEYS)) || {}; } catch { return {}; }
};
export const shareRecord = (scriptId) => allKeys()[scriptId] || null;
const remember = (scriptId, rec) => {
  const all = allKeys();
  if (rec) all[scriptId] = rec; else delete all[scriptId];
  try { localStorage.setItem(KEYS, JSON.stringify(all)); } catch {}
};

const post = async (id, action, body) => {
  if (!SHARE_BASE) throw new Error("Sharing needs the collab worker; none is configured.");
  const r = await fetch(`${SHARE_BASE}/share/${id}/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  let data = null;
  try { data = await r.json(); } catch {}
  return { ok: r.ok, status: r.status, data: data || {} };
};

const newId = () =>
  [...crypto.getRandomValues(new Uint8Array(9))]
    .map((b) => "abcdefghijkmnpqrstuvwxyz23456789"[b % 32]).join("");

export const shareURL = (id) => `${location.origin}/s/${id}`;

/* Publish (or re-publish) the current draft. Passing password:"" clears one;
   omitting either option leaves that setting as it was. */
export async function publish(scriptId, doc, { password, comments } = {}) {
  const prev = shareRecord(scriptId);
  const id = prev ? prev.id : newId();
  const ownerKey = prev ? prev.ownerKey : null;
  const res = await post(id, "put", {
    doc, ownerKey, title: doc.title || "Untitled",
    ...(password === undefined ? {} : { password }),
    ...(comments === undefined ? {} : { comments }),
  });
  if (!res.ok) {
    /* the worker answers 404 for an unknown route, which is exactly what an
       older deploy without the Share class looks like from here */
    if (res.status === 404) throw new Error("The collab worker needs redeploying before links can be published.");
    throw new Error(res.data.error || "Could not publish that link.");
  }
  const rec = {
    id,
    ownerKey: res.data.ownerKey,
    hasPassword: !!res.data.hasPassword,
    comments: !!res.data.comments,
  };
  remember(scriptId, rec);
  return rec;
}

/* ---------------------------------------------------------------- comments */
export async function addComment(id, { blockId, text, name, password }) {
  const res = await post(id, "comment", { blockId, text, name, password });
  if (!res.ok) throw new Error(res.data.error || "Could not leave that note.");
  return res.data.comment;
}

export async function deleteComment(scriptId, commentId) {
  const rec = shareRecord(scriptId);
  if (!rec) return;
  await post(rec.id, "uncomment", { ownerKey: rec.ownerKey, commentId });
}

/* the reader's name, remembered so they only type it once */
export const readerName = () => {
  try { return localStorage.getItem("sw-reader-name") || ""; } catch { return ""; }
};
export const setReaderName = (n) => {
  try { localStorage.setItem("sw-reader-name", n); } catch {}
};

export async function openShare(id, password) {
  const res = await post(id, "open", password === undefined ? {} : { password });
  if (res.status === 401) return { needsPassword: true };
  if (!res.ok) throw new Error(res.data.error === "gone" ? "This link is no longer available." : "Could not open that link.");
  return res.data;
}

export async function shareStats(scriptId) {
  const rec = shareRecord(scriptId);
  if (!rec) return null;
  const res = await post(rec.id, "stats", { ownerKey: rec.ownerKey });
  if (!res.ok) return null;
  return res.data;
}

export async function revokeShare(scriptId) {
  const rec = shareRecord(scriptId);
  if (!rec) return;
  await post(rec.id, "revoke", { ownerKey: rec.ownerKey });
  remember(scriptId, null);
}

/* --------------------------------------------------------------- reading ---
   One token per reader session, so re-pinging while scrolling reports progress
   on the same visit instead of counting as a new open. */
export function trackReading(id) {
  let token;
  try {
    token = sessionStorage.getItem("sw-read-token");
    if (!token) { token = newId() + newId(); sessionStorage.setItem("sw-read-token", token); }
  } catch { token = newId() + newId(); }

  const started = Date.now();
  let depth = 0;
  let stopped = false;

  const measure = () => {
    const h = document.documentElement;
    const room = h.scrollHeight - h.clientHeight;
    depth = room > 0 ? Math.min(1, (h.scrollTop || window.scrollY) / room) : 1;
  };
  const send = () => {
    if (stopped) return;
    measure();
    const body = JSON.stringify({ token, depth, seconds: Math.round((Date.now() - started) / 1000) });
    const url = `${SHARE_BASE}/share/${id}/read`;
    /* sendBeacon survives the tab closing, which is exactly when the final
       depth reading matters most. text/plain keeps it a CORS-simple request so
       there is no preflight -- sendBeacon cannot answer one, and the ping would
       be dropped without a trace. The worker parses the body either way. */
    try {
      if (navigator.sendBeacon) navigator.sendBeacon(url, new Blob([body], { type: "text/plain" }));
      else fetch(url, { method: "POST", headers: { "content-type": "text/plain" }, body, keepalive: true });
    } catch {}
  };

  window.addEventListener("scroll", measure, { passive: true });
  const tick = setInterval(send, 15000);
  const onHide = () => { if (document.visibilityState === "hidden") send(); };
  document.addEventListener("visibilitychange", onHide);
  window.addEventListener("pagehide", send);
  setTimeout(send, 2000); // register the open promptly

  return () => {
    stopped = true;
    clearInterval(tick);
    window.removeEventListener("scroll", measure);
    document.removeEventListener("visibilitychange", onHide);
    window.removeEventListener("pagehide", send);
  };
}
