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
  const acts = scenes.map((s) => (s.heading ? s.heading.act : undefined));

  const chunk = blocks.slice(src.start, src.end + 1);
  const rest = [...blocks.slice(0, src.start), ...blocks.slice(src.end + 1)];

  const restScenes = deriveScenes(rest);
  const target = to > from ? to - 1 : to;
  let insertAt;
  if (target >= restScenes.length) insertAt = rest.length;
  else insertAt = restScenes[target].start;

  const out = [...rest.slice(0, insertAt), ...chunk, ...rest.slice(insertAt)];

  /* reapply act flags by position, so a flag never travels with a dragged card.
     clone the headings rather than mutating shared block objects. */
  const outScenes = deriveScenes(out);
  const patch = new Map();
  outScenes.forEach((s, i) => {
    if (!s.heading) return;
    const next = { ...s.heading };
    if (acts[i] !== undefined) next.act = acts[i];
    else delete next.act;
    patch.set(s.heading.id, next);
  });
  return out.map((b) => patch.get(b.id) || b);
}

/* ------------------------------------------------------------------ CONT'D */
/* Final Draft appends (CONT'D) when a character resumes after action
   interrupts them, within the same scene. */
export function needsContd(blocks, idx) {
  const el = blocks[idx];
  if (!el || el.type !== "character" || !el.text.trim()) return false;
  if (/\(CONT'D\)/i.test(el.text)) return false;
  const clean = (t) => t.toUpperCase().replace(/\(.*?\)/g, "").trim();
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
    const n = b.text.toUpperCase().replace(/\(.*?\)/g, "").trim();
    if (n && !seen.includes(n)) seen.push(n);
  }
  return seen.length > 1 ? [seen[1], seen[0], ...seen.slice(2)] : seen;
}

export function allCharacters(blocks) {
  const set = new Set();
  blocks.forEach((b) => {
    if (b.type !== "character") return;
    const n = b.text.toUpperCase().replace(/\(.*?\)/g, "").trim();
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
/* Parse pasted / imported plain text using standard-format heuristics. */
export function parseScriptText(raw) {
  const lines = String(raw).replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let last = null;
  for (const line of lines) {
    const t = line.trim();
    if (!t) { last = null; continue; }

    if (HEADING_RE.test(t)) { blocks.push(newBlock("heading", t)); last = "heading"; continue; }

    const isCaps = t === t.toUpperCase() && /[A-Z]/.test(t);

    if (isCaps && TRANSITION_RE.test(t)) { blocks.push(newBlock("transition", t)); last = "transition"; continue; }

    if (t.startsWith("(") && (last === "character" || last === "dialogue")) {
      blocks.push(newBlock("parenthetical", t)); last = "parenthetical"; continue;
    }

    if (last === "character" || last === "parenthetical") {
      blocks.push(newBlock("dialogue", t)); last = "dialogue"; continue;
    }

    if (last === "dialogue" && !isCaps) {
      const prev = blocks[blocks.length - 1];
      prev.text = `${prev.text} ${t}`; // wrapped line continues the same speech
      continue;
    }

    if (isCaps && t.length <= 40 && !/[.!?]$/.test(t.replace(/\)$/, ""))) {
      blocks.push(newBlock("character", t)); last = "character"; continue;
    }

    blocks.push(newBlock("action", t)); last = "action";
  }
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
  const textOf = (p) =>
    Array.from(p.children).filter((c) => c.tagName === "Text").map((t) => t.textContent).join("");

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
    if (!type) { if (text.trim()) blocks.push(newBlock("action", text)); return; }
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
      .map((p) => textOf(p).trim())
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
    if (!b.text.trim()) return;
    let text = b.text;
    if (b.type === "heading" || b.type === "character" || b.type === "transition") text = text.toUpperCase();
    if (b.type === "character" && contd) text = `${text} (CONT'D)`;
    out.push(`${indent}<Paragraph Type="${FD_TYPE[b.type]}"><Text>${escXML(text)}</Text></Paragraph>`);
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

/* ------------------------------------------------------------- DOM <-> model
   The editor is one contenteditable surface. These two functions are the only
   bridge between the block list and its HTML. Keeping them pure makes them
   testable without a browser. */

const escHTML = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function buildHTML(blocks) {
  const html = [];
  const blk = (b) =>
    `<div class="blk ${b.type}" data-id="${b.id}" data-type="${b.type}">${
      b.text ? escHTML(b.text) : "<br>"
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
    const b = {
      id: el.dataset.id || uid(),
      type,
      text: el.textContent.replace(/\u00a0/g, " ").replace(/\n/g, " "),
    };
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
