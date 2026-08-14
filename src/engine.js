/* ============================================================================
   engine.js — the script model, independent of React and of the DOM editor.
   A screenplay is ONE flat list of blocks. Scene headings are blocks too.
   ==========================================================================*/

export const uid = () => Math.random().toString(36).slice(2, 10);

export const HEADING_RE = /^(INT|EXT|INT\.?\/EXT|I\/E|EST)[.\s]/i;
export const TRANSITION_RE = /^[A-Z0-9 '.]+TO:$/;
export const CHAR_EXTENSIONS = ["(V.O.)", "(O.S.)", "(CONT'D)", "(PRE-LAP)", "(INTO PHONE)"];

export const TYPES = ["heading", "action", "character", "parenthetical", "dialogue", "transition"];

/* Pressing Enter at the end of a block gives you this next, like Final Draft. */
export const NEXT_TYPE = {
  heading: "action",
  action: "action",
  character: "dialogue",
  parenthetical: "dialogue",
  dialogue: "character",
  transition: "heading",
};

/* Tab cycles through these. */
export const TYPE_CYCLE = ["action", "character", "dialogue", "parenthetical", "transition", "heading"];

export const TYPE_LABEL = {
  heading: "SCENE",
  action: "ACTION",
  character: "CHARACTER",
  parenthetical: "PAREN",
  dialogue: "DIALOGUE",
  transition: "TRANSITION",
};

export const newBlock = (type = "action", text = "") => ({ id: uid(), type, text });

/* ----------------------------------------------------------------- emphasis
   Italics ride inside block.text as fountain's *asterisks*, so a block stays
   one plain string. Sync, undo, autosave, search and every export keep working
   on strings; only the editor and the exporters need to know about runs.
   A literal asterisk or backslash escapes with a backslash. */

const escHTML = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const escMark = (s) => String(s).replace(/[\\*]/g, "\\$&");

const isSpace = (c) => c === undefined || /\s/.test(c);

/* Every asterisk the escapes didn't claim. */
const starsIn = (s) => {
  const out = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && (s[i + 1] === "*" || s[i + 1] === "\\")) { i++; continue; }
    if (s[i] === "*") out.push(i);
  }
  return out;
};

/* Pair them fountain's way: an opener has a non-space after it, a closer has a
   non-space before it, and the pair has to hold something. Odd stars out stay
   literal, so a lone asterisk in an action line is just an asterisk. */
const starPairs = (s) => {
  const stars = starsIn(s);
  const pairs = [];
  let i = 0;
  while (i < stars.length) {
    const open = stars[i];
    if (!isSpace(s[open + 1])) {
      let j = i + 1;
      while (j < stars.length && (stars[j] <= open + 1 || isSpace(s[stars[j] - 1]))) j++;
      if (j < stars.length) { pairs.push([open, stars[j]]); i = j + 1; continue; }
    }
    i++;
  }
  return pairs;
};

/* marked text -> [{ text, italic }] */
export function parseMarks(src) {
  const s = String(src == null ? "" : src);
  const pairs = starPairs(s);
  const opens = new Set(pairs.map(([a]) => a));
  const closes = new Set(pairs.map(([, b]) => b));
  const runs = [];
  let buf = "";
  let italic = false;
  const flush = () => { if (buf) runs.push({ text: buf, italic }); buf = ""; };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\" && (s[i + 1] === "*" || s[i + 1] === "\\")) { buf += s[++i]; continue; }
    if (opens.has(i)) { flush(); italic = true; continue; }
    if (closes.has(i)) { flush(); italic = false; continue; }
    buf += c;
  }
  flush();
  return runs;
}

/* [{ text, italic }] -> marked text */
export function renderMarks(runs) {
  const out = [];
  (runs || []).forEach((r) => {
    const t = String(r.text || "");
    if (!t) return;
    if (!r.italic) { out.push({ text: t, italic: false }); return; }
    /* whitespace has to sit outside the asterisks or the result won't re-parse */
    const lead = t.match(/^\s*/)[0];
    if (lead.length === t.length) { out.push({ text: t, italic: false }); return; }
    const trail = t.match(/\s*$/)[0];
    if (lead) out.push({ text: lead, italic: false });
    out.push({ text: t.slice(lead.length, t.length - trail.length), italic: true });
    if (trail) out.push({ text: trail, italic: false });
  });
  /* merge neighbours so a split never emits *a**b* */
  const merged = [];
  out.forEach((r) => {
    const last = merged[merged.length - 1];
    if (last && last.italic === r.italic) last.text += r.text;
    else merged.push({ ...r });
  });
  return merged.map((r) => (r.italic ? `*${escMark(r.text)}*` : escMark(r.text))).join("");
}

/* What the reader sees: markers resolved, escapes undone. Use this anywhere a
   block's words are matched, measured, spoken or shown outside the page. */
export const plainText = (text) => parseMarks(text).map((r) => r.text).join("");

/* Substring by PLAIN offsets, returned still marked. */
export function sliceMarked(text, start, end) {
  const out = [];
  let seen = 0;
  for (const r of parseMarks(text)) {
    const a = Math.max(start, seen);
    const b = Math.min(end, seen + r.text.length);
    if (b > a) out.push({ text: r.text.slice(a - seen, b - seen), italic: r.italic });
    seen += r.text.length;
    if (seen >= end) break;
  }
  return renderMarks(out);
}

/* .trim() that keeps the markers intact. */
export function trimMarked(text) {
  const plain = plainText(text);
  const start = plain.length - plain.replace(/^\s+/, "").length;
  const end = plain.replace(/\s+$/, "").length;
  return end > start ? sliceMarked(text, start, end) : "";
}

export const marksToHTML = (text) =>
  parseMarks(text)
    .map((r) => (r.italic ? `<em>${escHTML(r.text)}</em>` : escHTML(r.text)))
    .join("");

const isItalicEl = (el) =>
  el.nodeName === "EM" || el.nodeName === "I" ||
  (el.style && el.style.fontStyle === "italic");

/* One block's DOM -> marked text. Tolerant of whatever markup the browser or a
   paste left behind: anything not italic simply contributes its words. */
export function readMarks(el) {
  const runs = [];
  const walk = (node, italic) => {
    if (node.nodeType === 3) {
      const t = node.textContent.replace(/\u00a0/g, " ").replace(/\n/g, " ");
      if (t) runs.push({ text: t, italic });
      return;
    }
    if (node.nodeType !== 1 || node.nodeName === "BR") return;
    const it = italic || isItalicEl(node);
    Array.from(node.childNodes).forEach((c) => walk(c, it));
  };
  Array.from(el.childNodes).forEach((c) => walk(c, false));
  return renderMarks(runs);
}

export const DEFAULT_DOC = () => ({
  title: "UNTITLED",
  theme: "",
  treatment: "",
  titlePage: { byline: "", contact: "" },
  characters: {},
  versions: [],
  blocks: [newBlock("heading", ""), newBlock("action", "")],
});

/* ---------------------------------------------------------------- migration */
/* Old docs stored scenes[] with nested elements[]. Flatten into blocks[]. */
export function migrateDoc(d) {
  if (!d) return DEFAULT_DOC();
  if (Array.isArray(d.blocks)) return { ...DEFAULT_DOC(), ...d };
  if (!Array.isArray(d.scenes)) return DEFAULT_DOC();
  const blocks = [];
  d.scenes.forEach((sc) => {
    blocks.push({
      id: sc.id || uid(),
      type: "heading",
      text: sc.heading || "",
      act: sc.act ? sc.act.title : undefined,
      synopsis: sc.synopsis || undefined,
      done: sc.done || undefined,
    });
    (sc.elements || []).forEach((el) => {
      blocks.push({
        id: el.id || uid(),
        type: TYPES.includes(el.type) ? el.type : "action",
        text: el.text || "",
        pairId: el.pairId,
        pairSide: el.pairSide,
      });
    });
  });
  if (!blocks.length) blocks.push(newBlock("heading", ""), newBlock("action", ""));
  const { scenes, ...rest } = d;
  return { ...DEFAULT_DOC(), ...rest, blocks };
}

/* ------------------------------------------------------------------- scenes */
/* Scenes are derived, never stored. A heading block opens a scene. */
export function deriveScenes(blocks) {
  const scenes = [];
  let cur = null;
  blocks.forEach((b, i) => {
    if (b.type === "heading") {
      cur = { heading: b, headingIdx: i, blocks: [], start: i };
      scenes.push(cur);
    } else if (cur) {
      cur.blocks.push(b);
    } else {
      cur = { heading: null, headingIdx: -1, blocks: [b], start: i };
      scenes.push(cur);
    }
  });
  scenes.forEach((s, i) => {
    s.end = i + 1 < scenes.length ? scenes[i + 1].start - 1 : blocks.length - 1;
    /* Where a scene's notes, act flag and done mark live. A script that opens on
       an image before any slugline still has a scene there; it just hangs its
       marks on its first block instead of on a heading it doesn't have. */
    s.anchor = s.heading || s.blocks[0] || null;
  });
  return scenes;
}

/* Remove a whole scene (its heading plus everything until the next heading). */
export function deleteSceneAt(blocks, sceneIdx) {
  const scenes = deriveScenes(blocks);
  const s = scenes[sceneIdx];
  if (!s) return blocks;
  const out = [...blocks.slice(0, s.start), ...blocks.slice(s.end + 1)];
  return out.length ? out : [newBlock("heading", ""), newBlock("action", "")];
}

/* Move a scene's whole block-range. Act flags stay pinned to their position. */
export function moveScene(blocks, from, to) {
  if (from === to || from == null || to == null) return blocks;
  const scenes = deriveScenes(blocks);
  const src = scenes[from];
  if (!src) return blocks;
  const acts = scenes.map((s) => (s.anchor ? s.anchor.act : undefined));

  const chunk = blocks.slice(src.start, src.end + 1);
  const rest = [...blocks.slice(0, src.start), ...blocks.slice(src.end + 1)];

  const restScenes = deriveScenes(rest);
  const target = to > from ? to - 1 : to;
  let insertAt;
  if (target >= restScenes.length) insertAt = rest.length;
  else insertAt = restScenes[target].start;

  const out = [...rest.slice(0, insertAt), ...chunk, ...rest.slice(insertAt)];

  /* reapply act flags by position, so a flag never travels with a dragged card.
     clone the anchors rather than mutating shared block objects. */
  const outScenes = deriveScenes(out);
  const patch = new Map();
  outScenes.forEach((s, i) => {
    if (!s.anchor) return;
    const next = { ...s.anchor };
    if (acts[i] !== undefined) next.act = acts[i];
    else delete next.act;
    patch.set(s.anchor.id, next);
  });
  return out.map((b) => patch.get(b.id) || b);
}

/* ------------------------------------------------------------------ CONT'D */
/* Final Draft appends (CONT'D) when a character resumes after action
   interrupts them, within the same scene. */
export function needsContd(blocks, idx) {
  const el = blocks[idx];
  if (!el || el.type !== "character" || !plainText(el.text).trim()) return false;
  if (/\(CONT'D\)/i.test(plainText(el.text))) return false;
  const clean = (t) => plainText(t).toUpperCase().replace(/\(.*?\)/g, "").trim();
  const name = clean(el.text);
  if (!name) return false;
  let sawAction = false;
  for (let k = idx - 1; k >= 0; k--) {
    const p = blocks[k];
    if (p.type === "heading" || p.type === "transition") return false;
    if (p.type === "action") { sawAction = true; continue; }
    if (p.type === "character") return sawAction && clean(p.text) === name;
  }
  return false;
}

/* Prior speakers for an empty character line; the alternating speaker comes first. */
export function priorSpeakers(blocks, idx) {
  const seen = [];
  for (let k = idx - 1; k >= 0 && seen.length < 5; k--) {
    const b = blocks[k];
    if (b.type === "heading") break;
    if (b.type !== "character") continue;
    const n = plainText(b.text).toUpperCase().replace(/\(.*?\)/g, "").trim();
    if (n && !seen.includes(n)) seen.push(n);
  }
  return seen.length > 1 ? [seen[1], seen[0], ...seen.slice(2)] : seen;
}

export function allCharacters(blocks) {
  const set = new Set();
  blocks.forEach((b) => {
    if (b.type !== "character") return;
    const n = plainText(b.text).toUpperCase().replace(/\(.*?\)/g, "").trim();
    if (n) set.add(n);
  });
  return [...set].sort();
}

/* ----------------------------------------------------------- dual dialogue */
/* Group consecutive blocks sharing a pairId into one dual unit. */
export function groupBlocks(blocks) {
  const groups = [];
  let i = 0;
  while (i < blocks.length) {
    const b = blocks[i];
    if (b.pairId) {
      const pid = b.pairId;
      const chunk = [];
      while (i < blocks.length && blocks[i].pairId === pid) chunk.push(blocks[i++]);
      groups.push({
        kind: "dual",
        pairId: pid,
        left: chunk.filter((x) => x.pairSide === "left"),
        right: chunk.filter((x) => x.pairSide === "right"),
      });
    } else {
      groups.push({ kind: "single", block: b, idx: i });
      i++;
    }
  }
  return groups;
}

const blockEnd = (blocks, start) => {
  let i = start + 1;
  while (i < blocks.length && (blocks[i].type === "dialogue" || blocks[i].type === "parenthetical")) i++;
  return i;
};

export function canPairAt(blocks, idx) {
  const b = blocks[idx];
  if (!b || b.type !== "character" || b.pairId) return false;
  const end = blockEnd(blocks, idx);
  const next = blocks[end];
  return !!next && next.type === "character" && !next.pairId;
}

export function pairAt(blocks, idx) {
  if (!canPairAt(blocks, idx)) return blocks;
  const aEnd = blockEnd(blocks, idx);
  const bEnd = blockEnd(blocks, aEnd);
  const pairId = uid();
  return blocks.map((b, i) => {
    if (i >= idx && i < aEnd) return { ...b, pairId, pairSide: "left" };
    if (i >= aEnd && i < bEnd) return { ...b, pairId, pairSide: "right" };
    return b;
  });
}

export function unpair(blocks, pairId) {
  return blocks.map((b) => {
    if (b.pairId !== pairId) return b;
    const { pairId: _p, pairSide: _s, ...rest } = b;
    return rest;
  });
}

/* ------------------------------------------------------------ text parsing */
/* Two readers for pasted / imported plain text.

   Text copied out of Final Draft (or a PDF, or a printed script) arrives LAID
   OUT: the element type is carried by the indent column, which is far more
   reliable than guessing from capitals. Fountain and hand-typed text arrive
   flush left, where capitals and punctuation are all there is to go on. We
   measure the columns first and pick the reader that fits. */

const indentOf = (line) => line.match(/^[ \t]*/)[0].replace(/\t/g, "    ").length;

const mode = (xs) => {
  const count = new Map();
  xs.forEach((x) => count.set(x, (count.get(x) || 0) + 1));
  let best = xs[0], n = 0;
  count.forEach((c, x) => { if (c > n || (c === n && x > best)) { best = x; n = c; } });
  return best;
};

/* "JOHN (O.S.)" -> "JOHN". The extension has to come off WHOLE: stripping just
   the ")" leaves "JOHN (O.S." looking like a sentence that ends in a period,
   which is exactly how a cue with an extension got read as action. */
const cueBase = (t) => t.replace(/\s*\([^()]*\)\s*$/, "").trim();

const looksLikeCue = (t) => {
  const base = cueBase(t);
  if (!base || base.length > 40) return false;
  if (base !== base.toUpperCase() || !/[A-Z]/.test(base)) return false;
  return !/[.!?]$/.test(base);
};

const isTransition = (t) => TRANSITION_RE.test(t.toUpperCase());

/* Standard margins put dialogue 12 columns left of the cue. So if the cue
   column is the full 22 the copy includes the action margin; if it is only
   about 12, the copy started inside a speech and column 0 IS the dialogue. */
const CUE_COL_WITH_MARGIN = 18;

function parseLaidOut(lines, charCol, base) {
  const blocks = [];
  let prevType = null;
  let gap = true; // a blank line ends a wrapped paragraph
  const push = (type, text) => {
    /* action and dialogue wrap across lines; rejoin them into one element */
    if (!gap && type === prevType && (type === "action" || type === "dialogue")) {
      const prev = blocks[blocks.length - 1];
      prev.text = `${prev.text} ${text}`;
      return;
    }
    blocks.push(newBlock(type, text));
    prevType = type;
  };

  const zeroIsAction =
    charCol >= CUE_COL_WITH_MARGIN ||
    lines.some((l) => l.trim() && indentOf(l) - base === 0 &&
      (HEADING_RE.test(l.trim()) || isTransition(l.trim())));

  for (const line of lines) {
    const t = line.trim();
    if (!t) { gap = true; continue; }
    const d = indentOf(line) - base;

    let type;
    if (HEADING_RE.test(t)) type = "heading";
    else if (isTransition(t)) type = "transition";
    else if (t.startsWith("(") && d > 0) type = "parenthetical";
    else if (d >= charCol - 2 && looksLikeCue(t)) type = "character";
    else if (d === 0 && zeroIsAction) type = "action";
    else type = "dialogue";

    push(type, t);
    gap = false;
  }
  return blocks;
}

/* Roughly where action wraps; a line at least this long was probably broken by
   the page, not by the writer, so the next line continues it. */
const WRAP_COL = 45;

/* Whether blank lines are what separate paragraphs here. If the text never puts
   one between two paragraphs, then every line IS a paragraph and rejoining long
   neighbours would run consecutive action beats together. */
const blankSeparated = (lines) => {
  let sawText = false, blank = false;
  for (const l of lines) {
    if (!l.trim()) { blank = sawText; continue; }
    if (blank) return true;
    sawText = true;
  }
  return false;
};

/* Without indentation, what a line IS depends on what came before it: dialogue
   is dialogue because a cue opened the speech. So a blank line must NOT clear
   that context -- it only ends a wrapped paragraph. Clearing it is what turned
   every spoken line into action, because plain-text exports normally put a
   blank line between a cue and its dialogue. */
function parseFlushLeft(lines) {
  const blocks = [];
  const rejoin = blankSeparated(lines);
  let last = null;
  let gap = true;   // blank line since the previous one?
  let prevLen = 0;
  const append = (t) => { const p = blocks[blocks.length - 1]; p.text = `${p.text} ${t}`; };
  const push = (type, t) => { blocks.push(newBlock(type, t)); last = type; };

  for (const line of lines) {
    const t = line.trim();
    if (!t) { gap = true; continue; }
    const isCaps = t === t.toUpperCase() && /[A-Z]/.test(t);

    if (HEADING_RE.test(t)) push("heading", t);
    else if (isCaps && isTransition(t)) push("transition", t);
    else if (t.startsWith("(") && (last === "character" || last === "dialogue")) push("parenthetical", t);
    /* a cue opens a speech, blank line or not */
    else if (last === "character" || last === "parenthetical") push("dialogue", t);
    else if (last === "dialogue" && !gap && !isCaps) append(t);
    else if (last === "action" && rejoin && !gap && !isCaps && prevLen >= WRAP_COL) append(t);
    else if (looksLikeCue(t)) push("character", t);
    else push("action", t);

    gap = false;
    prevLen = t.length;
  }
  return blocks;
}

export function parseScriptText(raw) {
  const lines = String(raw).replace(/\r\n?/g, "\n").split("\n");
  const live = lines.filter((l) => l.trim());
  if (!live.length) throw new Error("Nothing readable in that text.");

  /* The cue column anchors everything else, because it is the one indented
     column a script always has. If nothing is indented, the paste is flat. */
  const base = Math.min(...live.map(indentOf));
  const cueCols = live
    .filter((l) => looksLikeCue(l.trim()) && indentOf(l) - base > 0)
    .map((l) => indentOf(l) - base);
  const charCol = cueCols.length ? mode(cueCols) : 0;

  /* 3 columns is one tab's worth: enough to mean the paste carries a layout,
     small enough not to trip on a stray leading space. */
  const blocks = charCol >= 3 ? parseLaidOut(lines, charCol, base) : parseFlushLeft(lines);
  if (!blocks.length) throw new Error("Nothing readable in that text.");
  return blocks;
}

/* --------------------------------------------------------------- FDX import */
export function parseFDX(xml) {
  const dom = new DOMParser().parseFromString(xml, "text/xml");
  if (dom.querySelector("parsererror")) throw new Error("That .fdx file couldn't be read.");
  const content = dom.querySelector("FinalDraft > Content");
  if (!content) throw new Error("That doesn't look like a Final Draft file.");

  const map = {
    "Scene Heading": "heading",
    Action: "action",
    Character: "character",
    Dialogue: "dialogue",
    Parenthetical: "parenthetical",
    Transition: "transition",
  };
  /* each <Text> is a run; Style="Italic" (possibly among other styles) is ours */
  const textOf = (p) =>
    renderMarks(
      Array.from(p.children)
        .filter((c) => c.tagName === "Text")
        .map((t) => ({ text: t.textContent, italic: /italic/i.test(t.getAttribute("Style") || "") }))
    );

  const blocks = [];
  const handle = (p, pair) => {
    const dd = Array.from(p.children).find((c) => c.tagName === "DualDialogue");
    if (dd) {
      const pairId = uid();
      let charCount = 0;
      let side = "left";
      Array.from(dd.children).forEach((c) => {
        if (c.tagName !== "Paragraph") return;
        if (c.getAttribute("Type") === "Character") side = charCount++ === 0 ? "left" : "right";
        handle(c, { pairId, side });
      });
      return;
    }
    const type = map[p.getAttribute("Type")] || null;
    const text = textOf(p);
    if (!type) { if (plainText(text).trim()) blocks.push(newBlock("action", text)); return; }
    const b = newBlock(type, text);
    if (pair) { b.pairId = pair.pairId; b.pairSide = pair.side; }
    blocks.push(b);
  };
  Array.from(content.children).forEach((p) => { if (p.tagName === "Paragraph") handle(p); });
  if (!blocks.length) throw new Error("That file had no script content.");

  /* title from the title page, if present */
  let title = "";
  const tp = dom.querySelector("TitlePage > Content");
  if (tp) {
    const first = Array.from(tp.querySelectorAll("Paragraph"))
      .map((p) => plainText(textOf(p)).trim())
      .find((t) => t.length);
    if (first) title = first.toUpperCase();
  }
  return { title, blocks };
}

/* --------------------------------------------------------------- FDX export */
const escXML = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function buildFDX(doc) {
  const FD_TYPE = {
    heading: "Scene Heading",
    action: "Action",
    character: "Character",
    dialogue: "Dialogue",
    parenthetical: "Parenthetical",
    transition: "Transition",
  };
  const out = [];
  const emit = (b, contd, indent = "    ") => {
    if (!plainText(b.text).trim()) return;
    /* one <Text> per run, so italics survive the round trip into Final Draft */
    let runs = parseMarks(b.text);
    if (b.type === "heading" || b.type === "character" || b.type === "transition") {
      runs = runs.map((r) => ({ ...r, text: r.text.toUpperCase() }));
    }
    if (b.type === "character" && contd) runs = [...runs, { text: " (CONT'D)", italic: false }];
    const text = runs
      .map((r) => `<Text${r.italic ? ' Style="Italic"' : ""}>${escXML(r.text)}</Text>`)
      .join("");
    out.push(`${indent}<Paragraph Type="${FD_TYPE[b.type]}">${text}</Paragraph>`);
  };

  groupBlocks(doc.blocks).forEach((g) => {
    if (g.kind === "single") {
      emit(g.block, needsContd(doc.blocks, g.idx));
    } else {
      out.push(
        '    <Paragraph Alignment="Left" FirstIndent="0.00" Leading="Regular" LeftIndent="1.50" RightIndent="7.50" SpaceBefore="12" Spacing="1" StartsNewPage="No" Type="General">'
      );
      out.push("      <DualDialogue>");
      g.left.forEach((b) => emit(b, false, "        "));
      g.right.forEach((b) => emit(b, false, "        "));
      out.push("      </DualDialogue>");
      out.push("    </Paragraph>");
    }
  });

  const tp = [];
  const TP = (text, center = true) =>
    tp.push(`      <Paragraph Alignment="${center ? "Center" : "Left"}"><Text>${escXML(text)}</Text></Paragraph>`);
  const byline = (doc.titlePage && doc.titlePage.byline) || "";
  const contact = (doc.titlePage && doc.titlePage.contact) || "";
  for (let i = 0; i < 16; i++) TP("");
  TP((doc.title || "UNTITLED").toUpperCase());
  if (byline) { TP(""); TP(""); TP("Written by"); TP(""); TP(byline); }
  if (contact) { for (let i = 0; i < 12; i++) TP(""); TP(contact, false); }

  return `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<FinalDraft DocumentType="Script" Template="No" Version="5">
  <Content>
${out.join("\n")}
  </Content>
  <TitlePage>
    <Content>
${tp.join("\n")}
    </Content>
  </TitlePage>
</FinalDraft>`;
}

/* ------------------------------------------------------------------ fountain
   Writer only. The .fountain that sync drops next to each project's JSON is a
   readable, portable artifact -- it is regenerated from the JSON on every push
   and never read back, so external edits to it do not merge. */
export function buildFountain(doc) {
  const paras = [];
  const tp = doc.titlePage || {};
  const head = [`Title: ${doc.title || "UNTITLED"}`];
  if (tp.byline) head.push(`Author: ${tp.byline}`);
  if (tp.contact) {
    head.push("Contact:");
    String(tp.contact).split("\n").forEach((l) => head.push(`   ${l}`));
  }
  paras.push(head.join("\n"));

  /* Block text is already fountain-marked, so italics pass straight through;
     only the structure sniffing has to look past the asterisks. */
  const speech = (blks, dual) => {
    const lines = [];
    blks.forEach((b) => {
      const t = trimMarked(b.text);
      const p = plainText(t);
      if (!p) return;
      if (b.type === "character") {
        // fountain only recognizes an all-caps character cue; force others with @
        lines.push((p === p.toUpperCase() ? t.toUpperCase() : `@${t}`) + (dual ? " ^" : ""));
      } else if (b.type === "parenthetical") {
        lines.push(p.startsWith("(") ? t : `(${t})`);
      } else {
        lines.push(t);
      }
    });
    return lines.length ? lines.join("\n") : null;
  };

  const groups = groupBlocks(doc.blocks || []);
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    if (g.kind === "dual") {
      const l = speech(g.left, false);
      const r = speech(g.right, true);
      if (l) paras.push(l);
      if (r) paras.push(r);
      continue;
    }
    const b = g.block;
    const t = trimMarked(b.text);
    const p = plainText(t);
    if (!p) continue;
    if (b.type === "heading") {
      paras.push(HEADING_RE.test(p.toUpperCase()) ? t.toUpperCase() : `.${t}`);
    } else if (b.type === "transition") {
      paras.push(TRANSITION_RE.test(p.toUpperCase()) ? t.toUpperCase() : `> ${t}`);
    } else if (b.type === "character") {
      /* one speech = one paragraph: a blank line between the cue and its
         dialogue would make fountain read the cue as action */
      const blks = [b];
      while (
        i + 1 < groups.length && groups[i + 1].kind === "single" &&
        (groups[i + 1].block.type === "dialogue" || groups[i + 1].block.type === "parenthetical")
      ) blks.push(groups[++i].block);
      const s = speech(blks, false);
      if (s) paras.push(s);
    } else if (b.type === "dialogue" || b.type === "parenthetical") {
      // stray dialogue with no cue: print it, escaped from other meanings
      const s = speech([b], false);
      if (s) paras.push(s);
    } else {
      // action that would parse as a heading or transition must be escaped
      paras.push(HEADING_RE.test(p) || TRANSITION_RE.test(p.toUpperCase()) ? `!${t}` : t);
    }
  }

  return paras.join("\n\n") + "\n";
}

/* ------------------------------------------------------------- DOM <-> model
   The editor is one contenteditable surface. These two functions are the only
   bridge between the block list and its HTML. Keeping them pure makes them
   testable without a browser. */

export function buildHTML(blocks) {
  const html = [];
  const blk = (b) =>
    `<div class="blk ${b.type}" data-id="${b.id}" data-type="${b.type}">${
      (b.text && marksToHTML(b.text)) || "<br>"
    }</div>`;

  groupBlocks(blocks).forEach((g) => {
    if (g.kind === "single") { html.push(blk(g.block)); return; }
    html.push(`<div class="dual" data-pair="${g.pairId}">`);
    html.push('<div class="dual-col" data-side="left">');
    g.left.forEach((b) => html.push(blk(b)));
    html.push("</div>");
    html.push('<div class="dual-col" data-side="right">');
    g.right.forEach((b) => html.push(blk(b)));
    html.push("</div>");
    html.push("</div>");
  });
  return html.join("");
}

/* Read the DOM back into a block list. Text is whatever the browser has now. */
export function readBlocks(root) {
  const blocks = [];
  const readBlk = (el, pair) => {
    const type = el.dataset.type && TYPES.includes(el.dataset.type) ? el.dataset.type : "action";
    const b = { id: el.dataset.id || uid(), type, text: readMarks(el) };
    if (pair) { b.pairId = pair.pairId; b.pairSide = pair.side; }
    blocks.push(b);
  };
  Array.from(root.children).forEach((child) => {
    if (child.classList && child.classList.contains("dual")) {
      const pairId = child.dataset.pair || uid();
      Array.from(child.children).forEach((col) => {
        const side = col.dataset.side === "right" ? "right" : "left";
        Array.from(col.children).forEach((el) => {
          if (el.classList && el.classList.contains("blk")) readBlk(el, { pairId, side });
        });
      });
    } else if (child.classList && child.classList.contains("blk")) {
      readBlk(child, null);
    }
  });
  return blocks.length ? blocks : [newBlock("heading", ""), newBlock("action", "")];
}
