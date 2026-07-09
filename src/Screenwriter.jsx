import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  Download, Plus, Users, X, Trash2, Flag, FileJson, Upload, Clapperboard,
  Circle, FolderOpen, Copy, Cloud, CloudOff, Columns, FileText, History,
  RotateCcw, SeparatorHorizontal, Bold, List, Maximize2, CheckCircle2,
  MoreHorizontal, Moon, Sun, Printer, Timer, Flame,
} from "lucide-react";
import ScriptEditor from "./ScriptEditor.jsx";
import {
  migrateDoc, DEFAULT_DOC, deriveScenes, deleteSceneAt, moveScene as moveSceneBlocks,
  buildFDX, parseFDX, parseScriptText, allCharacters, uid, newBlock,
} from "./engine.js";
import { CSS } from "./styles.js";

/* ---------------- storage (guarded) ---------------- */
const storage = (() => {
  try {
    const t = "__sw__";
    window.localStorage.setItem(t, "1");
    window.localStorage.removeItem(t);
    return { persistent: true, api: window.localStorage };
  } catch {
    const mem = {};
    return {
      persistent: false,
      api: {
        getItem: (k) => (k in mem ? mem[k] : null),
        setItem: (k, v) => { mem[k] = String(v); },
        removeItem: (k) => { delete mem[k]; },
      },
    };
  }
})();

const LIB_KEY = "screenwriter-library-v1";
const CLOUD_KEY = "screenwriter-cloud-v1";
const OLD_KEY = "screenwriter-doc-v1";
const docKey = (id) => `screenwriter-doc-v1:${id}`;

/* Paste your Google client ID here and no device will ever ask for it again.
   Get it at console.cloud.google.com under Credentials. */
const DEFAULT_GOOGLE_CLIENT_ID = "";

const loadLibrary = () => {
  try { const l = JSON.parse(storage.api.getItem(LIB_KEY) || "[]"); return Array.isArray(l) ? l : []; }
  catch { return []; }
};
const saveLibrary = (l) => { try { storage.api.setItem(LIB_KEY, JSON.stringify(l)); } catch {} };
const loadProjectDoc = (id) => {
  try {
    const raw = storage.api.getItem(docKey(id));
    return raw ? migrateDoc(JSON.parse(raw)) : null;
  } catch { return null; }
};
const saveProjectDoc = (id, d) => { try { storage.api.setItem(docKey(id), JSON.stringify(d)); } catch {} };
const deleteProjectDoc = (id) => { try { storage.api.removeItem(docKey(id)); } catch {} };

function initLibrary() {
  let lib = loadLibrary();
  if (lib.length) return { library: lib, currentId: lib[0].id };
  let legacy = null;
  try {
    const raw = storage.api.getItem(OLD_KEY);
    if (raw) legacy = migrateDoc(JSON.parse(raw));
  } catch {}
  const id = uid();
  const doc = legacy || DEFAULT_DOC();
  saveProjectDoc(id, doc);
  lib = [{ id, title: doc.title, updatedAt: Date.now() }];
  saveLibrary(lib);
  if (legacy) { try { storage.api.removeItem(OLD_KEY); } catch {} }
  return { library: lib, currentId: id };
}

const safeName = (t) => (t.trim() || "untitled").toLowerCase().replace(/[^a-z0-9]+/g, "-");

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}

function downloadBlob(name, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

let gsiPromise = null;
function loadGoogleScript() {
  if (window.google && window.google.accounts) return Promise.resolve();
  if (gsiPromise) return gsiPromise;
  gsiPromise = new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true; s.defer = true;
    s.onload = res;
    s.onerror = () => rej(new Error("Couldn't load Google's sign-in script."));
    document.head.appendChild(s);
  });
  return gsiPromise;
}

/* ========================================================================= */
export default function Screenwriter() {
  const initRef = useRef(null);
  if (!initRef.current) initRef.current = initLibrary();

  const [library, setLibrary] = useState(initRef.current.library);
  const [currentId, setCurrentId] = useState(initRef.current.currentId);
  const [doc, setDoc] = useState(() => loadProjectDoc(initRef.current.currentId) || DEFAULT_DOC());
  const [version, setVersion] = useState(0); // bump = rebuild editor DOM
  const [saveState, setSaveState] = useState("saved");

  const [boardOpen, setBoardOpen] = useState(() => (typeof window !== "undefined" ? window.innerWidth > 980 : true));
  const [boardFull, setBoardFull] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [charsOpen, setCharsOpen] = useState(false);
  const [treatmentOpen, setTreatmentOpen] = useState(false);
  const [treatmentWide, setTreatmentWide] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [verOpen, setVerOpen] = useState(false);
  const [cloudOpen, setCloudOpen] = useState(false);
  const [newChar, setNewChar] = useState(null);
  const [selectedScenes, setSelectedScenes] = useState(() => new Set());
  const [dragIdx, setDragIdx] = useState(null);
  const [overIdx, setOverIdx] = useState(null);
  const [pageBreaks, setPageBreaks] = useState([]);
  const [treatmentTick, setTreatmentTick] = useState(0);

  const [showBreaks, setShowBreaks] = useState(() => storage.api.getItem("screenwriter-showbreaks") !== "0");
  const [night, setNight] = useState(() => storage.api.getItem("screenwriter-night") === "1");
  const [pomo, setPomo] = useState(null);
  const [streak, setStreak] = useState(() => {
    try {
      const s = JSON.parse(storage.api.getItem("screenwriter-streak") || "null");
      return s && typeof s.streak === "number" ? s : { streak: 0, last: "" };
    } catch { return { streak: 0, last: "" }; }
  });

  const editorRef = useRef(null);
  const fileRef = useRef(null);
  const pageRef = useRef(null);
  const probeRef = useRef(null);
  const treatmentRef = useRef(null);
  const selectAnchor = useRef(null);
  const skipSave = useRef(false);
  const streakRef = useRef(streak);
  streakRef.current = streak;

  const scenes = useMemo(() => deriveScenes(doc.blocks), [doc.blocks]);
  const scriptChars = useMemo(() => new Set(allCharacters(doc.blocks)), [doc.blocks]);
  const allChars = useMemo(
    () => [...new Set([...scriptChars, ...Object.keys(doc.characters || {})])].sort(),
    [scriptChars, doc.characters]
  );

  /* ---------------- editor <-> state ---------------- */
  const onEditorChange = useCallback((blocks, structural) => {
    setDoc((d) => {
      /* preserve scene metadata (act/done/synopsis) across edits by block id */
      const meta = new Map();
      d.blocks.forEach((b) => {
        if (b.act !== undefined || b.done !== undefined || b.synopsis !== undefined) {
          const m = {};
          if (b.act !== undefined) m.act = b.act;
          if (b.done !== undefined) m.done = b.done;
          if (b.synopsis !== undefined) m.synopsis = b.synopsis;
          meta.set(b.id, m);
        }
      });
      const next = blocks.map((b) => (meta.has(b.id) ? { ...b, ...meta.get(b.id) } : b));
      return { ...d, blocks: next };
    });
    if (structural) setVersion((v) => v + 1);
  }, []);

  const setBlocks = useCallback((blocks) => {
    setDoc((d) => ({ ...d, blocks }));
    setVersion((v) => v + 1);
  }, []);

  /* ---------------- undo / redo ---------------- */
  const hist = useRef({ stack: [], idx: -1, quiet: false });

  useEffect(() => {
    const h = hist.current;
    if (h.quiet) { h.quiet = false; return; }
    const t = setTimeout(() => {
      const snap = JSON.stringify(doc.blocks);
      if (h.stack[h.idx] === snap) return;
      h.stack = h.stack.slice(0, h.idx + 1);
      h.stack.push(snap);
      if (h.stack.length > 100) h.stack.shift();
      h.idx = h.stack.length - 1;
    }, 500);
    return () => clearTimeout(t);
  }, [doc.blocks]);

  useEffect(() => {
    hist.current = { stack: [JSON.stringify(doc.blocks)], idx: 0, quiet: false };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId]);

  useEffect(() => {
    const onKey = (e) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const k = e.key.toLowerCase();
      if (k !== "z" && k !== "y") return;
      if (e.target.closest && e.target.closest(".treatment-editor")) return;
      e.preventDefault();
      const h = hist.current;
      const redo = k === "y" || e.shiftKey;
      if (redo && h.idx < h.stack.length - 1) h.idx += 1;
      else if (!redo && h.idx > 0) h.idx -= 1;
      else return;
      h.quiet = true;
      setDoc((d) => ({ ...d, blocks: JSON.parse(h.stack[h.idx]) }));
      setVersion((v) => v + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* ---------------- autosave + streak ---------------- */
  const touchLibrary = useCallback((id, title) => {
    setLibrary((lib) => {
      const next = lib.map((p) => (p.id === id ? { ...p, title: title || "UNTITLED", updatedAt: Date.now() } : p));
      saveLibrary(next);
      return next;
    });
  }, []);

  const persist = useCallback((id, d) => { saveProjectDoc(id, d); touchLibrary(id, d.title); }, [touchLibrary]);

  useEffect(() => {
    if (skipSave.current) { skipSave.current = false; return; }
    setSaveState("saving");
    const t = setTimeout(() => {
      persist(currentId, doc);
      setSaveState("saved");
      const today = new Date().toISOString().slice(0, 10);
      if (streakRef.current.last !== today) {
        const yest = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
        const next = { streak: streakRef.current.last === yest ? streakRef.current.streak + 1 : 1, last: today };
        setStreak(next);
        try { storage.api.setItem("screenwriter-streak", JSON.stringify(next)); } catch {}
      }
    }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc]);

  useEffect(() => {
    const h = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault(); persist(currentId, doc); setSaveState("saved");
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [doc, currentId, persist]);

  /* ---------------- pagination ---------------- */
  const recomputeBreaks = useCallback(() => {
    const page = pageRef.current;
    const probe = probeRef.current;
    const root = editorRef.current && editorRef.current.root();
    if (!page || !probe || !root) return;
    const lh = probe.getBoundingClientRect().height || 17;
    const pageH = lh * 55; // the standard 55 lines per page
    const pageRect = page.getBoundingClientRect();
    const cs = getComputedStyle(page);
    const padTop = parseFloat(cs.paddingTop) || 0;
    const padBottom = parseFloat(cs.paddingBottom) || 0;
    const contentH = page.scrollHeight - padTop - padBottom;
    const count = Math.max(1, Math.ceil(contentH / pageH));

    /* a break may only land at the top of a heading, action, character or
       transition, so a speech is never cut from its character cue */
    const anchors = Array.from(root.querySelectorAll(".blk.heading, .blk.action, .blk.character, .blk.transition"))
      .map((n) => n.getBoundingClientRect().top - pageRect.top)
      .filter((y) => y > padTop + 4)
      .sort((a, b) => a - b);

    const breaks = [];
    for (let n = 1; n < count; n++) {
      const target = padTop + n * pageH;
      let chosen = null;
      for (const y of anchors) { if (y <= target) chosen = y; else break; }
      if (chosen == null) chosen = anchors.find((y) => y > target) ?? target;
      if (!breaks.length || Math.abs(breaks[breaks.length - 1].y - chosen) > 4) {
        breaks.push({ y: chosen, page: breaks.length + 2 });
      }
    }
    setPageBreaks(breaks);
  }, []);

  useEffect(() => {
    const page = pageRef.current;
    if (!page) return;
    let raf = null;
    const schedule = () => { if (raf) cancelAnimationFrame(raf); raf = requestAnimationFrame(recomputeBreaks); };
    const ro = new ResizeObserver(schedule);
    ro.observe(page);
    schedule();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(schedule).catch(() => {});
    window.addEventListener("resize", schedule);
    return () => { ro.disconnect(); window.removeEventListener("resize", schedule); if (raf) cancelAnimationFrame(raf); };
  }, [recomputeBreaks, doc.blocks]);

  const pageCount = pageBreaks.length + 1;

  /* ---------------- scene ops ---------------- */
  const updateHeading = (blockId, patch) =>
    setDoc((d) => ({ ...d, blocks: d.blocks.map((b) => (b.id === blockId ? { ...b, ...patch } : b)) }));

  const addScene = (afterSceneIdx = null) => {
    const h = newBlock("heading", "");
    const a = newBlock("action", "");
    setDoc((d) => {
      const sc = deriveScenes(d.blocks);
      const at = afterSceneIdx == null || !sc[afterSceneIdx] ? d.blocks.length : sc[afterSceneIdx].end + 1;
      const blocks = [...d.blocks];
      blocks.splice(at, 0, h, a);
      return { ...d, blocks };
    });
    setVersion((v) => v + 1);
    setTimeout(() => editorRef.current && editorRef.current.focusBlock(h.id), 60);
  };

  const removeScene = (sceneIdx) => { setBlocks(deleteSceneAt(doc.blocks, sceneIdx)); };

  const deleteSelectedScenes = () => {
    if (!selectedScenes.size) return;
    if (!window.confirm(`Delete ${selectedScenes.size} scene${selectedScenes.size > 1 ? "s" : ""}? You can undo with Ctrl+Z.`)) return;
    let blocks = doc.blocks;
    const idxs = scenes
      .map((s, i) => (s.heading && selectedScenes.has(s.heading.id) ? i : -1))
      .filter((i) => i >= 0)
      .sort((a, b) => b - a);
    idxs.forEach((i) => { blocks = deleteSceneAt(blocks, i); });
    setBlocks(blocks);
    setSelectedScenes(new Set());
  };

  const handleCardClick = (e, i, sc) => {
    const hid = sc.heading && sc.heading.id;
    if (!hid) return;
    if (e.metaKey || e.ctrlKey) {
      setSelectedScenes((prev) => { const n = new Set(prev); n.has(hid) ? n.delete(hid) : n.add(hid); return n; });
      selectAnchor.current = i;
      return;
    }
    if (e.shiftKey && selectAnchor.current != null) {
      const [a, b] = [Math.min(selectAnchor.current, i), Math.max(selectAnchor.current, i)];
      setSelectedScenes(new Set(scenes.slice(a, b + 1).map((s) => s.heading && s.heading.id).filter(Boolean)));
      return;
    }
    setSelectedScenes(new Set());
    selectAnchor.current = i;
    if (boardFull) setBoardFull(false);
    setTimeout(() => editorRef.current && editorRef.current.focusBlock(hid), 40);
  };

  /* ---------------- versions ---------------- */
  const snapshot = () => JSON.parse(JSON.stringify({
    title: doc.title, theme: doc.theme, treatment: doc.treatment || "",
    titlePage: doc.titlePage, characters: doc.characters, blocks: doc.blocks,
  }));

  const saveVersion = () => {
    const name = window.prompt("Name this version:", `Draft ${(doc.versions || []).length + 1}`);
    if (!name) return;
    setDoc((d) => ({ ...d, versions: [...(d.versions || []), { id: uid(), name: name.trim(), createdAt: Date.now(), ...snapshot() }] }));
  };

  const restoreVersion = (vid) => {
    const v = (doc.versions || []).find((x) => x.id === vid);
    if (!v) return;
    if (!window.confirm(`Restore "${v.name}"? Your current draft is saved as a version first.`)) return;
    const cur = snapshot();
    setDoc((d) => ({
      ...d,
      versions: [...(d.versions || []), { id: uid(), name: `Before restoring ${v.name}`, createdAt: Date.now(), ...cur }],
      title: v.title, theme: v.theme, treatment: v.treatment || "",
      titlePage: v.titlePage || { byline: "", contact: "" },
      characters: JSON.parse(JSON.stringify(v.characters || {})),
      blocks: JSON.parse(JSON.stringify(v.blocks)),
    }));
    setVersion((n) => n + 1);
    setTreatmentTick((t) => t + 1);
    setVerOpen(false);
  };

  const deleteVersion = (vid) => {
    const v = (doc.versions || []).find((x) => x.id === vid);
    if (!v || !window.confirm(`Delete version "${v.name}"?`)) return;
    setDoc((d) => ({ ...d, versions: (d.versions || []).filter((x) => x.id !== vid) }));
  };

  /* ---------------- projects ---------------- */
  const openProject = (id) => {
    if (id === currentId) { setProjectsOpen(false); return; }
    persist(currentId, doc);
    const next = loadProjectDoc(id) || DEFAULT_DOC();
    skipSave.current = true;
    setCurrentId(id); setDoc(next); setVersion((v) => v + 1);
    setProjectsOpen(false); setTreatmentTick((t) => t + 1);
  };

  const newProject = () => {
    persist(currentId, doc);
    const id = uid();
    const fresh = DEFAULT_DOC();
    saveProjectDoc(id, fresh);
    setLibrary((lib) => { const n = [{ id, title: fresh.title, updatedAt: Date.now() }, ...lib]; saveLibrary(n); return n; });
    skipSave.current = true;
    setCurrentId(id); setDoc(fresh); setVersion((v) => v + 1);
    setProjectsOpen(false);
  };

  const duplicateProject = (id) => {
    const src = id === currentId ? doc : loadProjectDoc(id);
    if (!src) return;
    const copy = { ...JSON.parse(JSON.stringify(src)), title: `${src.title} COPY` };
    const nid = uid();
    saveProjectDoc(nid, copy);
    setLibrary((lib) => { const n = [{ id: nid, title: copy.title, updatedAt: Date.now() }, ...lib]; saveLibrary(n); return n; });
  };

  const deleteProject = (id) => {
    if (library.length <= 1) return;
    deleteProjectDoc(id);
    const rest = library.filter((p) => p.id !== id);
    setLibrary(rest); saveLibrary(rest);
    if (id === currentId && rest[0]) {
      const next = loadProjectDoc(rest[0].id) || DEFAULT_DOC();
      skipSave.current = true;
      setCurrentId(rest[0].id); setDoc(next); setVersion((v) => v + 1);
    }
  };

  /* ---------------- import / export ---------------- */
  const exportFDX = () => downloadBlob(`${safeName(doc.title)}.fdx`, buildFDX(doc), "application/xml");
  const exportJSON = () => downloadBlob(`${safeName(doc.title)}-backup.json`, JSON.stringify(doc, null, 2), "application/json");

  const openImported = (title, blocks) => {
    persist(currentId, doc);
    const nd = { ...DEFAULT_DOC(), title, blocks };
    const id = uid();
    saveProjectDoc(id, nd);
    setLibrary((lib) => { const n = [{ id, title, updatedAt: Date.now() }, ...lib]; saveLibrary(n); return n; });
    skipSave.current = true;
    setCurrentId(id); setDoc(nd); setVersion((v) => v + 1);
  };

  const importFile = (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const name = f.name.toLowerCase();
    const r = new FileReader();
    r.onload = () => {
      try {
        if (name.endsWith(".json")) {
          const d = migrateDoc(JSON.parse(r.result));
          setDoc(d); setVersion((v) => v + 1); setTreatmentTick((t) => t + 1);
          return;
        }
        const fallback = f.name.replace(/\.[^.]+$/, "").toUpperCase();
        if (name.endsWith(".fdx")) {
          const { title, blocks } = parseFDX(r.result);
          openImported(title || fallback, blocks);
        } else {
          openImported(fallback, parseScriptText(r.result));
        }
      } catch (err) {
        window.alert(err.message || "Couldn't read that file.");
      }
    };
    r.readAsText(f);
    e.target.value = "";
  };

  /* ---------------- characters ---------------- */
  const setCharNote = (name, note) => setDoc((d) => ({ ...d, characters: { ...d.characters, [name]: note } }));
  const removeChar = (name) => setDoc((d) => { const c = { ...d.characters }; delete c[name]; return { ...d, characters: c }; });

  /* ---------------- treatment ---------------- */
  useEffect(() => {
    if (!treatmentOpen) return;
    const el = treatmentRef.current;
    if (!el) return;
    let html = doc.treatment || "";
    if (html && !/[<>]/.test(html)) {
      html = html.split("\n").map((s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;")).join("<br>");
    }
    html = html.replace(/<script[\s\S]*?<\/script>/gi, "");
    if (el.innerHTML !== html) el.innerHTML = html;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [treatmentOpen, currentId, treatmentTick]);

  /* ---------------- pomodoro ---------------- */
  useEffect(() => {
    if (!pomo || !pomo.running) return;
    const t = setInterval(() => {
      setPomo((p) => {
        if (!p) return p;
        if (p.remaining > 1) return { ...p, remaining: p.remaining - 1 };
        try {
          const ctx = new (window.AudioContext || window.webkitAudioContext)();
          const g = ctx.createGain(); g.connect(ctx.destination);
          g.gain.setValueAtTime(0.12, ctx.currentTime);
          const o = ctx.createOscillator(); o.connect(g); o.frequency.value = 880;
          o.start(); o.stop(ctx.currentTime + 0.18);
          const o2 = ctx.createOscillator(); o2.connect(g); o2.frequency.value = 1175;
          o2.start(ctx.currentTime + 0.24); o2.stop(ctx.currentTime + 0.44);
        } catch {}
        return p.phase === "work"
          ? { phase: "break", remaining: 5 * 60, running: true }
          : { phase: "work", remaining: 25 * 60, running: true };
      });
    }, 1000);
    return () => clearInterval(t);
  }, [pomo && pomo.running]);

  /* ---------------- Google Drive sync ---------------- */
  const [cloud, setCloud] = useState(() => {
    try {
      const c = JSON.parse(storage.api.getItem(CLOUD_KEY) || "null");
      return c && typeof c === "object"
        ? { clientId: c.clientId || "", connected: !!c.connected, lastSyncedAt: c.lastSyncedAt || null, email: c.email || "", folderId: c.folderId || null, fileId: c.fileId || null }
        : { clientId: "", connected: false, lastSyncedAt: null, email: "", folderId: null, fileId: null };
    } catch { return { clientId: "", connected: false, lastSyncedAt: null, email: "", folderId: null, fileId: null }; }
  });
  const [cloudStatus, setCloudStatus] = useState("idle");
  const [cloudError, setCloudError] = useState("");
  const [clientIdDraft, setClientIdDraft] = useState(cloud.clientId);
  const [sessionEmail, setSessionEmail] = useState("");
  const tokenRef = useRef(null);
  const tokenClientRef = useRef(null);
  const silentRef = useRef(false);
  const refreshRef = useRef(null);
  const cloudRef = useRef(cloud); cloudRef.current = cloud;
  const stateRef = useRef(); stateRef.current = { library, doc, currentId };

  const persistCloud = (n) => { setCloud(n); try { storage.api.setItem(CLOUD_KEY, JSON.stringify(n)); } catch {} };

  const buildSnapshot = () => {
    const { library: lib, doc: cd, currentId: cid } = stateRef.current;
    const docs = {};
    lib.forEach((p) => { const d = p.id === cid ? cd : loadProjectDoc(p.id); if (d) docs[p.id] = d; });
    docs[cid] = cd;
    return { library: lib, docs, updatedAt: Date.now() };
  };

  const driveFetch = async (url, opts = {}) => {
    if (!tokenRef.current) throw new Error("Signed out. Reconnect to sync.");
    const res = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${tokenRef.current}` } });
    if (res.status === 401) throw new Error("Signed out. Reconnect to sync.");
    if (!res.ok) throw new Error(`Drive said ${res.status}`);
    return res;
  };

  const ensureFolder = async () => {
    const q = encodeURIComponent("name='Screenwriter' and mimeType='application/vnd.google-apps.folder' and trashed=false");
    const r = await driveFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive&fields=files(id)`);
    const d = await r.json();
    if (d.files && d.files.length) return d.files[0].id;
    const c = await driveFetch("https://www.googleapis.com/drive/v3/files", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Screenwriter", mimeType: "application/vnd.google-apps.folder" }),
    });
    return (await c.json()).id;
  };

  const findFile = async (folderId) => {
    const q = encodeURIComponent(`name='screenwriter-sync.json' and '${folderId}' in parents and trashed=false`);
    const r = await driveFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive&fields=files(id)`);
    const d = await r.json();
    return (d.files && d.files[0] && d.files[0].id) || null;
  };

  const createFile = async (folderId, content) => {
    const b = "swboundary";
    const meta = { name: "screenwriter-sync.json", parents: [folderId], mimeType: "application/json" };
    const body = `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${b}\r\nContent-Type: application/json\r\n\r\n${content}\r\n--${b}--`;
    const r = await driveFetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", {
      method: "POST", headers: { "Content-Type": `multipart/related; boundary=${b}` }, body,
    });
    return (await r.json()).id;
  };

  const pushToCloud = async (cfg) => {
    const folderId = cfg.folderId || (await ensureFolder());
    const content = JSON.stringify(buildSnapshot());
    let fileId = cfg.fileId;
    if (fileId) {
      try {
        await driveFetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
          method: "PATCH", headers: { "Content-Type": "application/json" }, body: content,
        });
      } catch { fileId = await createFile(folderId, content); }
    } else fileId = await createFile(folderId, content);
    return { folderId, fileId };
  };

  const pullFromCloud = async (cfg) => {
    const folderId = cfg.folderId || (await ensureFolder());
    const fileId = cfg.fileId || (await findFile(folderId));
    if (!fileId) return { remote: null, folderId, fileId: null };
    const r = await driveFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
    let data = null;
    try { data = JSON.parse(await r.text()); } catch {}
    return { remote: data && Array.isArray(data.library) ? data : null, folderId, fileId };
  };

  const applySnapshot = (snap) => {
    saveLibrary(snap.library);
    Object.entries(snap.docs).forEach(([id, d]) => saveProjectDoc(id, migrateDoc(d)));
    setLibrary(snap.library);
    const keep = snap.docs[currentId] ? currentId : snap.library[0] && snap.library[0].id;
    if (keep) {
      skipSave.current = true;
      setCurrentId(keep);
      setDoc(migrateDoc(snap.docs[keep]) || DEFAULT_DOC());
      setVersion((v) => v + 1);
      setTreatmentTick((t) => t + 1);
    }
  };

  const connectDrive = async (silent = false) => {
    const clientId = (DEFAULT_GOOGLE_CLIENT_ID || clientIdDraft || cloud.clientId || "").trim();
    if (!clientId) { if (!silent) setCloudError("Add your Google client ID first."); return; }
    if (!silent) setCloudError("");
    silentRef.current = silent;
    try { await loadGoogleScript(); } catch (err) { if (!silent) setCloudError(err.message); return; }

    if (!tokenClientRef.current || tokenClientRef.current.cid !== clientId) {
      const client = window.google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email",
        callback: async (resp) => {
          if (resp.error) {
            if (silentRef.current) { setCloudStatus("idle"); return; }
            setCloudStatus("error");
            setCloudError(resp.error === "access_denied" ? "Sign-in was cancelled." : resp.error);
            return;
          }
          tokenRef.current = resp.access_token;
          if (refreshRef.current) clearTimeout(refreshRef.current);
          refreshRef.current = setTimeout(() => {
            silentRef.current = true;
            try { tokenClientRef.current.requestAccessToken({ prompt: "" }); } catch {}
          }, 50 * 60 * 1000);

          setCloudStatus("syncing");
          try {
            const ir = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { Authorization: `Bearer ${resp.access_token}` } });
            const info = await ir.json();
            setSessionEmail(info.email || "signed in");

            const cc = cloudRef.current;
            const { remote, folderId, fileId } = await pullFromCloud(cc);
            let fid = fileId;
            if (remote && Object.keys(remote.docs).length && !cc.connected) {
              const useRemote = window.confirm(
                `Found a Drive backup with ${remote.library.length} script(s), saved ${timeAgo(remote.updatedAt)}.\n\nOK = load it here (replaces what's open)\nCancel = keep this device's copy and upload it`
              );
              if (useRemote) applySnapshot(remote);
              else fid = (await pushToCloud({ ...cc, folderId, fileId })).fileId;
            } else if (remote) {
              if (remote.updatedAt > (cc.lastSyncedAt || 0) + 2000) applySnapshot(remote);
              else fid = (await pushToCloud({ ...cc, folderId, fileId })).fileId;
            } else {
              fid = (await pushToCloud({ ...cc, folderId, fileId })).fileId;
            }
            persistCloud({ clientId, connected: true, lastSyncedAt: Date.now(), email: info.email || "", folderId, fileId: fid });
            setCloudStatus("ok");
          } catch (err) {
            setCloudStatus("error");
            if (!silentRef.current) setCloudError(err.message || "Couldn't reach Google Drive.");
          }
        },
      });
      client.cid = clientId;
      tokenClientRef.current = client;
    }
    tokenClientRef.current.requestAccessToken({ prompt: silent || sessionEmail ? "" : "consent" });
  };

  useEffect(() => {
    if (!cloud.connected) return;
    if (!(DEFAULT_GOOGLE_CLIENT_ID || cloud.clientId)) return;
    const t = setTimeout(() => connectDrive(true), 900);
    return () => { clearTimeout(t); if (refreshRef.current) clearTimeout(refreshRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!cloud.connected) return;
    const t = setInterval(() => {
      if (!tokenRef.current) return;
      pushToCloud(cloudRef.current)
        .then(({ folderId, fileId }) => persistCloud({ ...cloudRef.current, folderId, fileId, lastSyncedAt: Date.now() }))
        .catch(() => setCloudStatus("error"));
    }, 60000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloud.connected, cloud.clientId]);

  const syncNow = async () => {
    if (!cloud.connected) return;
    setCloudStatus("syncing");
    try {
      const { folderId, fileId } = await pushToCloud(cloud);
      persistCloud({ ...cloud, folderId, fileId, lastSyncedAt: Date.now() });
      setCloudStatus("ok");
    } catch (err) { setCloudStatus("error"); setCloudError(err.message); }
  };

  const disconnectCloud = () => {
    try { if (tokenRef.current && window.google) window.google.accounts.oauth2.revoke(tokenRef.current); } catch {}
    persistCloud({ ...cloud, connected: false });
    tokenRef.current = null; setSessionEmail(""); setCloudStatus("idle");
  };

  const notSynced = cloud.connected && (!sessionEmail || cloudStatus === "error");

  /* ---------------- board drag ---------------- */
  const doMove = (from, to) => { if (from != null && to != null && from !== to) setBlocks(moveSceneBlocks(doc.blocks, from, to)); };

  const sceneSnippet = (s) => {
    const b = s.blocks.find((x) => x.text.trim());
    if (!b) return "";
    const t = b.text.trim();
    return t.length > 70 ? t.slice(0, 70) + "\u2026" : t;
  };

  const doneCount = scenes.filter((s) => s.heading && s.heading.done).length;

  /* ============================ render ============================ */
  return (
    <div className={`sw-root${night ? " night" : ""}`}>
      <style>{CSS}</style>

      <header className="topbar">
        <div className="tb-left">
          <button className={`icon-btn${projectsOpen ? " on" : ""}`} title="Your scripts" onClick={() => setProjectsOpen((v) => !v)}>
            <FolderOpen size={16} />
          </button>
          <button className={`icon-btn${boardOpen ? " on" : ""}`} title="Scene board" onClick={() => setBoardOpen((v) => !v)}>
            <Clapperboard size={16} />
          </button>
          <input className="title-input" value={doc.title} onChange={(e) => setDoc((d) => ({ ...d, title: e.target.value }))} spellCheck={false} />
        </div>

        <div className={`theme-strip${doc.theme.trim() ? " filled" : ""}`}>
          <span className="theme-label">Theme</span>
          <input className="theme-input" value={doc.theme} placeholder="What is this story about?"
            onChange={(e) => setDoc((d) => ({ ...d, theme: e.target.value }))} spellCheck={false} />
        </div>

        <div className="tb-right">
          <span className="page-est">~{pageCount} pp</span>
          <button className={`icon-btn${showBreaks ? " on" : ""}`} title={showBreaks ? "Hide page breaks" : "Show page breaks"}
            onClick={() => setShowBreaks((v) => { try { storage.api.setItem("screenwriter-showbreaks", v ? "0" : "1"); } catch {} return !v; })}>
            <SeparatorHorizontal size={15} />
          </button>
          <span className={`save-dot ${saveState}`}>
            <Circle size={7} fill="currentColor" />
            <span className="save-word">{saveState === "saved" ? "Saved" : "Saving"}</span>
          </span>
          {notSynced && <span className="sync-warn" title="Cloud sync isn't active">not synced</span>}
          {streak.streak > 0 && (
            <span className="streak-chip" title={`${streak.streak}-day writing streak`}><Flame size={11} />{streak.streak}</span>
          )}
          {pomo && (
            <span className={`pomo-chip ${pomo.phase}${pomo.running ? "" : " paused"}`} onClick={() => setPomo((p) => ({ ...p, running: !p.running }))}>
              <Timer size={11} />
              {`${Math.floor(pomo.remaining / 60)}:${String(pomo.remaining % 60).padStart(2, "0")}`}
              <X size={11} className="pomo-x" onClick={(e) => { e.stopPropagation(); setPomo(null); }} />
            </span>
          )}
          <input ref={fileRef} type="file" accept=".json,.fdx,.txt,.fountain" style={{ display: "none" }} onChange={importFile} />
          <button className="export-btn" onClick={exportFDX}><Download size={14} /> FDX</button>

          <div className="pop-wrap">
            <button className={`icon-btn${cloudOpen ? " on" : ""}${notSynced ? " warn-badge" : ""}`} title="Cloud sync" onClick={() => { setClientIdDraft(cloud.clientId); setCloudOpen((v) => !v); }}>
              {cloud.connected && sessionEmail ? <Cloud size={16} /> : <CloudOff size={16} />}
            </button>
            {cloudOpen && (
              <div className="pop-panel">
                {!cloud.connected && (
                  <>
                    <div className="pop-title">Connect Google Drive</div>
                    {!DEFAULT_GOOGLE_CLIENT_ID && (
                      <>
                        <label className="pop-label">Google client ID</label>
                        <input className="pop-input" placeholder="xxxx.apps.googleusercontent.com" value={clientIdDraft} onChange={(e) => setClientIdDraft(e.target.value)} spellCheck={false} />
                      </>
                    )}
                    {cloudError && <div className="pop-error">{cloudError}</div>}
                    <button className="pop-btn" onClick={() => connectDrive(false)} disabled={cloudStatus === "syncing" || (!DEFAULT_GOOGLE_CLIENT_ID && !clientIdDraft.trim())}>
                      {cloudStatus === "syncing" ? "Connecting..." : "Connect Google Drive"}
                    </button>
                    <div className="pop-hint">Saves to a "Screenwriter" folder in your own Drive. Nobody else can see it.</div>
                  </>
                )}
                {cloud.connected && sessionEmail && (
                  <>
                    <div className="pop-title">Cloud sync is on</div>
                    <div className="pop-meta">{sessionEmail}</div>
                    <div className="pop-status">
                      {cloudStatus === "syncing" ? "Syncing..." : cloudStatus === "error" ? (cloudError || "Sync error") : cloud.lastSyncedAt ? `Last synced ${timeAgo(cloud.lastSyncedAt)}` : ""}
                    </div>
                    <div className="pop-row">
                      <button className="pop-btn secondary" onClick={syncNow} disabled={cloudStatus === "syncing"}>Sync now</button>
                      <button className="pop-btn secondary danger" onClick={disconnectCloud}>Disconnect</button>
                    </div>
                  </>
                )}
                {cloud.connected && !sessionEmail && (
                  <>
                    <div className="pop-title">Sign in to resume sync</div>
                    <div className="pop-meta">{cloud.email}</div>
                    {cloudError && <div className="pop-error">{cloudError}</div>}
                    <button className="pop-btn" onClick={() => connectDrive(false)} disabled={cloudStatus === "syncing"}>
                      {cloudStatus === "syncing" ? "Connecting..." : "Reconnect Drive"}
                    </button>
                    <button className="pop-btn secondary danger" onClick={disconnectCloud} style={{ marginTop: 10 }}>Disconnect</button>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="pop-wrap">
            <button className={`icon-btn${verOpen ? " on" : ""}`} title="Versions" onClick={() => setVerOpen((v) => !v)}><History size={16} /></button>
            {verOpen && (
              <div className="pop-panel">
                <div className="pop-title">Versions</div>
                <button className="pop-btn" onClick={saveVersion} style={{ marginTop: 0 }}>Save current as version</button>
                <div className="ver-list">
                  {(doc.versions || []).slice().reverse().map((v) => (
                    <div className="ver-row" key={v.id}>
                      <div className="ver-info">
                        <div className="ver-name">{v.name}</div>
                        <div className="ver-date">{timeAgo(v.createdAt)}</div>
                      </div>
                      <button className="ghost" title="Restore" onClick={() => restoreVersion(v.id)}><RotateCcw size={12} /></button>
                      <button className="ghost danger" title="Delete" onClick={() => deleteVersion(v.id)}><Trash2 size={12} /></button>
                    </div>
                  ))}
                  {!(doc.versions || []).length && <div className="pop-hint">No versions yet. Save one before a big rewrite.</div>}
                </div>
              </div>
            )}
          </div>

          <button className={`icon-btn${treatmentOpen ? " on" : ""}`} title="Treatment" onClick={() => setTreatmentOpen((v) => !v)}><FileText size={16} /></button>
          <button className={`icon-btn${charsOpen ? " on" : ""}`} title="Character notes" onClick={() => setCharsOpen((v) => !v)}><Users size={16} /></button>

          <div className="pop-wrap">
            <button className={`icon-btn${menuOpen ? " on" : ""}`} title="More" onClick={() => setMenuOpen((v) => !v)}><MoreHorizontal size={16} /></button>
            {menuOpen && (
              <div className="pop-panel">
                <button className="menu-item" onClick={() => { setMenuOpen(false); fileRef.current.click(); }}><Upload size={14} /> Import script or backup</button>
                <button className="menu-item" onClick={() => { setMenuOpen(false); exportJSON(); }}><FileJson size={14} /> Download backup (.json)</button>
                <button className="menu-item" onClick={() => { setMenuOpen(false); setTimeout(() => window.print(), 150); }}><Printer size={14} /> Print / save as PDF</button>
                <button className="menu-item" onClick={() => setNight((v) => { try { storage.api.setItem("screenwriter-night", v ? "0" : "1"); } catch {} return !v; })}>
                  {night ? <Sun size={14} /> : <Moon size={14} />} {night ? "Light mode" : "Night mode"}
                </button>
                {!pomo && <button className="menu-item" onClick={() => { setPomo({ phase: "work", remaining: 1500, running: true }); setMenuOpen(false); }}><Timer size={14} /> Focus timer (25 min)</button>}
                <button className="menu-item" onClick={() => { setMenuOpen(false); editorRef.current && editorRef.current.toggleDual(); }}><Columns size={14} /> Toggle dual dialogue (⌘D)</button>
                <div className="pop-label" style={{ marginTop: 12 }}>Title page</div>
                <input className="pop-input" placeholder="Written by" value={(doc.titlePage && doc.titlePage.byline) || ""}
                  onChange={(e) => setDoc((d) => ({ ...d, titlePage: { ...(d.titlePage || {}), byline: e.target.value } }))} />
                <input className="pop-input" style={{ marginTop: 6 }} placeholder="Contact" value={(doc.titlePage && doc.titlePage.contact) || ""}
                  onChange={(e) => setDoc((d) => ({ ...d, titlePage: { ...(d.titlePage || {}), contact: e.target.value } }))} />
                <div className="pop-hint">Appears on the PDF and in the FDX export.</div>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="body">
        {projectsOpen && (
          <aside className="side projects">
            <div className="side-head">
              <span>Your scripts</span>
              <span className="head-actions">
                <button className="mini-btn" onClick={newProject}><Plus size={13} /> New</button>
                <button className="ghost" onClick={() => setProjectsOpen(false)}><X size={14} /></button>
              </span>
            </div>
            <div className="side-body">
              {[...library].sort((a, b) => b.updatedAt - a.updatedAt).map((p) => (
                <div key={p.id} className={`project-card${p.id === currentId ? " active" : ""}`} onClick={() => openProject(p.id)}>
                  <div className="card-top">
                    <span className="project-title">{p.title || "UNTITLED"}</span>
                    <span className="card-actions" onClick={(e) => e.stopPropagation()}>
                      <button className="ghost" title="Duplicate" onClick={() => duplicateProject(p.id)}><Copy size={12} /></button>
                      {library.length > 1 && (
                        <button className="ghost danger" title="Delete" onClick={() => window.confirm(`Delete "${p.title}"?`) && deleteProject(p.id)}><Trash2 size={12} /></button>
                      )}
                    </span>
                  </div>
                  <div className="project-meta">{p.id === currentId ? "currently open" : `edited ${timeAgo(p.updatedAt)}`}</div>
                </div>
              ))}
            </div>
            <div className="side-note">Scripts live in this browser. Connect Drive, or download a backup, to keep them safe elsewhere.</div>
          </aside>
        )}

        {boardOpen && (
          <aside className={`side board${boardFull ? " full" : ""}`}>
            <div className="side-head">
              {selectedScenes.size ? (
                <>
                  <span>{selectedScenes.size} selected</span>
                  <span className="head-actions">
                    <button className="ghost danger" title="Delete selected" onClick={deleteSelectedScenes}><Trash2 size={13} /></button>
                    <button className="ghost" onClick={() => setSelectedScenes(new Set())}><X size={14} /></button>
                  </span>
                </>
              ) : (
                <>
                  <span>Scenes <span className="scene-progress">{doneCount}/{scenes.length}</span></span>
                  <span className="head-actions">
                    <button className="ghost" title={boardFull ? "Back to sidebar" : "Full-screen board"} onClick={() => setBoardFull((v) => !v)}><Maximize2 size={13} /></button>
                    <button className="mini-btn" onClick={() => addScene()}><Plus size={13} /> Scene</button>
                  </span>
                </>
              )}
            </div>
            <div className="cards" onDragLeave={() => setOverIdx(null)}>
              {scenes.map((s, i) => {
                const h = s.heading;
                return (
                  <div key={h ? h.id : `x${i}`} className="card-slot">
                    {h && h.act !== undefined && (
                      <div className="act-row">
                        <Flag size={11} />
                        <input className="act-input" value={h.act} onChange={(e) => updateHeading(h.id, { act: e.target.value })} spellCheck={false} />
                        <button className="ghost danger act-del" title="Remove act flag" onClick={() => updateHeading(h.id, { act: undefined })}><X size={11} /></button>
                      </div>
                    )}
                    <div
                      className={`card${dragIdx === i ? " dragging" : ""}${overIdx === i ? " over" : ""}${h && selectedScenes.has(h.id) ? " selected" : ""}`}
                      draggable
                      onDragStart={(e) => { setDragIdx(i); e.dataTransfer.effectAllowed = "move"; }}
                      onDragEnd={() => { setDragIdx(null); setOverIdx(null); }}
                      onDragOver={(e) => { e.preventDefault(); setOverIdx(i); }}
                      onDrop={(e) => { e.preventDefault(); doMove(dragIdx, i); setDragIdx(null); setOverIdx(null); }}
                      onClick={(e) => handleCardClick(e, i, s)}
                    >
                      <div className="card-top">
                        {h && (
                          <button className={`scene-check${h.done ? " done" : ""}`} title={h.done ? "Mark not done" : "Mark done"}
                            onClick={(e) => { e.stopPropagation(); updateHeading(h.id, { done: !h.done }); }}>
                            {h.done ? <CheckCircle2 size={13} /> : <Circle size={13} />}
                          </button>
                        )}
                        <span className="card-num">{i + 1}</span>
                        <span className="card-heading">{(h && h.text.trim()) || "Untitled scene"}</span>
                        <span className="card-actions" onClick={(e) => e.stopPropagation()}>
                          {h && (
                            <button className="ghost" title={h.act !== undefined ? "Remove act flag" : "Add act flag"}
                              onClick={() => updateHeading(h.id, { act: h.act !== undefined ? undefined : "ACT " })}><Flag size={12} /></button>
                          )}
                          <button className="ghost danger" title="Delete scene" onClick={() => removeScene(i)}><Trash2 size={12} /></button>
                        </span>
                      </div>
                      {h && (
                        <input className="card-note" value={h.synopsis || ""} placeholder={sceneSnippet(s) || "Add a note..."}
                          onClick={(e) => e.stopPropagation()} onChange={(e) => updateHeading(h.id, { synopsis: e.target.value })} spellCheck={false} />
                      )}
                    </div>
                  </div>
                );
              })}
              <div className={`drop-end${overIdx === scenes.length ? " over" : ""}`}
                onDragOver={(e) => { e.preventDefault(); setOverIdx(scenes.length); }}
                onDrop={(e) => { e.preventDefault(); doMove(dragIdx, scenes.length); setDragIdx(null); setOverIdx(null); }} />
            </div>
          </aside>
        )}

        <main className="editor-scroll">
          <div className="page" ref={pageRef}>
            {doc.titlePage && (doc.titlePage.byline || doc.titlePage.contact) ? (
              <div className="print-title-page" aria-hidden="true">
                <div className="ptp-center">
                  <div className="ptp-title">{doc.title.toUpperCase()}</div>
                  {doc.titlePage.byline && (<><div className="ptp-by">Written by</div><div className="ptp-byline">{doc.titlePage.byline}</div></>)}
                </div>
                {doc.titlePage.contact && <div className="ptp-contact">{doc.titlePage.contact}</div>}
              </div>
            ) : null}

            <span ref={probeRef} className="line-probe" aria-hidden="true">Wg</span>

            {showBreaks && pageBreaks.map((b) => (
              <div key={b.page} className="page-break" style={{ top: b.y }}>
                <span className="page-break-num">{b.page}.</span>
              </div>
            ))}

            <ScriptEditor ref={editorRef} blocks={doc.blocks} version={version} onChange={onEditorChange} night={night} />
          </div>
          <div className="hint-bar">
            enter&thinsp;next element &nbsp;&middot;&nbsp; tab&thinsp;change type &nbsp;&middot;&nbsp; ⌘D&thinsp;dual dialogue &nbsp;&middot;&nbsp; ⌘Z&thinsp;undo
          </div>
        </main>

        {treatmentOpen && (
          <aside className={`side treatment${treatmentWide ? " wide" : ""}`}>
            <div className="side-head">
              <span>Treatment</span>
              <span className="head-actions">
                <button className="ghost" title="Bold" onMouseDown={(e) => { e.preventDefault(); document.execCommand("bold"); }}><Bold size={13} /></button>
                <button className="ghost" title="Bullets" onMouseDown={(e) => { e.preventDefault(); document.execCommand("insertUnorderedList"); }}><List size={14} /></button>
                <button className="ghost" title="Resize" onClick={() => setTreatmentWide((v) => !v)}><Maximize2 size={13} /></button>
                <button className="ghost" onClick={() => setTreatmentOpen(false)}><X size={14} /></button>
              </span>
            </div>
            <div ref={treatmentRef} className="treatment-editor" contentEditable suppressContentEditableWarning
              data-placeholder="Paste or write your treatment here."
              onInput={(e) => setDoc((d) => ({ ...d, treatment: e.currentTarget.innerHTML }))} spellCheck />
          </aside>
        )}

        {charsOpen && (
          <aside className="side chars">
            <div className="side-head">
              <span>Characters</span>
              <span className="head-actions">
                <button className="mini-btn" onClick={() => setNewChar("")}><Plus size={13} /> Add</button>
                <button className="ghost" onClick={() => setCharsOpen(false)}><X size={14} /></button>
              </span>
            </div>
            <div className="side-body">
              {newChar !== null && (
                <input className="char-new" autoFocus value={newChar} placeholder="NAME, then enter"
                  onChange={(e) => setNewChar(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newChar.trim()) { setCharNote(newChar.trim().toUpperCase(), ""); setNewChar(null); }
                    if (e.key === "Escape") setNewChar(null);
                  }} spellCheck={false} />
              )}
              {!allChars.length && newChar === null && <div className="empty-note">Characters appear here as you write them.</div>}
              {allChars.map((name) => (
                <div className="char-block" key={name}>
                  <div className="char-head">
                    <span className="char-name">{name}</span>
                    {scriptChars.has(name) ? <span className="in-script">in script</span>
                      : <button className="ghost danger" onClick={() => removeChar(name)}><Trash2 size={11} /></button>}
                  </div>
                  <textarea className="char-note" rows={3} placeholder="want, wound, voice..." value={doc.characters[name] || ""}
                    onChange={(e) => setCharNote(name, e.target.value)} spellCheck={false} />
                </div>
              ))}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
