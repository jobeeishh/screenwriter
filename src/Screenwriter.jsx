import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  Download, Plus, Users, X, Trash2, Flag, FileJson, Upload, Clapperboard,
  Circle, FolderOpen, Copy, Cloud, CloudOff, Columns, FileText, History,
  RotateCcw, SeparatorHorizontal, Bold, List, Maximize2, CheckCircle2,
  MoreHorizontal, Moon, Sun, Printer, Timer, Flame, Wifi,
} from "lucide-react";
import ScriptEditor from "./ScriptEditor.jsx";
import {
  migrateDoc, DEFAULT_DOC, deriveScenes, deleteSceneAt, moveScene as moveSceneBlocks,
  buildFDX, buildFountain, parseFDX, parseScriptText, allCharacters, uid, newBlock,
} from "./engine.js";
import { planSync, SWS_FILE_RE, LEGACY_JSON_RE, FOUNTAIN_FILE_RE, swsFileName, swsEnvelope } from "./sync.js";
import { CSS } from "./styles.js";
import { GOOGLE_CLIENT_ID, COLLAB_URL } from "./config.js";

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
const COLLAB_KEY = "screenwriter-collab-v1";
const COLLAB_NAME_KEY = "screenwriter-collab-name";
const OLD_KEY = "screenwriter-doc-v1";
const docKey = (id) => `screenwriter-doc-v1:${id}`;

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

  /* Everything except versions[]: two docs with equal cores differ only in
     saved-version history, which merges by id instead of conflicting. Used by
     both Drive sync and .sws import to keep the losing copy recoverable. */
  const docCore = (x) => JSON.stringify({
    t: x.title, h: x.theme, r: x.treatment || "", p: x.titlePage, c: x.characters, b: x.blocks,
  });
  const mergeVersions = (a, b) => {
    const seen = new Set((a || []).map((v) => v.id));
    return [...(a || []), ...(b || []).filter((v) => !seen.has(v.id))];
  };
  const docVersionOf = (d, vname) => ({
    id: uid(), name: vname, createdAt: Date.now(),
    title: d.title || "UNTITLED", theme: d.theme || "", treatment: d.treatment || "",
    titlePage: d.titlePage || { byline: "", contact: "" },
    characters: d.characters || {}, blocks: d.blocks || [],
  });

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
    /* tombstone: the remote files get deleted on the next sync pass;
       without this the project would come back from Drive */
    const cfg = cloudRef.current;
    const f = (cfg.files || {})[id];
    if (f) {
      const files = { ...cfg.files };
      delete files[id];
      persistCloud({ ...cfg, files, tombstones: [...(cfg.tombstones || []), { id, fileId: f.fileId, fountainId: f.fountainId }] });
    }
  };

  /* ---------------- import / export ---------------- */
  const exportFDX = () => downloadBlob(`${safeName(doc.title)}.fdx`, buildFDX(doc), "application/xml");
  /* .sws: the app's own interchange file. JSON envelope carrying the project
     id, so a copy that comes back from a collaborator lands on the same
     project and merges instead of duplicating. Lossless, unlike FDX/fountain,
     which cannot hold the treatment, character notes, or version history. */
  const exportSWS = () => downloadBlob(
    `${safeName(doc.title)}.sws`,
    JSON.stringify(swsEnvelope(currentId, doc), null, 2),
    "application/json"
  );

  const openImported = (title, blocks) => {
    persist(currentId, doc);
    const nd = { ...DEFAULT_DOC(), title, blocks };
    const id = uid();
    saveProjectDoc(id, nd);
    setLibrary((lib) => { const n = [{ id, title, updatedAt: Date.now() }, ...lib]; saveLibrary(n); return n; });
    skipSave.current = true;
    setCurrentId(id); setDoc(nd); setVersion((v) => v + 1);
  };

  /* .sws with a known id: the incoming copy becomes live; if the local copy
     differs it is stashed in the Versions panel first, so an exchange can
     never destroy work on either end. Plain .json backups (no envelope)
     import as a new project -- they used to overwrite the open script. */
  const importDoc = (raw) => {
    /* two id-carrying wrappers exist: the .sws envelope and the sw-<id>.json
       that sync writes to Drive. Someone will inevitably download the Drive
       file and send that instead of an .sws -- accept it the same way. */
    const isEnvelope = raw && (raw.format === "screenwriter-script" || (raw.id && typeof raw.doc === "object")) && raw.doc;
    const incoming = migrateDoc(isEnvelope ? raw.doc : raw);
    const pid = (isEnvelope && raw.id) || uid();
    const existing = pid === currentId ? doc : loadProjectDoc(pid);
    let next = incoming;
    if (existing) {
      const merged = mergeVersions(existing.versions, incoming.versions);
      next = docCore(existing) === docCore(incoming)
        ? { ...incoming, versions: merged }
        : { ...incoming, versions: [...merged, docVersionOf(existing, `Your copy before import ${new Date().toLocaleString()}`)] };
    }
    persist(currentId, doc);
    saveProjectDoc(pid, next);
    setLibrary((lib) => {
      const entry = { id: pid, title: next.title || "UNTITLED", updatedAt: Date.now() };
      const i = lib.findIndex((p) => p.id === pid);
      const n = i >= 0 ? lib.map((p, j) => (j === i ? entry : p)) : [entry, ...lib];
      saveLibrary(n);
      return n;
    });
    skipSave.current = true;
    setCurrentId(pid); setDoc(next); setVersion((v) => v + 1); setTreatmentTick((t) => t + 1);
  };

  const importFile = (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const name = f.name.toLowerCase();
    const r = new FileReader();
    r.onload = () => {
      try {
        if (name.endsWith(".sws") || name.endsWith(".json")) {
          importDoc(JSON.parse(r.result));
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

  /* ---------------- Google Drive sync ----------------
     One sw-<id>.json per project (canonical) plus a generated .fountain
     companion. `files` remembers what we last saw of each remote file;
     `tombstones` are locally-deleted projects whose remote files still need
     deleting. Old state carried a single `fileId` for the monolithic
     screenwriter-sync.json -- dropped here; the legacy file is detected by
     name and imported once. */
  const [cloud, setCloud] = useState(() => {
    const empty = { clientId: "", connected: false, lastSyncedAt: null, email: "", folderId: null, files: {}, tombstones: [] };
    try {
      const c = JSON.parse(storage.api.getItem(CLOUD_KEY) || "null");
      return c && typeof c === "object"
        ? {
            ...empty,
            clientId: c.clientId || "", connected: !!c.connected, lastSyncedAt: c.lastSyncedAt || null,
            email: c.email || "", folderId: c.folderId || null,
            files: c.files && typeof c.files === "object" ? c.files : {},
            tombstones: Array.isArray(c.tombstones) ? c.tombstones : [],
          }
        : empty;
    } catch { return empty; }
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

  const multipart = (meta, content, contentType) => {
    const b = "swboundary";
    return {
      headers: { "Content-Type": `multipart/related; boundary=${b}` },
      body: `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${b}\r\nContent-Type: ${contentType}\r\n\r\n${content}\r\n--${b}--`,
    };
  };

  /* update carries the name too, so a title change renames the .fountain */
  const upsertRemote = async (folderId, fileId, name, content, contentType) => {
    if (fileId) {
      try {
        const r = await driveFetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart&fields=id,modifiedTime`, {
          method: "PATCH", ...multipart({ name }, content, contentType),
        });
        return r.json();
      } catch {} // fall through: the file may have been deleted remotely
    }
    const r = await driveFetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,modifiedTime", {
      method: "POST", ...multipart({ name, parents: [folderId] }, content, contentType),
    });
    return r.json();
  };

  const listRemote = async (folderId) => {
    const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
    const r = await driveFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive&fields=files(id,name,modifiedTime)&pageSize=1000`);
    const d = await r.json();
    const map = {};
    const fountains = {};
    let legacyId = null;
    (d.files || []).forEach((f) => {
      const sws = SWS_FILE_RE.exec(f.name);
      const old = sws ? null : LEGACY_JSON_RE.exec(f.name);
      const m = sws || old;
      if (m) { map[m[1]] = { fileId: f.id, modifiedTime: f.modifiedTime }; return; }
      const fn = FOUNTAIN_FILE_RE.exec(f.name);
      if (fn) { fountains[fn[1]] = f.id; return; }
      if (f.name === "screenwriter-sync.json") legacyId = f.id;
    });
    return { map, fountains, legacyId };
  };

  const fetchFileJson = async (fileId) => {
    const r = await driveFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
    try { return JSON.parse(await r.text()); } catch { return null; }
  };

  const deleteRemote = async (fileId) => {
    try { await driveFetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, { method: "DELETE" }); }
    catch (e) { if (!/404/.test(String(e && e.message))) throw e; }
  };

  const uploadProject = async (folderId, id, d, prev) => {
    /* the PATCH carries the name, so a legacy sw-<id>.json becomes a
       title-named .sws in place on its first push after this build */
    const j = await upsertRemote(folderId, prev && prev.fileId, swsFileName(d.title, id), JSON.stringify(swsEnvelope(id, d)), "application/json");
    if (prev && prev.fountainId) { try { await deleteRemote(prev.fountainId); } catch {} } // fountains no longer sync
    return { fileId: j.id, modifiedTime: j.modifiedTime, syncedAt: Date.now() };
  };

  /* -- the one reconciliation routine: connect, the 60s tick, and "Sync now"
        all land here. planSync (src/sync.js, tested in node) decides; this
        executes. Conflicts keep the local copy live and stash the cloud copy
        as an entry in the Versions panel, so nothing is ever discarded. -- */
  const syncBusyRef = useRef(false);
  const syncProjects = async () => {
    if (syncBusyRef.current || !tokenRef.current) return;
    syncBusyRef.current = true;
    try {
      const cfg = cloudRef.current;
      const folderId = cfg.folderId || (await ensureFolder());
      const files = { ...cfg.files };

      /* locally deleted projects: remove their remote files */
      const tombstones = [];
      for (const t of cfg.tombstones || []) {
        try {
          if (t.fileId) await deleteRemote(t.fileId);
          if (t.fountainId) await deleteRemote(t.fountainId);
        } catch { tombstones.push(t); }
      }

      const { map: remote, fountains, legacyId } = await listRemote(folderId);
      let lib = stateRef.current.library.slice();
      const docOf = (id) => (id === stateRef.current.currentId ? stateRef.current.doc : loadProjectDoc(id));

      /* one-time import of the old monolithic screenwriter-sync.json; the file
         itself is left in place as a fallback */
      if (!Object.keys(remote).length && legacyId) {
        const snap = await fetchFileJson(legacyId);
        if (snap && snap.docs) {
          Object.entries(snap.docs).forEach(([id, d]) => {
            if (lib.some((p) => p.id === id)) return; // local copy wins; it gets pushed below
            const md = migrateDoc(d);
            saveProjectDoc(id, md);
            const le = (snap.library || []).find((p) => p.id === id);
            lib.push({ id, title: md.title || "UNTITLED", updatedAt: (le && le.updatedAt) || Date.now() });
          });
        }
      }

      /* fountains no longer sync: clear out the ones older builds wrote.
         Only names carrying one of our project ids are touched. */
      for (const [fid, fileId] of Object.entries(fountains)) {
        if (lib.some((p) => p.id === fid) || files[fid]) {
          try { await deleteRemote(fileId); } catch {}
          if (files[fid]) files[fid] = { ...files[fid], fountainId: null };
        }
      }

      const actions = planSync({ library: lib, bases: files, remote });
      for (const a of actions) {
        const rem = remote[a.id];
        if (a.op === "push") {
          const d = docOf(a.id);
          if (d) files[a.id] = await uploadProject(folderId, a.id, d, files[a.id]);
        } else if (a.op === "pull") {
          const entry = await fetchFileJson(rem.fileId);
          if (!entry || !entry.doc) continue;
          const md = migrateDoc(entry.doc);
          saveProjectDoc(a.id, md);
          const le = { id: a.id, title: md.title || "UNTITLED", updatedAt: Date.now() };
          const i = lib.findIndex((p) => p.id === a.id);
          if (i >= 0) lib[i] = le; else lib.push(le);
          files[a.id] = { fileId: rem.fileId, modifiedTime: rem.modifiedTime, syncedAt: Date.now() };
          if (a.id === stateRef.current.currentId) {
            skipSave.current = true;
            setDoc(md); setVersion((v) => v + 1); setTreatmentTick((t) => t + 1);
          }
        } else if (a.op === "conflict") {
          const entry = await fetchFileJson(rem.fileId);
          if (!entry || !entry.doc) continue;
          const remoteDoc = migrateDoc(entry.doc);
          const local = docOf(a.id) || DEFAULT_DOC();
          const merged = mergeVersions(local.versions, remoteDoc.versions);
          const next = docCore(remoteDoc) === docCore(local)
            ? (merged.length !== (local.versions || []).length ? { ...local, versions: merged } : local)
            : { ...local, versions: [...merged, docVersionOf(remoteDoc, `Cloud copy (conflict) ${new Date().toLocaleString()}`)] };
          saveProjectDoc(a.id, next);
          if (a.id === stateRef.current.currentId && next !== local) {
            skipSave.current = true;
            setDoc(next); // no version bump: blocks are unchanged, the caret must not move
          }
          files[a.id] = await uploadProject(folderId, a.id, next, { ...(files[a.id] || {}), fileId: rem.fileId });
        } else if (a.op === "removeLocal") {
          if (lib.length <= 1) { // never remove the last project; resurrect it instead
            const d = docOf(a.id);
            if (d) files[a.id] = await uploadProject(folderId, a.id, d, files[a.id]);
            continue;
          }
          deleteProjectDoc(a.id);
          lib = lib.filter((p) => p.id !== a.id);
          delete files[a.id];
          if (a.id === stateRef.current.currentId && lib[0]) {
            const nd = loadProjectDoc(lib[0].id) || DEFAULT_DOC();
            skipSave.current = true;
            setCurrentId(lib[0].id); setDoc(nd); setVersion((v) => v + 1); setTreatmentTick((t) => t + 1);
          }
        }
      }

      Object.keys(files).forEach((id) => { if (!lib.some((p) => p.id === id)) delete files[id]; });
      saveLibrary(lib); setLibrary(lib);
      persistCloud({ ...cloudRef.current, folderId, files, tombstones, lastSyncedAt: Date.now() });
    } finally { syncBusyRef.current = false; }
  };

  const connectDrive = async (silent = false) => {
    const clientId = (GOOGLE_CLIENT_ID || clientIdDraft || cloud.clientId || "").trim();
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

            /* per-project sync merges; connecting never replaces anything */
            persistCloud({ ...cloudRef.current, clientId, connected: true, email: info.email || "" });
            await syncProjects();
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
    if (!(GOOGLE_CLIENT_ID || cloud.clientId)) return;
    const t = setTimeout(() => connectDrive(true), 900);
    return () => { clearTimeout(t); if (refreshRef.current) clearTimeout(refreshRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!cloud.connected) return;
    const t = setInterval(() => {
      if (!tokenRef.current) return;
      syncProjects().catch(() => setCloudStatus("error"));
    }, 60000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloud.connected, cloud.clientId]);

  const syncNow = async () => {
    if (!cloud.connected) return;
    setCloudStatus("syncing");
    try {
      await syncProjects();
      setCloudStatus("ok");
    } catch (err) { setCloudStatus("error"); setCloudError(err.message); }
  };

  const disconnectCloud = () => {
    try { if (tokenRef.current && window.google) window.google.accounts.oauth2.revoke(tokenRef.current); } catch {}
    persistCloud({ ...cloud, connected: false });
    tokenRef.current = null; setSessionEmail(""); setCloudStatus("idle");
  };

  const notSynced = cloud.connected && (!sessionEmail || cloudStatus === "error");

  /* ---------------- live session (presence + handoff) ----------------
     Opt-in per script. One WebSocket room per script id (collab/ worker);
     the relay stores nothing. Saved copies fan out to peers: an idle peer
     applies them live; a peer mid-typing gets a banner instead, so a remote
     copy never lands under someone's caret. If the local copy diverged from
     the last state both sides shared, it is stashed in the Versions panel
     before the remote copy is applied -- same no-data-loss rule as sync. */
  const [collabMap, setCollabMap] = useState(() => {
    try { return JSON.parse(storage.api.getItem(COLLAB_KEY) || "{}"); } catch { return {}; }
  });
  const collabEnabled = !!collabMap[currentId] && !!COLLAB_URL;
  const [peers, setPeers] = useState([]);
  const [peerTyping, setPeerTyping] = useState("");
  const [collabState, setCollabState] = useState("off"); // off | connecting | on
  const [remotePending, setRemotePending] = useState(null); // { from, core }
  const collabWS = useRef(null);
  const remoteApplyRef = useRef(false);
  const lastKnownCoreRef = useRef(""); // last core both sides agreed on
  const lastEditAtRef = useRef(0);
  const typingSentAtRef = useRef(0);
  const typingClearRef = useRef(null);
  const sendTimerRef = useRef(null);
  const reconnectRef = useRef(null);

  const coreOf = (d) => ({
    title: d.title, theme: d.theme, treatment: d.treatment || "",
    titlePage: d.titlePage, characters: d.characters, blocks: d.blocks,
  });
  const coreKey = (c) => JSON.stringify({ t: c.title, h: c.theme, r: c.treatment || "", p: c.titlePage, c: c.characters, b: c.blocks });

  const sendWS = (obj) => {
    const ws = collabWS.current;
    if (!ws || ws.readyState !== 1) return;
    const s = JSON.stringify(obj);
    if (s.length > 800000) return; // relay rejects near 1MiB; blocks alone never get close
    try { ws.send(s); } catch {}
  };

  /* cheap content hash so a peer can say which state their copy grew from */
  const hashStr = (s) => {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return String(h);
  };

  /* lastKnownCore advances only when we APPLY or CONFIRM a peer's state --
     never on send. Having sent a copy is not agreement: the peer may never
     incorporate it, and treating it as agreed is how work gets destroyed. */
  const sendDocNow = () => {
    const d = stateRef.current.doc;
    sendWS({ type: "doc", core: coreOf(d), basedOn: hashStr(lastKnownCoreRef.current) });
  };

  const applyRemote = (core, basedOn) => {
    const cur = stateRef.current.doc;
    let next = { ...cur, ...core }; // versions stay local; cores travel
    /* fast-forward: the incoming copy grew from exactly our current state
       (normal turn-taking). Anything else overwriting local changes stashes
       them in the Versions panel first. */
    const fastForward = basedOn && basedOn === hashStr(docCore(cur));
    if (!fastForward && docCore(cur) !== lastKnownCoreRef.current) {
      next = { ...next, versions: [...(cur.versions || []), docVersionOf(cur, `Your copy before live update ${new Date().toLocaleString()}`)] };
    }
    remoteApplyRef.current = true;
    skipSave.current = true;
    setDoc(next); setVersion((v) => v + 1); setTreatmentTick((t) => t + 1);
    persist(stateRef.current.currentId, next);
    lastKnownCoreRef.current = docCore(next);
    setRemotePending(null);
  };

  const onCollabMessage = (ev) => {
    let m;
    try { m = JSON.parse(ev.data); } catch { return; }
    if (m.type === "roster") { setPeers(m.names || []); return; }
    if (m.type === "join") { setPeers((p) => [...p, m.name]); sendDocNow(); return; } // newcomer gets our copy
    if (m.type === "leave") {
      setPeers((p) => { const i = p.indexOf(m.name); return i < 0 ? p : [...p.slice(0, i), ...p.slice(i + 1)]; });
      return;
    }
    if (m.type === "sync-request") { sendDocNow(); return; }
    if (m.type === "editing") {
      setPeerTyping(m.from || "Someone");
      clearTimeout(typingClearRef.current);
      typingClearRef.current = setTimeout(() => setPeerTyping(""), 2500);
      return;
    }
    if (m.type === "doc" && m.core) {
      const incoming = coreKey(m.core);
      if (incoming === docCore(stateRef.current.doc)) { lastKnownCoreRef.current = incoming; return; }
      if (Date.now() - lastEditAtRef.current < 3000) setRemotePending({ from: m.from || "Someone", core: m.core, basedOn: m.basedOn });
      else applyRemote(m.core, m.basedOn);
    }
  };
  const onCollabMessageRef = useRef(onCollabMessage);
  onCollabMessageRef.current = onCollabMessage;

  useEffect(() => {
    if (!collabEnabled) {
      setCollabState("off"); setPeers([]); setPeerTyping(""); setRemotePending(null);
      return;
    }
    let closed = false;
    let ws;
    const connect = () => {
      if (closed) return;
      setCollabState("connecting");
      const name = encodeURIComponent((storage.api.getItem(COLLAB_NAME_KEY) || "Someone").slice(0, 40));
      const sock = new WebSocket(`${COLLAB_URL}/room/sw-${currentId}?name=${name}`);
      ws = sock;
      collabWS.current = sock;
      sock.onopen = () => {
        if (collabWS.current !== sock) return; // superseded while connecting
        setCollabState("on"); lastKnownCoreRef.current = ""; sendWS({ type: "sync-request" });
      };
      sock.onmessage = (ev) => { if (collabWS.current === sock) onCollabMessageRef.current(ev); };
      sock.onclose = () => {
        /* a stale socket's close must not clobber its replacement: the close
           event lands async, after a reconnect (or StrictMode remount) has
           already installed a new socket */
        if (collabWS.current !== sock) return;
        collabWS.current = null; setPeers([]);
        if (!closed) { setCollabState("connecting"); reconnectRef.current = setTimeout(connect, 3000); }
      };
    };
    connect();
    const ka = setInterval(() => { try { if (ws && ws.readyState === 1) ws.send("ping"); } catch {} }, 30000);
    return () => {
      closed = true; clearInterval(ka); clearTimeout(reconnectRef.current);
      try { if (ws) ws.close(); } catch {}
      collabWS.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collabEnabled, currentId]);

  /* every local doc change: mark for the idle test, signal typing, and send
     the saved copy after the keystrokes settle */
  useEffect(() => {
    if (remoteApplyRef.current) { remoteApplyRef.current = false; return; }
    if (!collabWS.current || collabWS.current.readyState !== 1) return;
    lastEditAtRef.current = Date.now();
    if (Date.now() - typingSentAtRef.current > 2000) { typingSentAtRef.current = Date.now(); sendWS({ type: "editing" }); }
    clearTimeout(sendTimerRef.current);
    sendTimerRef.current = setTimeout(sendDocNow, 800);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc]);

  const toggleCollab = () => {
    if (!COLLAB_URL) return;
    if (!collabMap[currentId]) {
      const name = (window.prompt("Name to show your collaborator:", storage.api.getItem(COLLAB_NAME_KEY) || "") || "").trim();
      if (!name) return;
      try { storage.api.setItem(COLLAB_NAME_KEY, name); } catch {}
    }
    setCollabMap((m) => {
      const n = { ...m };
      if (n[currentId]) delete n[currentId]; else n[currentId] = true;
      try { storage.api.setItem(COLLAB_KEY, JSON.stringify(n)); } catch {}
      return n;
    });
  };

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
          {collabEnabled && (
            <span className={`collab-chip ${collabState}`} title={peers.length ? `In session with ${peers.join(", ")}` : "Waiting for your collaborator to join"}>
              <Circle size={7} fill="currentColor" />
              {peerTyping ? `${peerTyping} is typing…` : peers.length ? peers.join(", ") : collabState === "on" ? "just you" : "connecting…"}
            </span>
          )}
          <input ref={fileRef} type="file" accept=".sws,.json,.fdx,.txt,.fountain" style={{ display: "none" }} onChange={importFile} />
          <button className="export-btn" onClick={exportFDX}><Download size={14} /> FDX</button>

          {COLLAB_URL && (
            <button className={`icon-btn${collabEnabled ? " on" : ""}`} title={collabEnabled ? "Leave live session" : "Start live session"} onClick={toggleCollab}>
              <Wifi size={16} />
            </button>
          )}

          <div className="pop-wrap">
            <button className={`icon-btn${cloudOpen ? " on" : ""}${notSynced ? " warn-badge" : ""}`} title="Cloud sync" onClick={() => { setClientIdDraft(cloud.clientId); setCloudOpen((v) => !v); }}>
              {cloud.connected && sessionEmail ? <Cloud size={16} /> : <CloudOff size={16} />}
            </button>
            {cloudOpen && (
              <div className="pop-panel">
                {!cloud.connected && (
                  <>
                    <div className="pop-title">Connect Google Drive</div>
                    {!GOOGLE_CLIENT_ID && (
                      <>
                        <label className="pop-label">Google client ID</label>
                        <input className="pop-input" placeholder="xxxx.apps.googleusercontent.com" value={clientIdDraft} onChange={(e) => setClientIdDraft(e.target.value)} spellCheck={false} />
                      </>
                    )}
                    {cloudError && <div className="pop-error">{cloudError}</div>}
                    <button className="pop-btn" onClick={() => connectDrive(false)} disabled={cloudStatus === "syncing" || (!GOOGLE_CLIENT_ID && !clientIdDraft.trim())}>
                      {cloudStatus === "syncing" ? "Connecting..." : "Sign in with Google"}
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
                <button className="menu-item" onClick={() => { setMenuOpen(false); fileRef.current.click(); }}><Upload size={14} /> Import script (.sws, .fdx, .fountain...)</button>
                <button className="menu-item" onClick={() => { setMenuOpen(false); exportSWS(); }}><FileJson size={14} /> Download script (.sws)</button>
                <button className="menu-item" onClick={() => { setMenuOpen(false); downloadBlob(`${safeName(doc.title)}.fountain`, buildFountain(doc), "text/plain"); }}><FileText size={14} /> Download .fountain</button>
                <button className="menu-item" onClick={() => { setMenuOpen(false); setTimeout(() => window.print(), 150); }}><Printer size={14} /> Print / save as PDF</button>
                <div className="pop-hint" style={{ marginTop: 0 }}>In the print dialog, untick "Headers and footers" once — your browser remembers it.</div>
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
          {remotePending && (
            <div className="collab-banner">
              <span><b>{remotePending.from}</b> made changes while you were typing.</span>
              <button onClick={() => applyRemote(remotePending.core, remotePending.basedOn)}>Load theirs</button>
              <button className="dismiss" onClick={() => setRemotePending(null)}>Keep typing</button>
            </div>
          )}
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
              /* read the DOM now: React nulls currentTarget before a deferred
                 updater runs, and this one defers whenever an update is pending */
              onInput={(e) => { const html = e.currentTarget.innerHTML; setDoc((d) => ({ ...d, treatment: html })); }} spellCheck />
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
