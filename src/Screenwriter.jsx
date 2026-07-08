import { Fragment, useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  Download, Plus, Users, X, Trash2, Flag, FileJson, Upload,
  Clapperboard, ChevronRight, Circle, FolderOpen, Copy, Cloud, CloudOff, Columns, FileText,
  History, RotateCcw, SeparatorHorizontal, Bold, List, Maximize2,
  CheckCircle2, MoreHorizontal, Moon, Sun, Printer, Timer, Flame
} from "lucide-react";

/* ---------------- storage (guarded: falls back to in-memory) ---------------- */
const storage = (() => {
  try {
    const t = "__sw_test__";
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
const OLD_SAVE_KEY = "screenwriter-doc-v1"; // legacy single-doc key, migrated on first load
const LIB_KEY = "screenwriter-library-v1";
const docKey = (id) => `screenwriter-doc-v1:${id}`;

/* ---------------- helpers ---------------- */
const uid = () => Math.random().toString(36).slice(2, 10);

function loadLibrary() {
  try {
    const raw = storage.api.getItem(LIB_KEY);
    const lib = raw ? JSON.parse(raw) : [];
    return Array.isArray(lib) ? lib : [];
  } catch {
    return [];
  }
}
function saveLibrary(lib) {
  try { storage.api.setItem(LIB_KEY, JSON.stringify(lib)); } catch {}
}
function loadProjectDoc(id) {
  try {
    const raw = storage.api.getItem(docKey(id));
    const d = raw ? JSON.parse(raw) : null;
    return d && Array.isArray(d.scenes) ? d : null;
  } catch {
    return null;
  }
}
function saveProjectDoc(id, doc) {
  try { storage.api.setItem(docKey(id), JSON.stringify(doc)); } catch {}
}
function deleteProjectDoc(id) {
  try { storage.api.removeItem(docKey(id)); } catch {}
}

/* Ensures at least one project exists, migrating the old single-script save if present.
   Returns { library, currentId }. */
function initLibrary() {
  let lib = loadLibrary();
  if (lib.length) return { library: lib, currentId: lib[0].id };

  // migrate legacy single-doc save, if any
  let legacyDoc = null;
  try {
    const raw = storage.api.getItem(OLD_SAVE_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (d && Array.isArray(d.scenes)) legacyDoc = d;
    }
  } catch {}

  const id = uid();
  const doc = legacyDoc || { ...DEFAULT_DOC };
  saveProjectDoc(id, doc);
  lib = [{ id, title: doc.title || "UNTITLED", updatedAt: Date.now() }];
  saveLibrary(lib);
  if (legacyDoc) {
    try { storage.api.removeItem(OLD_SAVE_KEY); } catch {}
  }
  return { library: lib, currentId: id };
}

const NEXT_TYPE = {
  action: "action",
  character: "dialogue",
  parenthetical: "dialogue",
  dialogue: "character",
  transition: "action",
};
const TYPE_CYCLE = ["action", "character", "dialogue", "parenthetical", "transition"];
const TYPE_LABEL = {
  action: "ACTION",
  character: "CHARACTER",
  dialogue: "DIALOGUE",
  parenthetical: "PARENTHETICAL",
  transition: "TRANSITION",
};
const PLACEHOLDER = {
  action: "Action...",
  character: "CHARACTER NAME",
  dialogue: "Dialogue...",
  parenthetical: "(beat)",
  transition: "CUT TO:",
};

const newElement = (type = "action") => ({ id: uid(), type, text: "" });
const newScene = () => ({ id: uid(), act: null, heading: "", elements: [newElement()] });

/* ---- dual dialogue helpers ---- */
// a "block" is a Character line plus whatever Dialogue/Parenthetical lines follow it
function findBlockEnd(elements, start) {
  let i = start + 1;
  while (i < elements.length && (elements[i].type === "dialogue" || elements[i].type === "parenthetical")) i++;
  return i;
}
function canPairFrom(elements, idx) {
  const el = elements[idx];
  if (!el || el.type !== "character" || el.pairId) return false;
  const end = findBlockEnd(elements, idx);
  const next = elements[end];
  return !!next && next.type === "character" && !next.pairId;
}
// groups a scene's flat element list into single lines and paired dual-dialogue blocks
function groupElements(elements) {
  const groups = [];
  let i = 0;
  while (i < elements.length) {
    const el = elements[i];
    if (el.pairId) {
      const pid = el.pairId;
      const chunk = [];
      const startIdx = i;
      while (i < elements.length && elements[i].pairId === pid) { chunk.push(elements[i]); i++; }
      groups.push({
        kind: "dual",
        pairId: pid,
        startIdx,
        left: chunk.filter((e) => e.pairSide === "left"),
        right: chunk.filter((e) => e.pairSide === "right"),
      });
    } else {
      groups.push({ kind: "single", el, idx: i });
      i++;
    }
  }
  return groups;
}

const DEFAULT_DOC = {
  title: "UNTITLED",
  theme: "",
  treatment: "",
  titlePage: { byline: "", contact: "" },
  characters: {},
  versions: [],
  acts: [],
  scenes: [newScene()],
};

/* Migrate older docs: acts used to live on scenes; now they're independent markers
   positioned by index so cards can move freely underneath them. */
function normalizeDoc(d) {
  if (!d) return d;
  const doc = { ...d };
  if (!Array.isArray(doc.acts)) doc.acts = [];
  let migrated = false;
  doc.scenes = (doc.scenes || []).map((s, i) => {
    if (s.act) {
      doc.acts = [...doc.acts, { id: s.act.id || uid(), title: s.act.title || "ACT ", index: i }];
      migrated = true;
      const { act, ...rest } = s;
      return rest;
    }
    return s;
  });
  if (!doc.titlePage) doc.titlePage = { byline: "", contact: "" };
  return migrated || !d.acts || !d.titlePage ? doc : d;
}

function escXML(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildFDX(doc) {
  const paras = [];
  const tpParas = [];
  const TP = (text, center = true) =>
    tpParas.push(`      <Paragraph${center ? ' Alignment="Center"' : ' Alignment="Left"'}><Text>${escXML(text)}</Text></Paragraph>`);
  const byline = (doc.titlePage && doc.titlePage.byline) || "";
  const contact = (doc.titlePage && doc.titlePage.contact) || "";
  for (let i = 0; i < 16; i++) TP("");
  TP(doc.title.toUpperCase());
  if (byline) {
    TP(""); TP("");
    TP("Written by");
    TP("");
    TP(byline);
  }
  if (contact) {
    for (let i = 0; i < 14; i++) TP("");
    TP(contact, false);
  }
  const P = (type, text, center) =>
    paras.push(
      `    <Paragraph Type="${type}"${center ? ' Alignment="Center"' : ""}><Text>${escXML(text)}</Text></Paragraph>`
    );
  const emit = (el) => {
    if (!el.text.trim()) return;
    const map = {
      action: "Action",
      character: "Character",
      dialogue: "Dialogue",
      parenthetical: "Parenthetical",
      transition: "Transition",
    };
    const text = el.type === "character" || el.type === "transition" ? el.text.toUpperCase() : el.text;
    P(map[el.type] || "Action", text);
  };
  doc.scenes.forEach((sc) => {
    if (sc.heading.trim()) P("Scene Heading", sc.heading.toUpperCase());
    groupElements(sc.elements).forEach((g) => {
      if (g.kind === "single") {
        emit(g.el);
      } else {
        paras.push(
          '    <Paragraph Alignment="Left" FirstIndent="0.00" Leading="Regular" LeftIndent="1.50" RightIndent="7.50" SpaceBefore="12" Spacing="1" StartsNewPage="No" Type="General">'
        );
        paras.push("      <DualDialogue>");
        g.left.forEach(emit);
        g.right.forEach(emit);
        paras.push("      </DualDialogue>");
        paras.push("    </Paragraph>");
      }
    });
  });
  return `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<FinalDraft DocumentType="Script" Template="No" Version="5">
  <Content>
${paras.join("\n")}
  </Content>
  <TitlePage>
    <Content>
${tpParas.join("\n")}
    </Content>
  </TitlePage>
</FinalDraft>`;
}

/* ---- import: read a real Final Draft FDX file back into our doc shape ---- */
function parseFDX(xmlText) {
  const dom = new DOMParser().parseFromString(xmlText, "application/xml");
  if (dom.querySelector("parsererror")) throw new Error("That doesn't look like a valid FDX file.");
  const contentEl = dom.querySelector("Content");
  if (!contentEl) throw new Error("Couldn't find script content in that file.");

  const textOf = (paragraphEl) =>
    Array.from(paragraphEl.children)
      .filter((c) => c.tagName === "Text")
      .map((c) => c.textContent)
      .join("");

  const scenes = [];
  let currentScene = null;
  const ensureScene = () => {
    if (!currentScene) {
      currentScene = newScene();
      currentScene.heading = "";
      currentScene.elements = [];
      scenes.push(currentScene);
    }
    return currentScene;
  };
  const typeToInternal = { Action: "action", Character: "character", Dialogue: "dialogue", Parenthetical: "parenthetical", Transition: "transition" };

  Array.from(contentEl.children)
    .filter((c) => c.tagName === "Paragraph")
    .forEach((p) => {
      const type = p.getAttribute("Type");
      if (type === "Scene Heading") {
        currentScene = newScene();
        currentScene.heading = textOf(p).trim();
        currentScene.elements = [];
        scenes.push(currentScene);
        return;
      }
      const dualEl = Array.from(p.children).find((c) => c.tagName === "DualDialogue");
      if (dualEl) {
        const scene = ensureScene();
        const pairId = uid();
        let side = "left";
        let charCount = 0;
        Array.from(dualEl.children)
          .filter((c) => c.tagName === "Paragraph")
          .forEach((sp) => {
            const t = sp.getAttribute("Type");
            if (t === "Character") { charCount++; if (charCount === 2) side = "right"; }
            const elType = typeToInternal[t] || "action";
            scene.elements.push({ id: uid(), type: elType, text: textOf(sp), pairId, pairSide: side });
          });
        return;
      }
      if (typeToInternal[type]) {
        ensureScene().elements.push({ id: uid(), type: typeToInternal[type], text: textOf(p) });
      }
    });

  const cleanScenes = scenes
    .map((s) => ({ ...s, elements: s.elements.length ? s.elements : [newElement()] }))
    .filter((s) => s.heading.trim() || s.elements.some((e) => e.text.trim()));
  if (!cleanScenes.length) throw new Error("Didn't find any scenes in that file.");

  let title = "IMPORTED SCRIPT";
  const titlePara = dom.querySelector("TitlePage Content Paragraph");
  if (titlePara) {
    const t = textOf(titlePara).trim();
    if (t) title = t;
  }

  return { title, theme: "", treatment: "", characters: {}, scenes: cleanScenes };
}

/* ---- import: best-guess parse of plain pasted screenplay text ---- */
function parseScriptText(text) {
  const isSceneHeading = (line) => /^(INT|EXT|INT\.\/EXT|I\/E)[./ ]/i.test(line);
  const isTransition = (line) => /(TO:|FADE (IN|OUT)\.?)$/i.test(line) && line === line.toUpperCase() && line.length < 30;
  const isParenthetical = (line) => /^\(.*\)$/.test(line);
  const looksLikeCue = (line) => line && line === line.toUpperCase() && line.length <= 40 && !/[.!?]$/.test(line);

  const scenes = [];
  let currentScene = null;
  const ensureScene = () => {
    if (!currentScene) {
      currentScene = newScene();
      currentScene.heading = "";
      currentScene.elements = [];
      scenes.push(currentScene);
    }
    return currentScene;
  };

  let lastWasCharacter = false;
  text.split(/\r?\n/).forEach((raw) => {
    const line = raw.trim();
    if (!line) { lastWasCharacter = false; return; }

    if (isSceneHeading(line)) {
      currentScene = newScene();
      currentScene.heading = line;
      currentScene.elements = [];
      scenes.push(currentScene);
      lastWasCharacter = false;
      return;
    }
    const scene = ensureScene();
    if (isTransition(line)) {
      scene.elements.push({ id: uid(), type: "transition", text: line });
      lastWasCharacter = false;
      return;
    }
    if (isParenthetical(line)) {
      scene.elements.push({ id: uid(), type: "parenthetical", text: line });
      return;
    }
    if (looksLikeCue(line) && !lastWasCharacter) {
      scene.elements.push({ id: uid(), type: "character", text: line });
      lastWasCharacter = true;
      return;
    }
    const prev = scene.elements[scene.elements.length - 1];
    if (lastWasCharacter || (prev && (prev.type === "dialogue" || prev.type === "parenthetical"))) {
      if (!lastWasCharacter && prev && prev.type === "dialogue") {
        prev.text = `${prev.text} ${line}`; // wrapped line continues the same speech
      } else {
        scene.elements.push({ id: uid(), type: "dialogue", text: line });
      }
      lastWasCharacter = false;
      return;
    }
    scene.elements.push({ id: uid(), type: "action", text: line });
  });

  const cleanScenes = scenes
    .map((s) => ({ ...s, elements: s.elements.length ? s.elements : [newElement()] }))
    .filter((s) => s.heading.trim() || s.elements.some((e) => e.text.trim()));
  if (!cleanScenes.length) throw new Error("Didn't find any text to import.");
  return { title: "IMPORTED SCRIPT", theme: "", treatment: "", characters: {}, scenes: cleanScenes };
}

function downloadFile(name, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const CLOUD_KEY = "screenwriter-cloud-v1";

/* Paste your Google client ID between the quotes below and every device (yours and
   friends') will skip the client ID field entirely. Find it at console.cloud.google.com
   under Credentials. It ends in .apps.googleusercontent.com */
const DEFAULT_GOOGLE_CLIENT_ID = "";

const HEADING_RE = /^(INT|EXT|INT\/EXT|I\/E|EST)[.\s]/i;
const TRANSITION_RE = /^[A-Z0-9 '.]+TO:$/;
const CHAR_EXTENSIONS = ["(V.O.)", "(O.S.)", "(CONT'D)", "(PRE-LAP)", "(INTO PHONE)"];

let gsiLoadPromise = null;
function loadGoogleScript() {
  if (window.google && window.google.accounts && window.google.accounts.id) return Promise.resolve();
  if (gsiLoadPromise) return gsiLoadPromise;
  gsiLoadPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Couldn't load Google's sign-in script."));
    document.head.appendChild(s);
  });
  return gsiLoadPromise;
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

/* ---------------- element (one screenplay line) ---------------- */
function Element({ el, sceneId, focusTarget, onChange, onKeyDown, onFocus, onBlur, focused, suggestions = [], emptySuggestions = [], onPasteLines }) {
  const ref = useRef(null);
  const [menu, setMenu] = useState(null); // { items: [{label, insert}], index, interacted }

  const resize = useCallback(() => {
    const ta = ref.current;
    if (!ta) return;
    ta.style.height = "0px";
    ta.style.height = ta.scrollHeight + "px";
  }, []);

  useEffect(() => { resize(); }, [el.text, resize]);

  useEffect(() => {
    if (focusTarget && focusTarget.id === el.id && ref.current) {
      const ta = ref.current;
      ta.focus();
      const pos =
        focusTarget.caret === "start" ? 0
        : focusTarget.caret === "end" ? ta.value.length
        : Math.min(Number(focusTarget.caret) || 0, ta.value.length);
      ta.setSelectionRange(pos, pos);
    }
  }, [focusTarget, el.id]);

  const updateMenu = (text) => {
    if (el.type !== "character") { setMenu(null); return; }
    const t = text.toUpperCase();
    let items = [];
    const parenMatch = t.match(/^(.*?)(\([A-Z.' -]*)$/);
    if (parenMatch) {
      const base = parenMatch[1];
      const frag = parenMatch[2];
      items = CHAR_EXTENSIONS
        .filter((x) => x.startsWith(frag) && x !== frag)
        .map((x) => ({ label: base + x, insert: base + x }));
    } else if (!t.trim()) {
      /* empty line: offer prior speakers, alternating speaker first (SmartType style) */
      items = emptySuggestions.slice(0, 5).map((n) => ({ label: n, insert: n }));
    } else {
      items = suggestions
        .filter((n) => n.startsWith(t.trim()) && n !== t.trim())
        .slice(0, 5)
        .map((n) => ({ label: n, insert: n }));
    }
    setMenu(items.length ? { items, index: 0, interacted: false } : null);
  };

  const accept = (item) => {
    onChange(sceneId, el.id, item.insert);
    setMenu(null);
    if (ref.current) {
      const ta = ref.current;
      setTimeout(() => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }, 0);
    }
  };

  const handleKey = (e) => {
    if (menu) {
      if (e.key === "ArrowDown") { e.preventDefault(); setMenu((m) => ({ ...m, index: (m.index + 1) % m.items.length, interacted: true })); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setMenu((m) => ({ ...m, index: (m.index - 1 + m.items.length) % m.items.length, interacted: true })); return; }
      if (e.key === "Tab") { e.preventDefault(); accept(menu.items[menu.index]); return; }
      if (e.key === "Enter") {
        /* on an empty, untouched suggestion menu, Enter means "no name": fall through
           so double-Enter converts to action; if the user typed or arrowed, accept */
        if (el.text.trim() || menu.interacted) { e.preventDefault(); accept(menu.items[menu.index]); return; }
        setMenu(null);
      }
      if (e.key === "Escape") { setMenu(null); return; }
    }
    onKeyDown(e, sceneId, el.id);
  };

  const handleFocus = () => {
    onFocus(el.id);
    updateMenu(el.text);
  };

  const headingish = el.type === "action" && !el.pairId && HEADING_RE.test(el.text.trim());

  return (
    <div className={`el-row el-${el.type}${focused ? " focused" : ""}${headingish ? " headingish" : ""}`}>
      <span className="el-type-label">{TYPE_LABEL[el.type]}</span>
      <textarea
        ref={ref}
        rows={1}
        value={el.text}
        placeholder={PLACEHOLDER[el.type]}
        onChange={(e) => { onChange(sceneId, el.id, e.target.value); updateMenu(e.target.value); }}
        onKeyDown={handleKey}
        onFocus={handleFocus}
        onBlur={() => { setTimeout(() => setMenu(null), 150); onBlur(); }}
        onPaste={(e) => {
          const t = e.clipboardData && e.clipboardData.getData("text");
          if (t && t.includes("\n") && onPasteLines) {
            e.preventDefault();
            onPasteLines(sceneId, el.id, t);
          }
        }}
        spellCheck={false}
      />
      {menu && (
        <div className="ac-menu">
          {menu.items.map((it, i) => (
            <div
              key={it.label}
              className={`ac-item${i === menu.index ? " active" : ""}`}
              onMouseDown={(e) => { e.preventDefault(); accept(it); }}
            >
              {it.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------- main app ---------------- */
export default function Screenwriter() {
  const initRef = useRef(null);
  if (!initRef.current) initRef.current = initLibrary();

  const [library, setLibrary] = useState(initRef.current.library);
  const [currentId, setCurrentId] = useState(initRef.current.currentId);
  const [doc, setDoc] = useState(() => loadProjectDoc(initRef.current.currentId) || { ...DEFAULT_DOC });
  const [saveState, setSaveState] = useState("saved");
  const [boardOpen, setBoardOpen] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth > 980 : true
  );
  const [boardFull, setBoardFull] = useState(false);
  const [streak, setStreak] = useState(() => {
    try {
      const s = JSON.parse(storage.api.getItem("screenwriter-streak") || "null");
      return s && typeof s.streak === "number" ? s : { streak: 0, last: "" };
    } catch { return { streak: 0, last: "" }; }
  });
  const streakRef = useRef(streak);
  streakRef.current = streak;
  const [charsOpen, setCharsOpen] = useState(false);
  const [treatmentOpen, setTreatmentOpen] = useState(false);
  const [treatmentWide, setTreatmentWide] = useState(false);
  const treatmentRef = useRef(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [night, setNight] = useState(() => {
    try { return storage.api.getItem("screenwriter-night") === "1"; } catch { return false; }
  });
  const [pomo, setPomo] = useState(null); // { phase: 'work'|'break', remaining, running }

  /* ---- undo/redo: snapshot history of the script (Ctrl+Z / Ctrl+Shift+Z or Ctrl+Y) ---- */
  const histRef = useRef({ stack: [], idx: -1, quiet: false });

  useEffect(() => {
    const h = histRef.current;
    if (h.quiet) { h.quiet = false; return; }
    const t = setTimeout(() => {
      const snap = JSON.stringify(doc.scenes);
      if (h.stack[h.idx] === snap) return;
      h.stack = h.stack.slice(0, h.idx + 1);
      h.stack.push(snap);
      if (h.stack.length > 80) h.stack.shift();
      h.idx = h.stack.length - 1;
    }, 400);
    return () => clearTimeout(t);
  }, [doc.scenes]);

  useEffect(() => {
    const onKey = (e) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z" && e.key.toLowerCase() !== "y") return;
      if (e.target && e.target.closest && e.target.closest(".treatment-editor")) return; // native undo there
      const h = histRef.current;
      const redo = e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey);
      e.preventDefault();
      if (redo) {
        if (h.idx < h.stack.length - 1) {
          h.idx += 1;
          h.quiet = true;
          setDoc((d) => ({ ...d, scenes: JSON.parse(h.stack[h.idx]) }));
        }
      } else if (h.idx > 0) {
        h.idx -= 1;
        h.quiet = true;
        setDoc((d) => ({ ...d, scenes: JSON.parse(h.stack[h.idx]) }));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* fresh history per project so undo never crosses into another script */
  useEffect(() => {
    histRef.current = { stack: [JSON.stringify(doc.scenes)], idx: 0, quiet: false };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId]);

  /* pomodoro tick: 25 min focus, 5 min break, gentle beep at each switch */
  useEffect(() => {
    if (!pomo || !pomo.running) return;
    const t = setInterval(() => {
      setPomo((p) => {
        if (!p) return p;
        if (p.remaining > 1) return { ...p, remaining: p.remaining - 1 };
        try {
          const ctx = new (window.AudioContext || window.webkitAudioContext)();
          const g = ctx.createGain();
          g.connect(ctx.destination);
          g.gain.setValueAtTime(0.12, ctx.currentTime);
          const o = ctx.createOscillator();
          o.connect(g); o.frequency.value = 880;
          o.start(); o.stop(ctx.currentTime + 0.18);
          const o2 = ctx.createOscillator();
          o2.connect(g); o2.frequency.value = 1175;
          o2.start(ctx.currentTime + 0.24); o2.stop(ctx.currentTime + 0.44);
        } catch {}
        return p.phase === "work"
          ? { phase: "break", remaining: 5 * 60, running: true }
          : { phase: "work", remaining: 25 * 60, running: true };
      });
    }, 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pomo && pomo.running]);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [focusTarget, setFocusTarget] = useState(null);
  const [focusedEl, setFocusedEl] = useState(null);
  const [dragIdx, setDragIdx] = useState(null);
  const [overIdx, setOverIdx] = useState(null);
  const [newChar, setNewChar] = useState(null); // null = closed, "" = open input
  const [selectedScenes, setSelectedScenes] = useState(() => new Set());
  const selectAnchor = useRef(null);
  const [pageBreaks, setPageBreaks] = useState([]);
  const [showBreaks, setShowBreaks] = useState(() => {
    try { return storage.api.getItem("screenwriter-showbreaks") !== "0"; } catch { return true; }
  });
  const sceneRefs = useRef({});
  const fileRef = useRef(null);
  const skipNextSave = useRef(false); // true right after switching projects
  const pageRef = useRef(null);
  const lineProbeRef = useRef(null);
  const rafRef = useRef(null);

  /* ---- pagination: a thin break line every 55 lines, snapped to safe spots ---- */
  const recomputeBreaks = useCallback(() => {
    const pageEl = pageRef.current;
    const probe = lineProbeRef.current;
    if (!pageEl || !probe) return;
    const lineHeightPx = probe.getBoundingClientRect().height || 17;
    const pageRect = pageEl.getBoundingClientRect();
    const cs = getComputedStyle(pageEl);
    const padTop = parseFloat(cs.paddingTop) || 0;
    const padBottom = parseFloat(cs.paddingBottom) || 0;
    const contentHeight = pageEl.scrollHeight - padTop - padBottom;
    const pageHeightPx = lineHeightPx * 55; // 55 lines/page is the standard screenplay rule
    const targetCount = Math.max(1, Math.ceil(contentHeight / pageHeightPx));

    // safe break points: tops of scene headings, act markers, action/character/transition lines.
    // dialogue and parentheticals are deliberately excluded so a break can never land
    // between a character name and their line, or in the middle of a speech.
    const anchorNodes = pageEl.querySelectorAll(
      ".heading-row, .el-action, .el-character, .el-transition"
    );
    const anchors = Array.from(anchorNodes)
      .map((n) => n.getBoundingClientRect().top - pageRect.top)
      .filter((y) => y > padTop + 4)
      .sort((a, b) => a - b);

    const breaks = [];
    for (let n = 1; n < targetCount; n++) {
      const target = padTop + n * pageHeightPx;
      let chosen = null;
      for (const y of anchors) {
        if (y <= target) chosen = y;
        else break;
      }
      if (chosen == null) chosen = anchors.find((y) => y > target) ?? target;
      if (!breaks.length || Math.abs(breaks[breaks.length - 1].y - chosen) > 4) {
        breaks.push({ y: chosen, page: breaks.length + 2 });
      }
    }
    setPageBreaks(breaks);
  }, []);

  useEffect(() => {
    const pageEl = pageRef.current;
    if (!pageEl) return;
    const schedule = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(recomputeBreaks);
    };
    const ro = new ResizeObserver(schedule);
    ro.observe(pageEl);
    schedule();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(schedule).catch(() => {});
    window.addEventListener("resize", schedule);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", schedule);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [recomputeBreaks]);

  const touchLibrary = useCallback((id, title) => {
    setLibrary((lib) => {
      const next = lib.map((p) =>
        p.id === id ? { ...p, title: title || "UNTITLED", updatedAt: Date.now() } : p
      );
      saveLibrary(next);
      return next;
    });
  }, []);

  const persist = useCallback((id, d) => {
    saveProjectDoc(id, d);
    touchLibrary(id, d.title);
  }, [touchLibrary]);

  /* ---- cloud sync (Google Drive, drive.file scope) ---- */
  const [cloud, setCloud] = useState(() => {
    try {
      const raw = storage.api.getItem(CLOUD_KEY);
      const c = raw ? JSON.parse(raw) : null;
      return c && typeof c === "object"
        ? {
            clientId: c.clientId || "",
            connected: !!c.connected,
            lastSyncedAt: c.lastSyncedAt || null,
            email: c.email || "",
            folderId: c.folderId || null,
            fileId: c.fileId || null,
          }
        : { clientId: "", connected: false, lastSyncedAt: null, email: "", folderId: null, fileId: null };
    } catch {
      return { clientId: "", connected: false, lastSyncedAt: null, email: "", folderId: null, fileId: null };
    }
  });
  const [cloudOpen, setCloudOpen] = useState(false);
  const [cloudStatus, setCloudStatus] = useState("idle"); // idle | syncing | ok | error
  const [cloudError, setCloudError] = useState("");
  const [clientIdDraft, setClientIdDraft] = useState(cloud.clientId);
  const [sessionEmail, setSessionEmail] = useState(""); // set once signed in THIS session
  const accessTokenRef = useRef(null);
  const tokenClientRef = useRef(null);

  const stateRef = useRef();
  stateRef.current = { library, doc, currentId };
  const cloudRef = useRef(cloud);
  cloudRef.current = cloud;

  const persistCloud = (next) => {
    setCloud(next);
    try { storage.api.setItem(CLOUD_KEY, JSON.stringify(next)); } catch {}
  };

  const buildSnapshot = () => {
    const { library: lib, doc: curDoc, currentId: curId } = stateRef.current;
    const docs = {};
    lib.forEach((p) => {
      const d = p.id === curId ? curDoc : loadProjectDoc(p.id);
      if (d) docs[p.id] = d;
    });
    docs[curId] = curDoc;
    return { library: lib, docs, updatedAt: Date.now() };
  };

  const driveFetch = async (opts = {}, url) => {
    if (!accessTokenRef.current) throw new Error("Signed out. Reconnect to sync.");
    const res = await fetch(url, {
      ...opts,
      headers: { ...(opts.headers || {}), Authorization: `Bearer ${accessTokenRef.current}` },
    });
    if (res.status === 401) throw new Error("Signed out. Reconnect to sync.");
    if (!res.ok) throw new Error(`Drive said ${res.status}`);
    return res;
  };

  const ensureFolder = async () => {
    const q = encodeURIComponent("name='Screenwriter' and mimeType='application/vnd.google-apps.folder' and trashed=false");
    const found = await driveFetch({}, `https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive&fields=files(id)`);
    const data = await found.json();
    if (data.files && data.files.length) return data.files[0].id;
    const created = await driveFetch(
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Screenwriter", mimeType: "application/vnd.google-apps.folder" }),
      },
      "https://www.googleapis.com/drive/v3/files"
    );
    return (await created.json()).id;
  };

  const findFile = async (folderId) => {
    const q = encodeURIComponent(`name='screenwriter-sync.json' and '${folderId}' in parents and trashed=false`);
    const res = await driveFetch({}, `https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive&fields=files(id)`);
    const data = await res.json();
    return (data.files && data.files[0] && data.files[0].id) || null;
  };

  const createFile = async (folderId, content) => {
    const boundary = "swjsboundary";
    const metadata = { name: "screenwriter-sync.json", parents: [folderId], mimeType: "application/json" };
    const body =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\nContent-Type: application/json\r\n\r\n${content}\r\n--${boundary}--`;
    const res = await driveFetch(
      { method: "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body },
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id"
    );
    return (await res.json()).id;
  };

  const updateFile = (fileId, content) =>
    driveFetch(
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: content },
      `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`
    );

  const fetchDriveFile = async (fileId) => {
    const res = await driveFetch({}, `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
    try { return JSON.parse(await res.text()); } catch { return null; }
  };

  const pushToCloud = async (cfg) => {
    const folderId = cfg.folderId || (await ensureFolder());
    const content = JSON.stringify(buildSnapshot());
    let fileId = cfg.fileId;
    if (fileId) {
      try {
        await updateFile(fileId, content);
      } catch {
        fileId = await createFile(folderId, content);
      }
    } else {
      fileId = await createFile(folderId, content);
    }
    return { folderId, fileId };
  };

  const pullFromCloud = async (cfg) => {
    const folderId = cfg.folderId || (await ensureFolder());
    const fileId = cfg.fileId || (await findFile(folderId));
    if (!fileId) return { remote: null, folderId, fileId: null };
    const data = await fetchDriveFile(fileId);
    return { remote: data && Array.isArray(data.library) ? data : null, folderId, fileId };
  };

  const applySnapshot = (snap) => {
    saveLibrary(snap.library);
    Object.entries(snap.docs).forEach(([id, d]) => saveProjectDoc(id, d));
    setLibrary(snap.library);
    const keepCurrent = snap.docs[currentId] ? currentId : (snap.library[0] && snap.library[0].id);
    if (keepCurrent) {
      skipNextSave.current = true;
      setCurrentId(keepCurrent);
      setDoc(snap.docs[keepCurrent] || { ...DEFAULT_DOC });
    }
  };

  const silentRef = useRef(false);
  const refreshTimerRef = useRef(null);

  const connectDrive = async (silent = false) => {
    const clientId = (DEFAULT_GOOGLE_CLIENT_ID || clientIdDraft || cloud.clientId || "").trim();
    if (!clientId) { if (!silent) setCloudError("Add your Google client ID first."); return; }
    if (!silent) setCloudError("");
    silentRef.current = silent;
    try {
      await loadGoogleScript();
    } catch (err) {
      if (!silent) setCloudError(err.message);
      return;
    }
    if (!tokenClientRef.current || tokenClientRef.current.clientId !== clientId) {
      const client = window.google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email",
        callback: async (resp) => {
          if (resp.error) {
            if (silentRef.current) { setCloudStatus("idle"); return; } // quiet fail on background sign-in
            setCloudStatus("error");
            setCloudError(resp.error === "access_denied" ? "Sign-in was cancelled." : resp.error);
            return;
          }
          accessTokenRef.current = resp.access_token;
          /* refresh the token silently before it expires (Google tokens last ~1 hour) */
          if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
          refreshTimerRef.current = setTimeout(() => {
            silentRef.current = true;
            try { tokenClientRef.current.requestAccessToken({ prompt: "" }); } catch {}
          }, 50 * 60 * 1000);

          setCloudStatus("syncing");
          try {
            const infoRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
              headers: { Authorization: `Bearer ${resp.access_token}` },
            });
            const info = await infoRes.json();
            setSessionEmail(info.email || "signed in");

            const cc = cloudRef.current;
            const wasConnected = cc.connected;
            const { remote, folderId, fileId } = await pullFromCloud(cc);
            let finalFileId = fileId;
            if (remote && Object.keys(remote.docs).length && !wasConnected) {
              const when = timeAgo(remote.updatedAt);
              const useRemote = window.confirm(
                `Found an existing Drive backup with ${remote.library.length} script(s), last saved ${when}.\n\nOK = load that backup here (replaces what's open now)\nCancel = keep what's on this device and upload it to Drive`
              );
              if (useRemote) applySnapshot(remote);
              else finalFileId = (await pushToCloud({ ...cc, folderId, fileId })).fileId;
            } else if (remote) {
              /* reconnecting: only pull the remote copy if it's actually newer than our last sync,
                 otherwise push local work up. Never blindly overwrite newer local changes. */
              if (remote.updatedAt > (cc.lastSyncedAt || 0) + 2000) applySnapshot(remote);
              else finalFileId = (await pushToCloud({ ...cc, folderId, fileId })).fileId;
            } else {
              finalFileId = (await pushToCloud({ ...cc, folderId, fileId })).fileId;
            }
            persistCloud({
              clientId, connected: true, lastSyncedAt: Date.now(),
              email: info.email || "", folderId, fileId: finalFileId,
            });
            setCloudStatus("ok");
          } catch (err) {
            setCloudStatus("error");
            if (!silentRef.current) setCloudError(err.message || "Couldn't reach Google Drive.");
          }
        },
      });
      client.clientId = clientId;
      tokenClientRef.current = client;
    }
    tokenClientRef.current.requestAccessToken({ prompt: silent || sessionEmail ? "" : "consent" });
  };

  /* auto sign-in on load: if this device was connected before, quietly resume the session */
  useEffect(() => {
    if (!cloud.connected) return;
    const cid = (DEFAULT_GOOGLE_CLIENT_ID || cloud.clientId || "").trim();
    if (!cid) return;
    const t = setTimeout(() => connectDrive(true), 900);
    return () => { clearTimeout(t); if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const syncNow = async () => {
    if (!cloud.connected) return;
    setCloudStatus("syncing");
    try {
      const { folderId, fileId } = await pushToCloud(cloud);
      persistCloud({ ...cloud, folderId, fileId, lastSyncedAt: Date.now() });
      setCloudStatus("ok");
    } catch (err) {
      setCloudStatus("error");
      setCloudError(err.message || "Couldn't reach Google Drive.");
    }
  };

  const disconnectCloud = () => {
    try {
      if (accessTokenRef.current && window.google) {
        window.google.accounts.oauth2.revoke(accessTokenRef.current);
      }
    } catch {}
    persistCloud({ ...cloud, connected: false });
    accessTokenRef.current = null;
    setSessionEmail("");
    setCloudStatus("idle");
  };

  /* background push every 60s while connected and signed in this session */
  useEffect(() => {
    if (!cloud.connected) return;
    const t = setInterval(() => {
      if (!accessTokenRef.current) return;
      pushToCloud(cloud)
        .then(({ folderId, fileId }) => persistCloud({ ...cloud, folderId, fileId, lastSyncedAt: Date.now() }))
        .catch(() => setCloudStatus("error"));
    }, 60000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloud.connected, cloud.clientId]);

  /* ---- autosave (also tracks the daily writing streak) ---- */
  useEffect(() => {
    if (skipNextSave.current) { skipNextSave.current = false; return; }
    setSaveState("saving");
    const t = setTimeout(() => {
      persist(currentId, doc);
      setSaveState("saved");
      const today = new Date().toISOString().slice(0, 10);
      if (streakRef.current.last !== today) {
        const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
        const next = {
          streak: streakRef.current.last === yesterday ? streakRef.current.streak + 1 : 1,
          last: today,
        };
        setStreak(next);
        try { storage.api.setItem("screenwriter-streak", JSON.stringify(next)); } catch {}
      }
    }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc]);

  /* ---- ctrl/cmd+S ---- */
  useEffect(() => {
    const h = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        persist(currentId, doc);
        setSaveState("saved");
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [doc, currentId, persist]);

  /* ---- project switching ---- */
  const openProject = (id) => {
    if (id === currentId) { setProjectsOpen(false); return; }
    persist(currentId, doc); // flush current before leaving it
    const next = loadProjectDoc(id) || { ...DEFAULT_DOC };
    skipNextSave.current = true;
    setCurrentId(id);
    setDoc(next);
    setProjectsOpen(false);
  };

  const newProject = () => {
    persist(currentId, doc);
    const id = uid();
    const fresh = { ...DEFAULT_DOC };
    saveProjectDoc(id, fresh);
    const entry = { id, title: fresh.title, updatedAt: Date.now() };
    setLibrary((lib) => {
      const next = [entry, ...lib];
      saveLibrary(next);
      return next;
    });
    skipNextSave.current = true;
    setCurrentId(id);
    setDoc(fresh);
    setProjectsOpen(false);
  };

  const duplicateProject = (id) => {
    const source = id === currentId ? doc : loadProjectDoc(id);
    if (!source) return;
    const copy = { ...source, title: `${source.title} COPY` };
    const newId = uid();
    saveProjectDoc(newId, copy);
    setLibrary((lib) => {
      const next = [{ id: newId, title: copy.title, updatedAt: Date.now() }, ...lib];
      saveLibrary(next);
      return next;
    });
  };

  const deleteProject = (id) => {
    if (library.length <= 1) return; // always keep at least one
    deleteProjectDoc(id);
    setLibrary((lib) => {
      const next = lib.filter((p) => p.id !== id);
      saveLibrary(next);
      return next;
    });
    if (id === currentId) {
      const fallback = library.find((p) => p.id !== id);
      if (fallback) {
        const next = loadProjectDoc(fallback.id) || { ...DEFAULT_DOC };
        skipNextSave.current = true;
        setCurrentId(fallback.id);
        setDoc(next);
      }
    }
  };

  /* ---- doc mutations ---- */
  const updateScene = (sceneId, fn) =>
    setDoc((d) => ({
      ...d,
      scenes: d.scenes.map((s) => (s.id === sceneId ? fn(s) : s)),
    }));

  const changeElement = useCallback((sceneId, elId, text) => {
    setDoc((d) => ({
      ...d,
      scenes: d.scenes.map((s) =>
        s.id !== sceneId
          ? s
          : { ...s, elements: s.elements.map((e) => (e.id !== elId ? e : { ...e, text })) }
      ),
    }));
  }, []);

  const addScene = (afterIdx = null) => {
    const sc = newScene();
    setDoc((d) => {
      const scenes = [...d.scenes];
      const i = afterIdx === null ? scenes.length : afterIdx + 1;
      scenes.splice(i, 0, sc);
      return { ...d, scenes };
    });
    setTimeout(() => {
      const node = sceneRefs.current[sc.id];
      if (node) node.scrollIntoView({ behavior: "smooth", block: "center" });
      const inp = node && node.querySelector(".heading-input");
      if (inp) inp.focus();
    }, 60);
  };

  const deleteScene = (sceneId) =>
    setDoc((d) => {
      const scenes = d.scenes.filter((s) => s.id !== sceneId);
      return { ...d, scenes: scenes.length ? scenes : [newScene()] };
    });

  const handleCardClick = (e, i, sc) => {
    if (e.metaKey || e.ctrlKey) {
      setSelectedScenes((prev) => {
        const next = new Set(prev);
        if (next.has(sc.id)) next.delete(sc.id);
        else next.add(sc.id);
        return next;
      });
      selectAnchor.current = i;
      return;
    }
    if (e.shiftKey && selectAnchor.current !== null) {
      const [a, b] = [Math.min(selectAnchor.current, i), Math.max(selectAnchor.current, i)];
      setSelectedScenes(new Set(doc.scenes.slice(a, b + 1).map((s) => s.id)));
      return;
    }
    setSelectedScenes(new Set());
    selectAnchor.current = i;
    const node = sceneRefs.current[sc.id];
    if (node) node.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const deleteSelectedScenes = () => {
    if (!selectedScenes.size) return;
    if (!window.confirm(`Delete ${selectedScenes.size} scene${selectedScenes.size > 1 ? "s" : ""}? This can't be undone.`)) return;
    setDoc((d) => {
      const scenes = d.scenes.filter((s) => !selectedScenes.has(s.id));
      return { ...d, scenes: scenes.length ? scenes : [newScene()] };
    });
    setSelectedScenes(new Set());
    selectAnchor.current = null;
  };

  /* ---- versions: named snapshots stored inside the project, so they back up and sync too ---- */
  const [verOpen, setVerOpen] = useState(false);
  const [treatmentTick, setTreatmentTick] = useState(0);

  const snapshotCurrent = () =>
    JSON.parse(JSON.stringify({
      title: doc.title, theme: doc.theme, treatment: doc.treatment || "",
      characters: doc.characters, scenes: doc.scenes,
    }));

  const saveVersion = () => {
    const name = window.prompt("Name this version:", `Draft ${((doc.versions || []).length) + 1}`);
    if (!name) return;
    const snap = snapshotCurrent();
    setDoc((d) => ({ ...d, versions: [...(d.versions || []), { id: uid(), name: name.trim(), createdAt: Date.now(), ...snap }] }));
  };

  const restoreVersion = (vid) => {
    const v = (doc.versions || []).find((x) => x.id === vid);
    if (!v) return;
    if (!window.confirm(`Restore "${v.name}"? Your current state will be saved as its own version first.`)) return;
    const cur = snapshotCurrent();
    setDoc((d) => ({
      ...d,
      versions: [...(d.versions || []), { id: uid(), name: `Before restoring ${v.name}`, createdAt: Date.now(), ...cur }],
      title: v.title,
      theme: v.theme,
      treatment: v.treatment || "",
      characters: JSON.parse(JSON.stringify(v.characters)),
      scenes: JSON.parse(JSON.stringify(v.scenes)),
    }));
    setTreatmentTick((t) => t + 1);
    setVerOpen(false);
  };

  const deleteVersion = (vid) => {
    const v = (doc.versions || []).find((x) => x.id === vid);
    if (!v) return;
    if (!window.confirm(`Delete version "${v.name}"?`)) return;
    setDoc((d) => ({ ...d, versions: (d.versions || []).filter((x) => x.id !== vid) }));
  };

  /* load treatment content into the editor when opened, switching projects, or restoring a version */
  useEffect(() => {
    if (!treatmentOpen) return;
    const el = treatmentRef.current;
    if (!el) return;
    let html = doc.treatment || "";
    if (html && !/[<>]/.test(html)) {
      // migrate old plain-text treatments
      const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      html = html.split("\n").map(esc).join("<br>");
    }
    html = html.replace(/<script[\s\S]*?<\/script>/gi, "");
    if (el.innerHTML !== html) el.innerHTML = html;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [treatmentOpen, currentId, treatmentTick]);

  const toggleAct = (sceneId) =>
    updateScene(sceneId, (s) =>
      s.act ? { ...s, act: null } : { ...s, act: { id: uid(), title: "ACT " } }
    );

  const setActTitle = (sceneId, title) =>
    updateScene(sceneId, (s) => ({ ...s, act: { ...s.act, title } }));

  const moveScene = (from, to) => {
    if (from === to || from === null || to === null) return;
    setDoc((d) => {
      /* act flags stay anchored to their position in the list; only the cards move */
      const actsAtPosition = d.scenes.map((s) => s.act || null);
      const scenes = [...d.scenes];
      const [sc] = scenes.splice(from, 1);
      scenes.splice(to > from ? to - 1 : to, 0, sc);
      return { ...d, scenes: scenes.map((s, i) => ({ ...s, act: actsAtPosition[i] })) };
    });
  };

  const pairDual = (sceneId, charIdx) =>
    updateScene(sceneId, (s) => {
      if (!canPairFrom(s.elements, charIdx)) return s;
      const blockAEnd = findBlockEnd(s.elements, charIdx);
      const blockBEnd = findBlockEnd(s.elements, blockAEnd);
      const pairId = uid();
      const elements = s.elements.map((el, idx) => {
        if (idx >= charIdx && idx < blockAEnd) return { ...el, pairId, pairSide: "left" };
        if (idx >= blockAEnd && idx < blockBEnd) return { ...el, pairId, pairSide: "right" };
        return el;
      });
      return { ...s, elements };
    });

  const unpairDual = (sceneId, pairId) =>
    updateScene(sceneId, (s) => ({
      ...s,
      elements: s.elements.map((el) =>
        el.pairId === pairId ? { ...el, pairId: undefined, pairSide: undefined } : el
      ),
    }));

  /* ---- editor keys ---- */
  const handleKeyDown = useCallback((e, sceneId, elId) => {
    setDoc((d) => {
      const scene = d.scenes.find((s) => s.id === sceneId);
      if (!scene) return d;
      const idx = scene.elements.findIndex((el) => el.id === elId);
      const el = scene.elements[idx];
      if (!el) return d;

      /* enter: Final Draft style element flow */
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();

        const isEmpty = !el.text.trim();

        /* empty line inside a dual dialogue block: step out of the block entirely */
        if (isEmpty && el.pairId) {
          const next = newElement("action");
          const elements = scene.elements.filter((x) => x.id !== elId);
          let insertAt = elements.length;
          for (let k = 0; k < elements.length; k++) {
            if (elements[k].pairId === el.pairId) insertAt = k + 1;
          }
          elements.splice(insertAt, 0, next);
          setTimeout(() => setFocusTarget({ id: next.id, caret: "start", ts: Date.now() }), 0);
          return { ...d, scenes: d.scenes.map((s) => (s.id === sceneId ? { ...s, elements } : s)) };
        }

        /* empty character/dialogue/parenthetical/transition: convert in place to action (double-Enter flow) */
        if (isEmpty && el.type !== "action") {
          return {
            ...d,
            scenes: d.scenes.map((s) =>
              s.id !== sceneId
                ? s
                : { ...s, elements: s.elements.map((x) => (x.id !== elId ? x : { ...x, type: "action" })) }
            ),
          };
        }

        /* typed INT./EXT. on an action line? split into a new scene */
        if (el.type === "action" && !el.pairId && HEADING_RE.test(el.text.trim())) {
          const sIdx = d.scenes.findIndex((s) => s.id === sceneId);
          const before = scene.elements.slice(0, idx);
          const after = scene.elements.slice(idx + 1);
          const ns = {
            id: uid(),
            act: null,
            heading: el.text.trim(),
            elements: after.length ? after : [newElement()],
          };
          const scenes = [...d.scenes];
          scenes[sIdx] = { ...scene, elements: before.length ? before : [newElement()] };
          scenes.splice(sIdx + 1, 0, ns);
          const focusEl = ns.elements[0];
          setTimeout(() => setFocusTarget({ id: focusEl.id, caret: "start", ts: Date.now() }), 0);
          return { ...d, scenes };
        }

        const next = newElement(NEXT_TYPE[el.type] || "action");
        /* stay inside the dual block only if more paired lines follow; the last right-column
           line exits back to normal single-column flow automatically */
        if (el.pairId) {
          const after = scene.elements[idx + 1];
          const isLastOfBlock = !after || after.pairId !== el.pairId;
          if (!(el.pairSide === "right" && isLastOfBlock)) {
            next.pairId = el.pairId;
            next.pairSide = el.pairSide;
          }
        }
        const elements = [...scene.elements];
        elements.splice(idx + 1, 0, next);
        setTimeout(() => setFocusTarget({ id: next.id, caret: "end", ts: Date.now() }), 0);
        return {
          ...d,
          scenes: d.scenes.map((s) => (s.id === sceneId ? { ...s, elements } : s)),
        };
      }

      /* tab: cycle element type */
      if (e.key === "Tab") {
        e.preventDefault();
        const dir = e.shiftKey ? -1 : 1;
        const i = TYPE_CYCLE.indexOf(el.type);
        const type = TYPE_CYCLE[(i + dir + TYPE_CYCLE.length) % TYPE_CYCLE.length];
        return {
          ...d,
          scenes: d.scenes.map((s) =>
            s.id !== sceneId
              ? s
              : { ...s, elements: s.elements.map((x) => (x.id !== elId ? x : { ...x, type })) }
          ),
        };
      }

      /* backspace on empty: remove, focus previous */
      if (e.key === "Backspace" && el.text === "" && scene.elements.length > 1) {
        e.preventDefault();
        const prev = scene.elements[idx - 1];
        const elements = scene.elements.filter((x) => x.id !== elId);
        if (prev) setTimeout(() => setFocusTarget({ id: prev.id, caret: "end", ts: Date.now() }), 0);
        return {
          ...d,
          scenes: d.scenes.map((s) => (s.id === sceneId ? { ...s, elements } : s)),
        };
      }

      /* backspace at the start of a non-empty line: merge it into the previous line,
         so deleting flows continuously across elements like a normal editor */
      if (
        e.key === "Backspace" &&
        el.text !== "" &&
        e.target.selectionStart === 0 &&
        e.target.selectionEnd === 0 &&
        idx > 0 &&
        !el.pairId && !scene.elements[idx - 1].pairId
      ) {
        e.preventDefault();
        const prev = scene.elements[idx - 1];
        const joinAt = prev.text.length;
        const elements = scene.elements
          .filter((x) => x.id !== elId)
          .map((x) => (x.id !== prev.id ? x : { ...x, text: prev.text + el.text }));
        setTimeout(() => setFocusTarget({ id: prev.id, caret: joinAt, ts: Date.now() }), 0);
        return {
          ...d,
          scenes: d.scenes.map((s) => (s.id === sceneId ? { ...s, elements } : s)),
        };
      }

      /* arrows across elements */
      const ta = e.target;
      if (e.key === "ArrowUp" && ta.selectionStart === 0 && idx > 0) {
        e.preventDefault();
        const prev = scene.elements[idx - 1];
        setTimeout(() => setFocusTarget({ id: prev.id, caret: "end", ts: Date.now() }), 0);
      }
      if (
        e.key === "ArrowDown" &&
        ta.selectionStart === ta.value.length &&
        idx < scene.elements.length - 1
      ) {
        e.preventDefault();
        const nx = scene.elements[idx + 1];
        setTimeout(() => setFocusTarget({ id: nx.id, caret: "start", ts: Date.now() }), 0);
      }
      return d;
    });
  }, []);

  const headingKeyDown = (e, scene) => {
    if (e.key === "Enter") {
      e.preventDefault();
      let first = scene.elements[0];
      if (!first) {
        first = newElement();
        updateScene(scene.id, (s) => ({ ...s, elements: [first] }));
      }
      setTimeout(() => setFocusTarget({ id: first.id, caret: "end", ts: Date.now() }), 0);
    }
  };

  /* ---- characters ---- */
  const scriptChars = useMemo(() => {
    const set = new Set();
    doc.scenes.forEach((sc) =>
      sc.elements.forEach((e) => {
        if (e.type === "character") {
          const n = e.text.toUpperCase().replace(/\(.*?\)/g, "").trim();
          if (n) set.add(n);
        }
      })
    );
    return set;
  }, [doc.scenes]);

  const allChars = useMemo(() => {
    const set = new Set([...scriptChars, ...Object.keys(doc.characters)]);
    return [...set].sort();
  }, [scriptChars, doc.characters]);

  const setCharNote = (name, note) =>
    setDoc((d) => ({ ...d, characters: { ...d.characters, [name]: note } }));

  const removeChar = (name) =>
    setDoc((d) => {
      const characters = { ...d.characters };
      delete characters[name];
      return { ...d, characters };
    });

  /* ---- page count comes from the measured breaks so counter and lines always agree ---- */
  const pageCount = pageBreaks.length + 1;

  /* ---- import / export ---- */
  const exportFDX = () => downloadFile(`${safeName(doc.title)}.fdx`, buildFDX(doc), "application/xml");
  const exportJSON = () =>
    downloadFile(`${safeName(doc.title)}-backup.json`, JSON.stringify(doc, null, 2), "application/json");
  const openImported = (title, scenes) => {
    const newDoc = { ...DEFAULT_DOC, title, scenes };
    persist(currentId, doc);
    const id = uid();
    saveProjectDoc(id, newDoc);
    setLibrary((lib) => {
      const next = [{ id, title, updatedAt: Date.now() }, ...lib];
      saveLibrary(next);
      return next;
    });
    skipNextSave.current = true;
    setCurrentId(id);
    setDoc(newDoc);
  };

  const importFile = (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const name = f.name.toLowerCase();
    const r = new FileReader();
    r.onload = () => {
      const content = r.result;
      try {
        if (name.endsWith(".json")) {
          const d = JSON.parse(content);
          if (d && Array.isArray(d.scenes)) setDoc(d);
          else window.alert("That backup file doesn't look right.");
          return;
        }
        const imported = name.endsWith(".fdx") ? parseFDX(content) : parseScriptText(content);
        const fallbackTitle = f.name.replace(/\.[^.]+$/, "").toUpperCase();
        const title =
          imported.title && imported.title !== "IMPORTED SCRIPT" ? imported.title : fallbackTitle;
        openImported(title, imported.scenes);
      } catch (err) {
        window.alert(err && err.message ? err.message : "Couldn't read that file. Try a .fdx or plain text file.");
      }
    };
    r.readAsText(f);
    e.target.value = "";
  };

  /* multi-line paste: parse into elements/scenes and insert at the cursor's spot */
  const pasteLines = (sceneId, elId, textRaw) =>
    setDoc((d) => {
      let parsed;
      try { parsed = parseScriptText(textRaw).scenes; } catch { return d; }
      if (!parsed || !parsed.length) return d;
      const scenes = [...d.scenes];
      const sIdx = scenes.findIndex((s) => s.id === sceneId);
      if (sIdx === -1) return d;
      const scene = scenes[sIdx];
      const eIdx = scene.elements.findIndex((el) => el.id === elId);
      if (eIdx === -1) return d;
      const first = parsed[0];
      if (!first.heading) {
        // first chunk has no scene heading: weave it into the current scene at the cursor
        const currentEmpty = !scene.elements[eIdx].text.trim();
        const before = currentEmpty ? scene.elements.slice(0, eIdx) : scene.elements.slice(0, eIdx + 1);
        const after = scene.elements.slice(eIdx + 1);
        scenes[sIdx] = { ...scene, elements: [...before, ...first.elements, ...after] };
        parsed.shift();
        if (!scenes[sIdx].elements.length) scenes[sIdx] = { ...scenes[sIdx], elements: [newElement()] };
      }
      if (parsed.length) scenes.splice(sIdx + 1, 0, ...parsed);
      return { ...d, scenes };
    });

  const snippet = (sc) => {
    const el = sc.elements.find((e) => e.text.trim());
    if (!el) return "";
    const t = el.text.trim();
    return t.length > 72 ? t.slice(0, 72) + "\u2026" : t;
  };

  /* ---------------- render ---------------- */
  return (
    <div className={`sw-root${night ? " night" : ""}`}>
      <style>{CSS}</style>

      {/* top bar */}
      <header className="topbar">
        <div className="tb-left">
          <button
            className={`icon-btn${projectsOpen ? " on" : ""}`}
            title="Your scripts"
            onClick={() => setProjectsOpen((v) => !v)}
          >
            <FolderOpen size={16} />
          </button>
          <button
            className={`icon-btn${boardOpen ? " on" : ""}`}
            title="Scene board"
            onClick={() => setBoardOpen((v) => !v)}
          >
            <Clapperboard size={16} />
          </button>
          <input
            className="title-input"
            value={doc.title}
            onChange={(e) => setDoc((d) => ({ ...d, title: e.target.value }))}
            spellCheck={false}
          />
        </div>

        <div className={`theme-strip${doc.theme.trim() ? " filled" : ""}`}>
          <span className="theme-label">Theme</span>
          <input
            className="theme-input"
            value={doc.theme}
            placeholder="What is this story about?"
            onChange={(e) => setDoc((d) => ({ ...d, theme: e.target.value }))}
            spellCheck={false}
          />
        </div>

        <div className="tb-right">
          <span className="page-est">~{pageCount} pp</span>
          <button
            className={`icon-btn${showBreaks ? " on" : ""}`}
            title={showBreaks ? "Hide page break lines" : "Show page break lines"}
            onClick={() => {
              setShowBreaks((v) => {
                try { storage.api.setItem("screenwriter-showbreaks", v ? "0" : "1"); } catch {}
                return !v;
              });
            }}
          >
            <SeparatorHorizontal size={15} />
          </button>
          <span className={`save-dot ${saveState}`} title={
            storage.persistent
              ? (saveState === "saved" ? "Saved" : "Saving...")
              : "Autosave is session-only in this preview"
          }>
            <Circle size={7} fill="currentColor" />
            <span className="save-word">{saveState === "saved" ? "Saved" : "Saving"}</span>
          </span>
          {cloud.connected && (!sessionEmail || cloudStatus === "error") && (
            <span className="sync-warn" title="Cloud sync isn't active. Click the cloud icon to reconnect.">not synced</span>
          )}
          {streak.streak > 0 && (
            <span className="streak-chip" title={`${streak.streak}-day writing streak`}>
              <Flame size={11} />{streak.streak}
            </span>
          )}
          {pomo && (
            <span
              className={`pomo-chip ${pomo.phase}${pomo.running ? "" : " paused"}`}
              title={pomo.running ? "Click to pause" : "Click to resume"}
              onClick={() => setPomo((p) => ({ ...p, running: !p.running }))}
            >
              <Timer size={11} />
              {`${Math.floor(pomo.remaining / 60)}:${String(pomo.remaining % 60).padStart(2, "0")}`}
              <X size={11} className="pomo-x" onClick={(e) => { e.stopPropagation(); setPomo(null); }} />
            </span>
          )}
          <input ref={fileRef} type="file" accept=".json,.fdx,.txt,.fountain" style={{ display: "none" }} onChange={importFile} />
          <button className="export-btn" onClick={exportFDX}>
            <Download size={14} /> FDX
          </button>
          <div className="cloud-wrap">
            <button
              className={`icon-btn${menuOpen ? " on" : ""}`}
              title="More"
              onClick={() => setMenuOpen((v) => !v)}
            >
              <MoreHorizontal size={16} />
            </button>
            {menuOpen && (
              <div className="cloud-panel">
                <button className="menu-item" onClick={() => { setMenuOpen(false); fileRef.current && fileRef.current.click(); }}>
                  <Upload size={14} /> Import script or restore backup
                </button>
                <button className="menu-item" onClick={() => { setMenuOpen(false); exportJSON(); }}>
                  <FileJson size={14} /> Download backup (.json)
                </button>
                <button className="menu-item" onClick={() => { setMenuOpen(false); setTimeout(() => window.print(), 150); }}>
                  <Printer size={14} /> Print / save as PDF
                </button>
                <button className="menu-item" onClick={() => {
                  setNight((v) => {
                    try { storage.api.setItem("screenwriter-night", v ? "0" : "1"); } catch {}
                    return !v;
                  });
                }}>
                  {night ? <Sun size={14} /> : <Moon size={14} />} {night ? "Light mode" : "Night mode"}
                </button>
                {!pomo && (
                  <button className="menu-item" onClick={() => { setPomo({ phase: "work", remaining: 25 * 60, running: true }); setMenuOpen(false); }}>
                    <Timer size={14} /> Focus timer (25 min)
                  </button>
                )}
                <div className="cloud-label" style={{ marginTop: 12 }}>Title page</div>
                <input
                  className="cloud-input"
                  placeholder="Written by (your name)"
                  value={(doc.titlePage && doc.titlePage.byline) || ""}
                  onChange={(e) => setDoc((d) => ({ ...d, titlePage: { ...(d.titlePage || {}), byline: e.target.value } }))}
                  spellCheck={false}
                />
                <input
                  className="cloud-input"
                  style={{ marginTop: 6 }}
                  placeholder="Contact (email, phone)"
                  value={(doc.titlePage && doc.titlePage.contact) || ""}
                  onChange={(e) => setDoc((d) => ({ ...d, titlePage: { ...(d.titlePage || {}), contact: e.target.value } }))}
                  spellCheck={false}
                />
                <div className="cloud-hint">Shows on the printed PDF and in the FDX export.</div>
              </div>
            )}
          </div>
          <div className="cloud-wrap">
            <button
              className={`icon-btn${cloudOpen ? " on" : ""}${cloud.connected && (!sessionEmail || cloudStatus === "error") ? " warn-badge" : ""}`}
              title={cloud.connected && !sessionEmail ? "Not synced. Click to reconnect." : "Cloud sync"}
              onClick={() => { setClientIdDraft(cloud.clientId); setCloudOpen((v) => !v); }}
            >
              {cloud.connected && sessionEmail ? <Cloud size={16} /> : <CloudOff size={16} />}
            </button>
            {cloudOpen && (
              <div className="cloud-panel">
                {!cloud.connected && (
                  <>
                    <div className="cloud-title">Connect Google Drive</div>
                    {!DEFAULT_GOOGLE_CLIENT_ID && (
                      <>
                        <label className="cloud-label">Google client ID</label>
                        <input
                          className="cloud-input"
                          placeholder="xxxx.apps.googleusercontent.com"
                          value={clientIdDraft}
                          onChange={(e) => setClientIdDraft(e.target.value)}
                          spellCheck={false}
                        />
                      </>
                    )}
                    {cloudError && <div className="cloud-error">{cloudError}</div>}
                    <button
                      className="cloud-btn"
                      onClick={() => connectDrive(false)}
                      disabled={cloudStatus === "syncing" || (!DEFAULT_GOOGLE_CLIENT_ID && !clientIdDraft.trim())}
                    >
                      {cloudStatus === "syncing" ? "Connecting..." : "Connect Google Drive"}
                    </button>
                    <div className="cloud-hint">
                      Saves a file to your own Drive, in a "Screenwriter" folder. Nobody else can see it.
                    </div>
                  </>
                )}
                {cloud.connected && sessionEmail && (
                  <>
                    <div className="cloud-title">Cloud sync is on</div>
                    <div className="cloud-meta">{sessionEmail}</div>
                    <div className="cloud-status">
                      {cloudStatus === "syncing" && "Syncing..."}
                      {cloudStatus === "ok" && cloud.lastSyncedAt && `Last synced ${timeAgo(cloud.lastSyncedAt)}`}
                      {cloudStatus === "error" && (cloudError || "Couldn't reach Google Drive")}
                      {cloudStatus === "idle" && cloud.lastSyncedAt && `Last synced ${timeAgo(cloud.lastSyncedAt)}`}
                    </div>
                    <div className="cloud-row">
                      <button className="cloud-btn secondary" onClick={syncNow} disabled={cloudStatus === "syncing"}>
                        Sync now
                      </button>
                      <button className="cloud-btn secondary danger" onClick={disconnectCloud}>
                        Disconnect
                      </button>
                    </div>
                  </>
                )}
                {cloud.connected && !sessionEmail && (
                  <>
                    <div className="cloud-title">Sign in to resume sync</div>
                    <div className="cloud-meta">{cloud.email}</div>
                    {cloudError && <div className="cloud-error">{cloudError}</div>}
                    <button
                      className="cloud-btn"
                      onClick={() => { setClientIdDraft(cloud.clientId); connectDrive(false); }}
                      disabled={cloudStatus === "syncing"}
                    >
                      {cloudStatus === "syncing" ? "Connecting..." : "Reconnect Google Drive"}
                    </button>
                    <button className="cloud-btn secondary danger" onClick={disconnectCloud} style={{ marginTop: 10 }}>
                      Disconnect
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
          <div className="cloud-wrap">
            <button
              className={`icon-btn${verOpen ? " on" : ""}`}
              title="Versions"
              onClick={() => setVerOpen((v) => !v)}
            >
              <History size={16} />
            </button>
            {verOpen && (
              <div className="cloud-panel">
                <div className="cloud-title">Versions</div>
                <button className="cloud-btn" onClick={saveVersion} style={{ marginTop: 0 }}>
                  Save current as version
                </button>
                <div className="ver-list">
                  {(doc.versions || []).slice().reverse().map((v) => (
                    <div className="ver-row" key={v.id}>
                      <div className="ver-info">
                        <div className="ver-name">{v.name}</div>
                        <div className="ver-date">{timeAgo(v.createdAt)}</div>
                      </div>
                      <button className="ghost" title="Restore this version" onClick={() => restoreVersion(v.id)}>
                        <RotateCcw size={12} />
                      </button>
                      <button className="ghost danger" title="Delete this version" onClick={() => deleteVersion(v.id)}>
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                  {!(doc.versions || []).length && (
                    <div className="cloud-hint">No versions yet. Save one before a big rewrite so you can always come back.</div>
                  )}
                </div>
              </div>
            )}
          </div>
          <button
            className={`icon-btn${treatmentOpen ? " on" : ""}`}
            title="Treatment notes"
            onClick={() => setTreatmentOpen((v) => !v)}
          >
            <FileText size={16} />
          </button>
          <button
            className={`icon-btn${charsOpen ? " on" : ""}`}
            title="Character notes"
            onClick={() => setCharsOpen((v) => !v)}
          >
            <Users size={16} />
          </button>
        </div>
      </header>

      <div className="body">
        {/* projects library */}
        {projectsOpen && (
          <aside className="projects">
            <div className="board-head">
              <span>Your scripts</span>
              <span style={{ display: "flex", gap: 6 }}>
                <button className="mini-btn" onClick={newProject}>
                  <Plus size={13} /> New
                </button>
                <button className="ghost" onClick={() => setProjectsOpen(false)}><X size={14} /></button>
              </span>
            </div>
            <div className="projects-list">
              {[...library].sort((a, b) => b.updatedAt - a.updatedAt).map((p) => (
                <div
                  key={p.id}
                  className={`project-card${p.id === currentId ? " active" : ""}`}
                  onClick={() => openProject(p.id)}
                >
                  <div className="project-top">
                    <span className="project-title">{p.title || "UNTITLED"}</span>
                    <span className="project-actions" onClick={(e) => e.stopPropagation()}>
                      <button className="ghost" title="Duplicate" onClick={() => duplicateProject(p.id)}>
                        <Copy size={12} />
                      </button>
                      {library.length > 1 && (
                        <button
                          className="ghost danger"
                          title="Delete"
                          onClick={() => {
                            if (window.confirm(`Delete "${p.title || "UNTITLED"}"? This can't be undone.`)) {
                              deleteProject(p.id);
                            }
                          }}
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </span>
                  </div>
                  <div className="project-meta">
                    {p.id === currentId ? "currently open" : `edited ${timeAgo(p.updatedAt)}`}
                  </div>
                </div>
              ))}
            </div>
            <div className="projects-note">
              Scripts are saved in this browser only. Use the backup icon up top to download a copy you can keep anywhere or restore later.
            </div>
          </aside>
        )}

        {/* scene board */}
        {boardOpen && (
          <aside className={`board${boardFull ? " full" : ""}`}>
            <div className="board-head">
              {selectedScenes.size ? (
                <>
                  <span>{selectedScenes.size} selected</span>
                  <span style={{ display: "flex", gap: 6 }}>
                    <button className="ghost danger" title="Delete selected scenes" onClick={deleteSelectedScenes}>
                      <Trash2 size={13} />
                    </button>
                    <button className="ghost" title="Clear selection" onClick={() => { setSelectedScenes(new Set()); selectAnchor.current = null; }}>
                      <X size={14} />
                    </button>
                  </span>
                </>
              ) : (
                <>
                  <span>
                    Scenes
                    <span className="scene-progress"> {doc.scenes.filter((s) => s.done).length}/{doc.scenes.length}</span>
                  </span>
                  <span style={{ display: "flex", gap: 6 }}>
                    <button className="ghost" title={boardFull ? "Back to sidebar" : "Full-screen planning board"} onClick={() => setBoardFull((v) => !v)}>
                      <Maximize2 size={13} />
                    </button>
                    <button className="mini-btn" onClick={() => addScene()}>
                      <Plus size={13} /> Scene
                    </button>
                  </span>
                </>
              )}
            </div>
            <div className="cards" onDragLeave={() => setOverIdx(null)}>
              {doc.scenes.map((sc, i) => (
                <div key={sc.id}>
                  {sc.act && (
                    <div className="act-row">
                      <Flag size={11} />
                      <input
                        className="act-input"
                        value={sc.act.title}
                        onChange={(e) => setActTitle(sc.id, e.target.value)}
                        spellCheck={false}
                      />
                    </div>
                  )}
                  <div
                    className={`card${dragIdx === i ? " dragging" : ""}${overIdx === i ? " over" : ""}${selectedScenes.has(sc.id) ? " selected" : ""}`}
                    draggable
                    onDragStart={(e) => { setDragIdx(i); e.dataTransfer.effectAllowed = "move"; }}
                    onDragEnd={() => { setDragIdx(null); setOverIdx(null); }}
                    onDragOver={(e) => { e.preventDefault(); setOverIdx(i); }}
                    onDrop={(e) => { e.preventDefault(); moveScene(dragIdx, i); setDragIdx(null); setOverIdx(null); }}
                    onClick={(e) => handleCardClick(e, i, sc)}
                  >
                    <div className="card-top">
                      <button
                        className={`scene-check${sc.done ? " done" : ""}`}
                        title={sc.done ? "Mark not done" : "Mark done"}
                        onClick={(e) => { e.stopPropagation(); updateScene(sc.id, (s) => ({ ...s, done: !s.done })); }}
                      >
                        {sc.done ? <CheckCircle2 size={13} /> : <Circle size={13} />}
                      </button>
                      <span className="card-num">{i + 1}</span>
                      <span className="card-heading">{sc.heading.trim() || "Untitled scene"}</span>
                      <span className="card-actions" onClick={(e) => e.stopPropagation()}>
                        <button className="ghost" title={sc.act ? "Remove act marker" : "Add act marker"} onClick={() => toggleAct(sc.id)}>
                          <Flag size={12} />
                        </button>
                        <button className="ghost danger" title="Delete scene" onClick={() => deleteScene(sc.id)}>
                          <Trash2 size={12} />
                        </button>
                      </span>
                    </div>
                    <input
                      className="card-note"
                      value={sc.synopsis || ""}
                      placeholder={snippet(sc) || "Add a note..."}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => updateScene(sc.id, (s) => ({ ...s, synopsis: e.target.value }))}
                      spellCheck={false}
                    />
                  </div>
                </div>
              ))}
              {/* drop at end */}
              <div
                className={`drop-end${overIdx === doc.scenes.length ? " over" : ""}`}
                onDragOver={(e) => { e.preventDefault(); setOverIdx(doc.scenes.length); }}
                onDrop={(e) => { e.preventDefault(); moveScene(dragIdx, doc.scenes.length); setDragIdx(null); setOverIdx(null); }}
              />
            </div>
          </aside>
        )}

        {/* editor */}
        <main className="editor-scroll">
          <div className="page" ref={pageRef}>
            {(doc.titlePage && (doc.titlePage.byline || doc.titlePage.contact)) ? (
              <div className="print-title-page" aria-hidden="true">
                <div className="ptp-center">
                  <div className="ptp-title">{doc.title.toUpperCase()}</div>
                  {doc.titlePage.byline && (
                    <>
                      <div className="ptp-by">Written by</div>
                      <div className="ptp-byline">{doc.titlePage.byline}</div>
                    </>
                  )}
                </div>
                {doc.titlePage.contact && (
                  <div className="ptp-contact">{doc.titlePage.contact}</div>
                )}
              </div>
            ) : null}
            <span ref={lineProbeRef} className="line-probe" aria-hidden="true">Wg</span>
            {showBreaks && pageBreaks.map((b) => (
              <div key={b.page} className="page-break" style={{ top: b.y }}>
                <span className="page-break-num">{b.page}.</span>
              </div>
            ))}
            {doc.scenes.map((sc, i) => (
              <section
                key={sc.id}
                className="scene"
                ref={(n) => { sceneRefs.current[sc.id] = n; }}
              >
                <div className="heading-row">
                  <span className="scene-num">{i + 1}</span>
                  <input
                    className="heading-input"
                    value={sc.heading}
                    placeholder="INT. LOCATION - DAY"
                    onChange={(e) => updateScene(sc.id, (s) => ({ ...s, heading: e.target.value }))}
                    onKeyDown={(e) => headingKeyDown(e, sc)}
                    spellCheck={false}
                  />
                  <span className="scene-tools">
                    <button
                      className="ghost danger"
                      title="Delete this scene"
                      onClick={() => {
                        if (window.confirm(`Delete scene ${i + 1}${sc.heading.trim() ? ` (${sc.heading.trim()})` : ""}?`)) deleteScene(sc.id);
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </span>
                </div>
                {groupElements(sc.elements).map((g) =>
                  g.kind === "single" ? (
                    <div key={g.el.id} className="single-line-wrap">
                      <Element
                        el={g.el}
                        sceneId={sc.id}
                        focusTarget={focusTarget}
                        focused={focusedEl === g.el.id}
                        onChange={changeElement}
                        onKeyDown={handleKeyDown}
                        onFocus={setFocusedEl}
                        onBlur={() => setFocusedEl(null)}
                        suggestions={allChars}
                        emptySuggestions={(() => {
                          if (g.el.type !== "character") return [];
                          const seen = [];
                          for (let k = g.idx - 1; k >= 0 && seen.length < 4; k--) {
                            const e2 = sc.elements[k];
                            if (e2.type !== "character") continue;
                            const n = e2.text.toUpperCase().replace(/\(.*?\)/g, "").trim();
                            if (n && !seen.includes(n)) seen.push(n);
                          }
                          /* alternating speaker first: the one before the last speaker */
                          return seen.length > 1 ? [seen[1], seen[0], ...seen.slice(2)] : seen;
                        })()}
                        onPasteLines={pasteLines}
                      />
                      {canPairFrom(sc.elements, g.idx) && (
                        <button
                          className="dual-pair-btn"
                          title="Pair with the next character block as dual dialogue"
                          onClick={() => pairDual(sc.id, g.idx)}
                        >
                          <Columns size={11} /> dual
                        </button>
                      )}
                    </div>
                  ) : (
                    <div key={g.pairId} className="dual-row">
                      <button
                        className="dual-unpair-btn"
                        title="Split back into normal dialogue"
                        onClick={() => unpairDual(sc.id, g.pairId)}
                      >
                        <X size={11} />
                      </button>
                      <div className="dual-col">
                        {g.left.map((el) => (
                          <Element
                            key={el.id}
                            el={el}
                            sceneId={sc.id}
                            focusTarget={focusTarget}
                            focused={focusedEl === el.id}
                            onChange={changeElement}
                            onKeyDown={handleKeyDown}
                            onFocus={setFocusedEl}
                            onBlur={() => setFocusedEl(null)}
                            suggestions={allChars}
                            onPasteLines={pasteLines}
                          />
                        ))}
                      </div>
                      <div className="dual-col">
                        {g.right.map((el) => (
                          <Element
                            key={el.id}
                            el={el}
                            sceneId={sc.id}
                            focusTarget={focusTarget}
                            focused={focusedEl === el.id}
                            onChange={changeElement}
                            onKeyDown={handleKeyDown}
                            onFocus={setFocusedEl}
                            onBlur={() => setFocusedEl(null)}
                            suggestions={allChars}
                            onPasteLines={pasteLines}
                          />
                        ))}
                      </div>
                    </div>
                  )
                )}
                <div className="scene-gap">
                  <button className="gap-btn" onClick={() => addScene(i)}>
                    <Plus size={12} /> scene
                  </button>
                </div>
              </section>
            ))}
          </div>
          <div className="hint-bar">
            enter&thinsp;new line &nbsp;&middot;&nbsp; tab&thinsp;change type &nbsp;&middot;&nbsp; drag cards to reorder
          </div>
        </main>

        {/* treatment notepad */}
        {treatmentOpen && (
          <aside className={`treatment${treatmentWide ? " wide" : ""}`}>
            <div className="board-head">
              <span>Treatment</span>
              <span style={{ display: "flex", gap: 6 }}>
                <button className="ghost" title="Bold (select text first)" onMouseDown={(e) => { e.preventDefault(); document.execCommand("bold"); }}>
                  <Bold size={13} />
                </button>
                <button className="ghost" title="Bullet list" onMouseDown={(e) => { e.preventDefault(); document.execCommand("insertUnorderedList"); }}>
                  <List size={14} />
                </button>
                <button className="ghost" title={treatmentWide ? "Narrower" : "Wider"} onClick={() => setTreatmentWide((v) => !v)}>
                  <Maximize2 size={13} />
                </button>
                <button className="ghost" onClick={() => setTreatmentOpen(false)}><X size={14} /></button>
              </span>
            </div>
            <div
              ref={treatmentRef}
              className="treatment-editor"
              contentEditable
              suppressContentEditableWarning
              data-placeholder="Paste or write your treatment here, just for reference while you write."
              onInput={(e) => setDoc((d) => ({ ...d, treatment: e.currentTarget.innerHTML }))}
              spellCheck={true}
            />
          </aside>
        )}

        {/* character notes */}
        {charsOpen && (
          <aside className="chars">
            <div className="board-head">
              <span>Characters</span>
              <span style={{ display: "flex", gap: 6 }}>
                <button className="mini-btn" onClick={() => setNewChar("")}>
                  <Plus size={13} /> Add
                </button>
                <button className="ghost" onClick={() => setCharsOpen(false)}><X size={14} /></button>
              </span>
            </div>
            <div className="chars-list">
              {newChar !== null && (
                <input
                  className="char-new"
                  autoFocus
                  value={newChar}
                  placeholder="NAME, then enter"
                  onChange={(e) => setNewChar(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newChar.trim()) {
                      setCharNote(newChar.trim().toUpperCase(), "");
                      setNewChar(null);
                    }
                    if (e.key === "Escape") setNewChar(null);
                  }}
                  spellCheck={false}
                />
              )}
              {allChars.length === 0 && newChar === null && (
                <div className="empty-note">
                  Characters appear here as you write them, or add one manually.
                </div>
              )}
              {allChars.map((name) => (
                <div className="char-block" key={name}>
                  <div className="char-head">
                    <span className="char-name">{name}</span>
                    {scriptChars.has(name) && <span className="in-script">in script</span>}
                    {!scriptChars.has(name) && (
                      <button className="ghost danger" onClick={() => removeChar(name)}>
                        <Trash2 size={11} />
                      </button>
                    )}
                  </div>
                  <textarea
                    className="char-note"
                    rows={3}
                    placeholder="Notes: want, wound, voice..."
                    value={doc.characters[name] || ""}
                    onChange={(e) => setCharNote(name, e.target.value)}
                    spellCheck={false}
                  />
                </div>
              ))}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

/* ---------------- styles ---------------- */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Jost:wght@400;500;600;700&family=Courier+Prime:ital,wght@0,400;0,700;1,400&display=swap');

.sw-root {
  --bg: #EEF0EF;
  --panel: #FFFFFF;
  --panel2: #F4F5F4;
  --line: #E1E3E1;
  --text: #1C1F1E;
  --dim: #6B716F;
  --faint: #A2A8A5;
  --accent: #2C4A73;
  --accent2: #A9793C;
  --paper: #FEFEFC;
  --ink: #1D1D1B;
  --ink-dim: #A9A79E;

  position: fixed; inset: 0;
  background: var(--bg);
  color: var(--text);
  font-family: 'Jost', 'Century Gothic', system-ui, sans-serif;
  display: flex; flex-direction: column;
  overflow: hidden;
}
.sw-root * { box-sizing: border-box; }
.sw-root button, .sw-root input, .sw-root textarea { font-family: inherit; }
.sw-root button { cursor: pointer; }
@media (prefers-reduced-motion: reduce) { .sw-root * { transition: none !important; } }

/* ---- top bar ---- */
.topbar {
  height: 52px; flex: 0 0 52px;
  display: grid; grid-template-columns: 1fr minmax(160px, 400px) 1fr;
  align-items: center;
  padding: 0 14px; gap: 12px;
  background: var(--panel);
  border-bottom: 1px solid var(--line);
  position: relative; z-index: 5;
}
.tb-left, .tb-right { display: flex; align-items: center; gap: 6px; min-width: 0; }
.tb-left { justify-self: start; }
.tb-right { justify-self: end; }
.title-input {
  background: transparent; border: none; outline: none;
  color: var(--text);
  font-family: 'Jost', sans-serif;
  font-size: 12px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase;
  width: 180px; padding: 6px 4px; border-radius: 4px;
}
.title-input:focus { background: var(--panel2); }

.theme-strip {
  display: flex; align-items: center; gap: 10px;
  width: 100%;
  padding: 5px 14px;
  background: var(--panel2);
  border: 1px solid var(--line);
  border-radius: 999px;
  transition: background .2s, border-color .2s, box-shadow .2s;
}
.theme-strip.filled {
  background: var(--panel);
  border-color: var(--accent);
  box-shadow: 0 1px 3px rgba(44,74,115,.10);
}
.theme-label {
  font-family: 'Jost', sans-serif;
  font-size: 9px; font-weight: 600; letter-spacing: 0.22em; text-transform: uppercase;
  color: var(--accent); flex: 0 0 auto;
}
.theme-input {
  background: transparent; border: none; outline: none; width: 100%;
  color: var(--text);
  font-family: 'Courier Prime', monospace; font-style: italic; font-weight: 400; font-size: 13px;
  transition: font-weight .15s, font-style .15s, letter-spacing .15s;
}
.theme-strip.filled .theme-input {
  font-style: normal; font-weight: 700; font-size: 13.5px; letter-spacing: 0.01em;
}
.theme-input::placeholder { color: var(--faint); font-style: italic; }

.icon-btn {
  display: flex; align-items: center; justify-content: center;
  width: 30px; height: 30px; border-radius: 6px;
  background: transparent; border: 1px solid transparent; color: var(--dim);
  transition: all .15s;
}
.icon-btn:hover { color: var(--text); background: var(--panel2); }
.icon-btn.on { color: var(--accent); border-color: var(--line); background: var(--panel2); }
.icon-btn:focus-visible, .export-btn:focus-visible, .mini-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }

.export-btn {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 12px; border-radius: 6px; border: none;
  background: var(--accent); color: #FFFFFF;
  font-size: 12px; font-weight: 600; letter-spacing: 0.02em;
}
.export-btn:hover { filter: brightness(1.08); }

.page-est {
  font-family: 'Jost', sans-serif; font-size: 10px; color: var(--faint);
}
.save-dot {
  display: flex; align-items: center; gap: 5px;
  font-family: 'Jost', sans-serif; font-size: 10px; letter-spacing: 0.06em;
  color: var(--faint);
}
.save-dot.saved svg { color: #3E7A52; }
.save-dot.saving svg { color: var(--accent); }

/* ---- layout ---- */
.body { flex: 1; display: flex; min-height: 0; }

/* ---- board ---- */
.board {
  width: 264px; flex: 0 0 264px;
  background: var(--panel);
  border-right: 1px solid var(--line);
  display: flex; flex-direction: column; min-height: 0;
}
.board-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 14px 8px;
  font-family: 'Jost', sans-serif;
  font-size: 10px; font-weight: 600; letter-spacing: 0.2em; text-transform: uppercase;
  color: var(--dim);
}
.mini-btn {
  display: flex; align-items: center; gap: 4px;
  background: transparent; border: 1px solid var(--line); border-radius: 5px;
  color: var(--dim); font-size: 11px; padding: 3px 8px;
  transition: all .15s;
}
.mini-btn:hover { color: var(--text); border-color: var(--faint); }

.cards { flex: 1; overflow-y: auto; padding: 2px 10px 24px; }
.act-row {
  display: flex; align-items: center; gap: 6px;
  color: var(--accent);
  margin: 14px 4px 6px;
}
.act-input {
  background: transparent; border: none; outline: none;
  color: var(--accent);
  font-family: 'Jost', sans-serif;
  font-size: 10px; font-weight: 600; letter-spacing: 0.24em; text-transform: uppercase;
  width: 100%;
}
.card {
  background: var(--panel2);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 9px 10px 8px;
  margin-bottom: 8px;
  cursor: grab;
  transition: border-color .15s, opacity .15s;
}
.card:hover { border-color: var(--faint); }
.card.dragging { opacity: 0.35; }
.card.over { border-top: 2px solid var(--accent); }
.drop-end { height: 28px; border-radius: 6px; }
.drop-end.over { border-top: 2px solid var(--accent); }

.card-top { display: flex; align-items: baseline; gap: 8px; }
.card-num {
  font-family: 'Jost', sans-serif; font-size: 9px; color: var(--faint); flex: 0 0 auto;
}
.card-heading {
  font-family: 'Jost', sans-serif; font-size: 11px; font-weight: 500;
  text-transform: uppercase; letter-spacing: 0.03em;
  color: var(--text);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;
}
.card-actions { display: none; gap: 2px; flex: 0 0 auto; }
.card:hover .card-actions { display: flex; }
.ghost {
  background: transparent; border: none; color: var(--faint);
  padding: 2px; border-radius: 4px; display: flex; align-items: center;
}
.ghost:hover { color: var(--text); }
.ghost.danger:hover { color: #D6756B; }
.card-snippet {
  margin-top: 5px; font-size: 11px; color: var(--dim); line-height: 1.45;
}

/* ---- editor ---- */
.editor-scroll { flex: 1; overflow-y: auto; min-width: 0; position: relative; }
.page {
  position: relative;
  background: var(--paper);
  color: var(--ink);
  width: min(816px, calc(100% - 48px));
  margin: 28px auto 80px;
  padding: 0.9in 1in 1.2in 1.5in;
  border-radius: 3px;
  box-shadow: 0 1px 2px rgba(20,20,15,.08), 0 12px 32px rgba(20,20,15,.10);
  font-family: 'Courier Prime', monospace;
  font-size: 15px;
  line-height: 1.15;
  min-height: 70vh;
}
.line-probe {
  position: absolute; top: 0; left: 0; visibility: hidden; pointer-events: none;
  font-family: 'Courier Prime', monospace; font-size: 15px; line-height: 1.15;
}
.page-break {
  position: absolute; left: 0; right: 0; height: 0;
  border-top: 1px dashed #CFCDC2;
  pointer-events: none;
}
.page-break-num {
  position: absolute; top: -7px; right: 0;
  background: var(--paper);
  padding-left: 8px;
  font-family: 'Courier Prime', monospace; font-size: 11px; color: #9C9A90;
}

.scene { position: relative; }
.act-editor {
  display: block; width: 100%;
  background: transparent; border: none; outline: none;
  text-align: center;
  font-family: 'Jost', sans-serif;
  font-size: 11px; font-weight: 600; letter-spacing: 0.3em; text-transform: uppercase;
  color: var(--accent2);
  margin: 34px 0 10px;
}
.heading-row { display: flex; align-items: baseline; margin-top: 30px; position: relative; }
.scene-num {
  position: absolute; left: -0.7in; width: 0.45in; text-align: right;
  font-size: 11px; color: var(--ink-dim);
  font-family: 'Jost', sans-serif;
}
.heading-input {
  width: 100%;
  background: transparent; border: none; outline: none;
  font-family: 'Courier Prime', monospace; font-size: 15px; font-weight: 700;
  text-transform: uppercase; color: var(--ink);
  padding: 2px 0;
}
.heading-input::placeholder { color: var(--ink-dim); font-weight: 400; }

.el-row { position: relative; }
.el-row textarea {
  display: block; width: 100%;
  background: transparent; border: none; outline: none; resize: none;
  font: inherit; color: var(--ink);
  padding: 1px 0; overflow: hidden;
}
.el-row textarea::placeholder { color: #C6C4BA; }

.el-action { margin-top: 14px; }
.el-character { margin-top: 14px; }
.el-character textarea { margin-left: 2.2in; width: calc(100% - 2.2in); text-transform: uppercase; }
.el-dialogue { margin-top: 1px; }
.el-dialogue textarea { margin-left: 1in; width: 3.5in; max-width: calc(100% - 1in); }
.el-parenthetical { margin-top: 1px; }
.el-parenthetical textarea { margin-left: 1.6in; width: 2.4in; max-width: calc(100% - 1.6in); color: #4A4A46; }
.el-transition { margin-top: 14px; }
.el-transition textarea { text-align: right; text-transform: uppercase; }

.el-type-label {
  display: none;
  position: absolute; left: -1.32in; top: 3px; width: 1.05in;
  text-align: right;
  font-family: 'Jost', sans-serif;
  font-size: 8px; letter-spacing: 0.14em;
  color: #B9B7AC;
  user-select: none; pointer-events: none;
}
.el-row.focused .el-type-label { display: block; }

/* ---- character autocomplete ---- */
.ac-menu {
  position: absolute; z-index: 10; top: 100%; left: 2.2in;
  min-width: 2.2in;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 6px;
  box-shadow: 0 6px 18px rgba(20,20,15,.12);
  overflow: hidden;
}
.dual-col .ac-menu { left: 0; }
.ac-item {
  padding: 5px 10px;
  font-family: 'Jost', sans-serif; font-size: 11px; letter-spacing: 0.05em;
  color: var(--text);
  cursor: pointer;
}
.ac-item.active, .ac-item:hover { background: var(--panel2); color: var(--accent); }

/* ---- dual dialogue ---- */
.single-line-wrap { position: relative; }
.dual-pair-btn {
  display: none; align-items: center; gap: 4px;
  position: absolute; right: -0.05in; top: -2px;
  background: var(--panel); border: 1px solid var(--line); border-radius: 5px;
  padding: 2px 7px;
  font-family: 'Jost', sans-serif; font-size: 9px; letter-spacing: 0.06em; text-transform: uppercase;
  color: var(--accent);
}
.single-line-wrap:hover .dual-pair-btn { display: flex; }
.dual-row {
  position: relative;
  display: flex; gap: 0.35in;
  margin-top: 14px;
}
.dual-col { flex: 1 1 0; min-width: 0; }
.dual-col .el-character,
.dual-col .el-action,
.dual-col .el-transition { margin-top: 0; }
.dual-col .el-row + .el-row { margin-top: 1px; }
.dual-col .el-character textarea { margin-left: 0; width: 100%; }
.dual-col .el-dialogue textarea { margin-left: 0; width: 100%; max-width: 100%; }
.dual-col .el-parenthetical textarea { margin-left: 0.25in; width: calc(100% - 0.25in); max-width: none; }
.dual-col .el-type-label { display: none !important; }
.dual-unpair-btn {
  display: none; align-items: center; justify-content: center;
  position: absolute; left: -0.35in; top: 2px; width: 16px; height: 16px;
  background: var(--panel); border: 1px solid var(--line); border-radius: 4px;
  color: var(--faint);
}
.dual-row:hover .dual-unpair-btn { display: flex; }
.dual-unpair-btn:hover { color: #B4453B; border-color: #B4453B; }

.scene-gap { height: 20px; display: flex; align-items: center; justify-content: center; }
.gap-btn {
  display: none; align-items: center; gap: 4px;
  background: transparent; border: none;
  color: #B9B7AC;
  font-family: 'Jost', sans-serif; font-size: 9px; letter-spacing: 0.16em; text-transform: uppercase;
}
.scene-gap:hover .gap-btn { display: flex; }
.gap-btn:hover { color: #6d6b62; }

.hint-bar {
  position: sticky; bottom: 0; width: 100%;
  text-align: center; padding: 8px 0 10px;
  font-family: 'Jost', sans-serif; font-size: 9px; letter-spacing: 0.1em;
  color: var(--faint);
  background: linear-gradient(transparent, var(--bg) 55%);
  pointer-events: none;
}

/* ---- projects panel ---- */
.projects {
  width: 264px; flex: 0 0 264px;
  background: var(--panel);
  border-right: 1px solid var(--line);
  display: flex; flex-direction: column; min-height: 0;
}
.projects-list { flex: 1; overflow-y: auto; padding: 2px 10px 12px; }
.project-card {
  background: var(--panel2);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 9px 10px 8px;
  margin-bottom: 8px;
  cursor: pointer;
  transition: border-color .15s;
}
.project-card:hover { border-color: var(--faint); }
.project-card.active { border-color: var(--accent); }
.project-top { display: flex; align-items: center; gap: 8px; }
.project-title {
  flex: 1; font-size: 13px; font-weight: 500;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--text);
}
.project-actions { display: none; gap: 2px; flex: 0 0 auto; }
.project-card:hover .project-actions { display: flex; }
.project-meta {
  margin-top: 4px; font-size: 10px; letter-spacing: 0.04em; text-transform: uppercase;
  color: var(--faint);
}
.project-card.active .project-meta { color: var(--accent); }
.projects-note {
  padding: 10px 14px 16px; font-size: 11px; line-height: 1.5; color: var(--faint);
  border-top: 1px solid var(--line);
}

/* ---- cloud sync popover ---- */
.cloud-wrap { position: relative; }
.cloud-panel {
  position: absolute; top: 38px; right: 0; z-index: 20;
  width: 280px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 10px;
  box-shadow: 0 10px 30px rgba(20,20,15,.14);
  padding: 14px;
}
.cloud-title { font-size: 12px; font-weight: 600; color: var(--text); margin-bottom: 8px; }
.cloud-label {
  display: block; font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--faint); margin: 8px 0 3px;
}
.cloud-input {
  width: 100%; background: var(--panel2); border: 1px solid var(--line); border-radius: 6px;
  padding: 7px 9px; font-size: 12px; color: var(--text); outline: none;
}
.cloud-input:focus { border-color: var(--faint); }
.cloud-error { font-size: 11px; color: #B4453B; margin-top: 8px; line-height: 1.4; }
.cloud-google-btn { margin-top: 10px; display: flex; justify-content: center; }
.cloud-hint { font-size: 11px; color: var(--faint); text-align: center; padding: 6px 0; }
.cloud-meta {
  font-size: 11px; color: var(--dim); word-break: break-all; margin-bottom: 6px;
}
.cloud-status { font-size: 11px; color: var(--faint); margin-bottom: 10px; }
.cloud-btn {
  width: 100%; margin-top: 10px;
  background: var(--accent); color: #FFFFFF; border: none; border-radius: 6px;
  padding: 8px; font-size: 12px; font-weight: 600;
}
.cloud-btn:disabled { opacity: 0.6; }
.cloud-row { display: flex; gap: 8px; }
.cloud-row .cloud-btn { margin-top: 0; }
.cloud-btn.secondary {
  background: var(--panel2); color: var(--text); border: 1px solid var(--line);
}
.cloud-btn.secondary.danger:hover { color: #B4453B; border-color: #B4453B; }

/* ---- treatment notepad ---- */
.treatment {
  width: 320px; flex: 0 0 320px;
  background: var(--panel);
  border-left: 1px solid var(--line);
  display: flex; flex-direction: column; min-height: 0;
}
.treatment.wide { width: 560px; flex: 0 0 560px; }
.treatment-editor {
  flex: 1; overflow-y: auto; outline: none;
  color: var(--text);
  padding: 4px 16px 16px;
  font-family: 'Jost', sans-serif; font-size: 13px; line-height: 1.6;
}
.treatment-editor:empty::before {
  content: attr(data-placeholder);
  color: var(--faint); font-style: italic;
}
.treatment-editor ul { padding-left: 20px; margin: 6px 0; }
.treatment-editor b, .treatment-editor strong { font-weight: 700; }

/* ---- scene card note ---- */
.card-note {
  display: block; width: 100%; margin-top: 5px;
  background: transparent; border: none; outline: none;
  font-family: 'Jost', sans-serif; font-size: 11px; color: var(--dim); line-height: 1.45;
}
.card-note::placeholder { color: var(--faint); }
.card.selected { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent) inset; }

/* ---- headingish action line (about to become a scene on Enter) ---- */
.el-action.headingish textarea { text-transform: uppercase; font-weight: 700; }

/* ---- version list ---- */
.ver-list { margin-top: 10px; max-height: 240px; overflow-y: auto; }
.ver-row { display: flex; align-items: center; gap: 6px; padding: 6px 2px; border-top: 1px solid var(--line); }
.ver-info { flex: 1; min-width: 0; }
.ver-name { font-size: 12px; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ver-date { font-size: 10px; color: var(--faint); }

/* ---- scene done checkbox + progress ---- */
.scene-check {
  display: flex; align-items: center;
  background: transparent; border: none; padding: 0;
  color: var(--faint); flex: 0 0 auto;
}
.scene-check:hover { color: var(--dim); }
.scene-check.done { color: #3E7A52; }
.card .card-heading { transition: color .15s; }
.card:has(.scene-check.done) .card-heading { color: var(--faint); }
.scene-progress { color: var(--accent); margin-left: 4px; }

/* ---- full-screen planning board ---- */
.board.full {
  position: absolute; z-index: 6; inset: 0; top: 0;
  width: 100%; flex-basis: 100%;
  border-right: none;
}
.board.full .cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 10px; align-content: start;
  padding: 6px 18px 40px;
}
.board.full .cards > div { display: contents; }
.board.full .act-row { grid-column: 1 / -1; margin: 10px 4px 0; }
.board.full .card { margin-bottom: 0; }
.board.full .drop-end { grid-column: 1 / -1; }

/* ---- streak chip ---- */
.streak-chip {
  display: flex; align-items: center; gap: 3px;
  font-family: 'Jost', sans-serif; font-size: 11px; font-weight: 600;
  color: #C46A2B;
}

/* ---- scene tools in the editor ---- */
.scene-tools { display: none; align-items: center; margin-left: 8px; flex: 0 0 auto; }
.heading-row:hover .scene-tools { display: flex; }

/* ---- sync warning ---- */
.sync-warn {
  font-family: 'Jost', sans-serif; font-size: 10px; font-weight: 600;
  letter-spacing: 0.08em; text-transform: uppercase;
  color: #B4453B;
}
.icon-btn.warn-badge { position: relative; }
.icon-btn.warn-badge::after {
  content: ""; position: absolute; top: 4px; right: 4px;
  width: 6px; height: 6px; border-radius: 50%;
  background: #B4453B;
}

/* ---- pomodoro chip ---- */
.pomo-chip {
  display: flex; align-items: center; gap: 5px;
  padding: 4px 9px; border-radius: 999px;
  font-family: 'Jost', sans-serif; font-size: 11px; font-weight: 600; letter-spacing: 0.04em;
  cursor: pointer; user-select: none;
}
.pomo-chip.work { background: rgba(44,74,115,.1); color: var(--accent); border: 1px solid rgba(44,74,115,.3); }
.pomo-chip.break { background: rgba(62,122,82,.1); color: #3E7A52; border: 1px solid rgba(62,122,82,.3); }
.pomo-chip.paused { opacity: 0.55; }
.pomo-x { opacity: 0.6; }
.pomo-x:hover { opacity: 1; }

/* ---- overflow menu ---- */
.menu-item {
  display: flex; align-items: center; gap: 9px;
  width: 100%; padding: 8px 9px;
  background: transparent; border: none; border-radius: 6px;
  font-size: 12px; color: var(--text); text-align: left;
}
.menu-item:hover { background: var(--panel2); }

/* ---- night mode ---- */
.sw-root.night {
  --bg: #141519;
  --panel: #1B1D23;
  --panel2: #22252C;
  --line: #2B2E36;
  --text: #E8E8E3;
  --dim: #8B8F99;
  --faint: #5A5E68;
  --accent: #7FA3D4;
  --accent2: #C9A25E;
  --paper: #1D1E22;
  --ink: #DDDDD6;
  --ink-dim: #5F605C;
}
.sw-root.night .page { box-shadow: 0 1px 2px rgba(0,0,0,.5), 0 12px 32px rgba(0,0,0,.4); }
.sw-root.night .el-row textarea::placeholder { color: #4A4B50; }
.sw-root.night .el-parenthetical textarea { color: #96968E; }
.sw-root.night .el-type-label { color: #55565C; }
.sw-root.night .page-break { border-top-color: #35363C; }
.sw-root.night .page-break-num { color: #6E6F75; }
.sw-root.night .gap-btn { color: #55565C; }
.sw-root.night .gap-btn:hover { color: #8B8F99; }
.sw-root.night .export-btn { color: #10131A; }
.sw-root.night .cloud-btn { color: #10131A; }
.sw-root.night .theme-strip.filled { box-shadow: 0 1px 3px rgba(0,0,0,.3); }

/* ---- print / save as PDF ---- */
.print-title-page { display: none; }
@media print {
  .topbar, .board, .projects, .chars, .treatment, .hint-bar, .page-break,
  .scene-gap, .dual-pair-btn, .dual-unpair-btn, .scene-tools, .el-type-label, .ac-menu { display: none !important; }
  .sw-root { position: static; overflow: visible; background: #fff; }
  .body { display: block; }
  .editor-scroll { overflow: visible; }
  .page {
    box-shadow: none; border-radius: 0;
    width: 100%; margin: 0;
    /* zero @page margins hide the browser's URL/timestamp header and footer;
       real screenplay margins come from this padding instead */
    padding: 1in 1in 1in 1.5in !important;
    min-height: 0;
    background: #fff; color: #000;
  }
  .print-title-page {
    display: flex !important; flex-direction: column;
    height: 8.6in; page-break-after: always;
    font-family: 'Courier Prime', monospace; color: #000;
  }
  .ptp-center { margin: auto; text-align: center; }
  .ptp-title { font-size: 15px; font-weight: 700; letter-spacing: 0.05em; }
  .ptp-by { margin-top: 28px; font-size: 14px; }
  .ptp-byline { margin-top: 10px; font-size: 14px; }
  .ptp-contact { font-size: 12px; white-space: pre-line; }
  .heading-input, .el-row textarea { color: #000; }
  @page { margin: 0; size: letter; }
}

/* ---- characters panel ---- */
.chars {
  width: 300px; flex: 0 0 300px;
  background: var(--panel);
  border-left: 1px solid var(--line);
  display: flex; flex-direction: column; min-height: 0;
}
.chars-list { flex: 1; overflow-y: auto; padding: 4px 14px 24px; }
.char-new {
  width: 100%; margin-bottom: 10px;
  background: var(--panel2); border: 1px solid var(--line); border-radius: 6px;
  color: var(--text); outline: none;
  font-family: 'Jost', sans-serif; font-size: 11px; text-transform: uppercase;
  padding: 7px 9px;
}
.char-block { margin-bottom: 14px; }
.char-head { display: flex; align-items: center; gap: 8px; margin-bottom: 5px; }
.char-name {
  font-family: 'Jost', sans-serif; font-size: 11px; font-weight: 600;
  letter-spacing: 0.06em; color: var(--text); flex: 1;
}
.in-script {
  font-family: 'Jost', sans-serif; font-size: 8px; letter-spacing: 0.14em;
  text-transform: uppercase; color: var(--accent);
  border: 1px solid rgba(44,74,115,.3); border-radius: 999px; padding: 2px 7px;
}
.char-note {
  width: 100%; resize: vertical;
  background: var(--panel2); border: 1px solid var(--line); border-radius: 6px;
  color: var(--text); outline: none;
  font-family: 'Jost', sans-serif; font-size: 12px; line-height: 1.5;
  padding: 8px 9px;
}
.char-note:focus { border-color: var(--faint); }
.empty-note { font-size: 12px; color: var(--faint); line-height: 1.5; padding: 4px 2px; }

/* ---- scrollbars ---- */
.sw-root ::-webkit-scrollbar { width: 10px; }
.sw-root ::-webkit-scrollbar-thumb { background: var(--line); border-radius: 5px; border: 2px solid var(--panel); }
.editor-scroll::-webkit-scrollbar-thumb { border-color: var(--bg); }

/* ---- responsive ---- */
@media (max-width: 900px) {
  .page { padding: 40px 28px 80px 40px; width: calc(100% - 24px); }
  .scene-num, .el-type-label { display: none !important; }
  .el-character textarea { margin-left: 26%; width: 70%; }
  .el-dialogue textarea { margin-left: 13%; width: 68%; }
  .el-parenthetical textarea { margin-left: 20%; width: 50%; }
  .board, .projects { position: absolute; left: 0; z-index: 4; top: var(--topbar-h, 52px); bottom: 0; box-shadow: 12px 0 24px rgba(20,20,15,.10); }
  .chars, .treatment { position: absolute; right: 0; z-index: 4; top: var(--topbar-h, 52px); bottom: 0; box-shadow: -12px 0 24px rgba(20,20,15,.10); }
  .treatment.wide { width: 100%; flex-basis: 100%; }
}

@media (max-width: 700px) {
  .sw-root { --topbar-h: 92px; }
  .topbar {
    display: flex; flex-wrap: wrap;
    height: auto; min-height: 92px;
    padding: 6px 10px; row-gap: 4px; column-gap: 8px;
  }
  .tb-left { flex: 1; min-width: 0; }
  .tb-right { flex: 0 0 auto; margin-left: auto; }
  .theme-strip { order: 3; width: 100%; }
  .title-input { flex: 1; width: auto; min-width: 50px; font-size: 11px; }
  .save-word, .streak-chip { display: none; }
  .icon-btn { width: 28px; height: 28px; }
  .export-btn { padding: 5px 9px; font-size: 11px; }
  .page-est, .sync-warn { display: none; }
  .cloud-panel { position: fixed; left: 10px; right: 10px; top: var(--topbar-h, 92px); width: auto; }
}
`;
