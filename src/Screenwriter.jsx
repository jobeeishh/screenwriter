import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  Download, Plus, Users, X, Trash2, Flag, FileJson, Upload,
  Clapperboard, ChevronRight, Circle, FolderOpen, Copy, Cloud, CloudOff, Columns, FileText
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
  characters: {},
  scenes: [newScene()],
};

function escXML(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildFDX(doc) {
  const paras = [];
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
    if (sc.act && sc.act.title.trim()) P("Action", sc.act.title.toUpperCase(), true);
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
      <Paragraph Alignment="Center"><Text>${escXML(doc.title.toUpperCase())}</Text></Paragraph>
    </Content>
  </TitlePage>
</FinalDraft>`;
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
function Element({ el, sceneId, focusTarget, onChange, onKeyDown, onFocus, onBlur, focused }) {
  const ref = useRef(null);

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
      const pos = focusTarget.caret === "start" ? 0 : ta.value.length;
      ta.setSelectionRange(pos, pos);
    }
  }, [focusTarget, el.id]);

  return (
    <div className={`el-row el-${el.type}${focused ? " focused" : ""}`}>
      <span className="el-type-label">{TYPE_LABEL[el.type]}</span>
      <textarea
        ref={ref}
        rows={1}
        value={el.text}
        placeholder={PLACEHOLDER[el.type]}
        onChange={(e) => { onChange(sceneId, el.id, e.target.value); }}
        onKeyDown={(e) => onKeyDown(e, sceneId, el.id)}
        onFocus={() => onFocus(el.id)}
        onBlur={onBlur}
        spellCheck={false}
      />
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
  const [charsOpen, setCharsOpen] = useState(false);
  const [treatmentOpen, setTreatmentOpen] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [focusTarget, setFocusTarget] = useState(null);
  const [focusedEl, setFocusedEl] = useState(null);
  const [dragIdx, setDragIdx] = useState(null);
  const [overIdx, setOverIdx] = useState(null);
  const [newChar, setNewChar] = useState(null); // null = closed, "" = open input
  const [pageBreaks, setPageBreaks] = useState([]);
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
      ".heading-row, .act-editor, .el-action, .el-character, .el-transition"
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

  const downloadFile = async (fileId) => {
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
    const data = await downloadFile(fileId);
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

  const connectDrive = async () => {
    const clientId = clientIdDraft.trim();
    if (!clientId) { setCloudError("Add your Google client ID first."); return; }
    setCloudError("");
    try {
      await loadGoogleScript();
    } catch (err) {
      setCloudError(err.message);
      return;
    }
    if (!tokenClientRef.current || tokenClientRef.current.clientId !== clientId) {
      const client = window.google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email",
        callback: async (resp) => {
          if (resp.error) {
            setCloudStatus("error");
            setCloudError(resp.error === "access_denied" ? "Sign-in was cancelled." : resp.error);
            return;
          }
          accessTokenRef.current = resp.access_token;
          setCloudStatus("syncing");
          try {
            const infoRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
              headers: { Authorization: `Bearer ${resp.access_token}` },
            });
            const info = await infoRes.json();
            setSessionEmail(info.email || "signed in");

            const wasConnected = cloud.connected;
            const { remote, folderId, fileId } = await pullFromCloud(cloud);
            let finalFileId = fileId;
            if (remote && Object.keys(remote.docs).length && !wasConnected) {
              const when = timeAgo(remote.updatedAt);
              const useRemote = window.confirm(
                `Found an existing Drive backup with ${remote.library.length} script(s), last saved ${when}.\n\nOK = load that backup here (replaces what's open now)\nCancel = keep what's on this device and upload it to Drive`
              );
              if (useRemote) applySnapshot(remote);
              else finalFileId = (await pushToCloud({ ...cloud, folderId, fileId })).fileId;
            } else if (remote) {
              applySnapshot(remote);
            } else {
              finalFileId = (await pushToCloud({ ...cloud, folderId, fileId })).fileId;
            }
            persistCloud({
              clientId, connected: true, lastSyncedAt: Date.now(),
              email: info.email || "", folderId, fileId: finalFileId,
            });
            setCloudStatus("ok");
          } catch (err) {
            setCloudStatus("error");
            setCloudError(err.message || "Couldn't reach Google Drive.");
          }
        },
      });
      client.clientId = clientId;
      tokenClientRef.current = client;
    }
    tokenClientRef.current.requestAccessToken({ prompt: sessionEmail ? "" : "consent" });
  };

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

  /* ---- autosave ---- */
  useEffect(() => {
    if (skipNextSave.current) { skipNextSave.current = false; return; }
    setSaveState("saving");
    const t = setTimeout(() => {
      persist(currentId, doc);
      setSaveState("saved");
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

  const toggleAct = (sceneId) =>
    updateScene(sceneId, (s) =>
      s.act ? { ...s, act: null } : { ...s, act: { id: uid(), title: "ACT " } }
    );

  const setActTitle = (sceneId, title) =>
    updateScene(sceneId, (s) => ({ ...s, act: { ...s.act, title } }));

  const moveScene = (from, to) => {
    if (from === to || from === null || to === null) return;
    setDoc((d) => {
      const scenes = [...d.scenes];
      const [sc] = scenes.splice(from, 1);
      scenes.splice(to > from ? to - 1 : to, 0, sc);
      return { ...d, scenes };
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

      /* enter: new element with smart next type */
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const next = newElement(NEXT_TYPE[el.type] || "action");
        if (el.pairId) { next.pairId = el.pairId; next.pairSide = el.pairSide; }
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

  /* ---- page estimate ---- */
  const pageEst = useMemo(() => {
    let lines = 0;
    doc.scenes.forEach((sc) => {
      if (sc.act) lines += 2;
      if (sc.heading.trim()) lines += 2;
      sc.elements.forEach((e) => {
        const len = e.text.length;
        if (!len) { lines += 1; return; }
        const w = e.type === "dialogue" ? 35 : e.type === "parenthetical" ? 30 : 58;
        lines += Math.ceil(len / w) + (e.type === "dialogue" || e.type === "parenthetical" ? 0 : 1);
      });
    });
    return Math.max(1, Math.round(lines / 55));
  }, [doc.scenes]);

  /* ---- import / export ---- */
  const exportFDX = () => downloadFile(`${safeName(doc.title)}.fdx`, buildFDX(doc), "application/xml");
  const exportJSON = () =>
    downloadFile(`${safeName(doc.title)}-backup.json`, JSON.stringify(doc, null, 2), "application/json");
  const importJSON = (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const d = JSON.parse(r.result);
        if (d && Array.isArray(d.scenes)) setDoc(d);
      } catch {}
    };
    r.readAsText(f);
    e.target.value = "";
  };

  const snippet = (sc) => {
    const el = sc.elements.find((e) => e.text.trim());
    if (!el) return "";
    const t = el.text.trim();
    return t.length > 72 ? t.slice(0, 72) + "\u2026" : t;
  };

  /* ---------------- render ---------------- */
  return (
    <div className="sw-root">
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
          <span className="page-est">~{pageEst} pp</span>
          <span className={`save-dot ${saveState}`} title={
            storage.persistent
              ? (saveState === "saved" ? "Saved" : "Saving...")
              : "Autosave is session-only in this preview"
          }>
            <Circle size={7} fill="currentColor" />
            {saveState === "saved" ? "Saved" : "Saving"}
          </span>
          <button className="icon-btn" title="Backup (.json)" onClick={exportJSON}>
            <FileJson size={15} />
          </button>
          <button className="icon-btn" title="Restore backup" onClick={() => fileRef.current && fileRef.current.click()}>
            <Upload size={15} />
          </button>
          <input ref={fileRef} type="file" accept=".json" style={{ display: "none" }} onChange={importJSON} />
          <button className="export-btn" onClick={exportFDX}>
            <Download size={14} /> FDX
          </button>
          <div className="cloud-wrap">
            <button
              className={`icon-btn${cloudOpen ? " on" : ""}`}
              title="Cloud sync"
              onClick={() => { setClientIdDraft(cloud.clientId); setCloudOpen((v) => !v); }}
            >
              {cloud.connected && sessionEmail ? <Cloud size={16} /> : <CloudOff size={16} />}
            </button>
            {cloudOpen && (
              <div className="cloud-panel">
                {!cloud.connected && (
                  <>
                    <div className="cloud-title">Connect Google Drive</div>
                    <label className="cloud-label">Google client ID</label>
                    <input
                      className="cloud-input"
                      placeholder="xxxx.apps.googleusercontent.com"
                      value={clientIdDraft}
                      onChange={(e) => setClientIdDraft(e.target.value)}
                      spellCheck={false}
                    />
                    {cloudError && <div className="cloud-error">{cloudError}</div>}
                    <button
                      className="cloud-btn"
                      onClick={connectDrive}
                      disabled={cloudStatus === "syncing" || !clientIdDraft.trim()}
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
                      onClick={() => { setClientIdDraft(cloud.clientId); connectDrive(); }}
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
          <aside className="board">
            <div className="board-head">
              <span>Scenes</span>
              <button className="mini-btn" onClick={() => addScene()}>
                <Plus size={13} /> Scene
              </button>
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
                    className={`card${dragIdx === i ? " dragging" : ""}${overIdx === i ? " over" : ""}`}
                    draggable
                    onDragStart={(e) => { setDragIdx(i); e.dataTransfer.effectAllowed = "move"; }}
                    onDragEnd={() => { setDragIdx(null); setOverIdx(null); }}
                    onDragOver={(e) => { e.preventDefault(); setOverIdx(i); }}
                    onDrop={(e) => { e.preventDefault(); moveScene(dragIdx, i); setDragIdx(null); setOverIdx(null); }}
                    onClick={() => {
                      const node = sceneRefs.current[sc.id];
                      if (node) node.scrollIntoView({ behavior: "smooth", block: "start" });
                    }}
                  >
                    <div className="card-top">
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
                    {snippet(sc) && <div className="card-snippet">{snippet(sc)}</div>}
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
            <span ref={lineProbeRef} className="line-probe" aria-hidden="true">Wg</span>
            {pageBreaks.map((b) => (
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
                {sc.act && (
                  <input
                    className="act-editor"
                    value={sc.act.title}
                    onChange={(e) => setActTitle(sc.id, e.target.value)}
                    spellCheck={false}
                  />
                )}
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
          <aside className="treatment">
            <div className="board-head">
              <span>Treatment</span>
              <button className="ghost" onClick={() => setTreatmentOpen(false)}><X size={14} /></button>
            </div>
            <textarea
              className="treatment-notepad"
              value={doc.treatment || ""}
              placeholder="Paste or write your treatment here, just for reference while you write."
              onChange={(e) => setDoc((d) => ({ ...d, treatment: e.target.value }))}
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
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 14px; gap: 12px;
  background: var(--panel);
  border-bottom: 1px solid var(--line);
  position: relative; z-index: 5;
}
.tb-left, .tb-right { display: flex; align-items: center; gap: 8px; min-width: 0; }
.title-input {
  background: transparent; border: none; outline: none;
  color: var(--text);
  font-family: 'Jost', sans-serif;
  font-size: 12px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase;
  width: 180px; padding: 6px 4px; border-radius: 4px;
}
.title-input:focus { background: var(--panel2); }

.theme-strip {
  position: absolute; left: 50%; transform: translateX(-50%);
  display: flex; align-items: center; gap: 10px;
  max-width: min(420px, 34vw); width: 100%;
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
.treatment-notepad {
  flex: 1; resize: none; outline: none; border: none;
  background: transparent; color: var(--text);
  padding: 4px 16px 16px;
  font-family: 'Courier Prime', monospace; font-size: 13px; line-height: 1.5;
}
.treatment-notepad::placeholder { color: var(--faint); font-style: italic; }

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
  .theme-strip { max-width: 30vw; }
  .page { padding: 40px 28px 80px 40px; width: calc(100% - 24px); }
  .scene-num, .el-type-label { display: none !important; }
  .el-character textarea { margin-left: 26%; width: 70%; }
  .el-dialogue textarea { margin-left: 13%; width: 68%; }
  .el-parenthetical textarea { margin-left: 20%; width: 50%; }
  .board, .projects { position: absolute; z-index: 4; top: 52px; bottom: 0; box-shadow: 12px 0 24px rgba(20,20,15,.10); }
  .chars, .treatment { position: absolute; right: 0; z-index: 4; top: 52px; bottom: 0; box-shadow: -12px 0 24px rgba(20,20,15,.10); }
}
`;
