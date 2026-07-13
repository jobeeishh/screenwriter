/* ============================================================================
   Voice dictation: a pure command parser + a thin SpeechRecognition wrapper.

   No imports, no React, no DOM beyond the recognition API itself -- the
   parser is a pure function so the whole grammar is unit-testable in node,
   and the wrapper exposes feed() so end-to-end behavior can be exercised
   without a microphone.

   Philosophy (from the spec): dictate loosely, tidy after. The matcher is
   deliberately conservative -- a false positive (dialogue eaten as a
   command) is far worse than a false negative (tapping the element type).

   parseUtterance(finalText, context, opts) -> { ops, echo }
     ops : [{op:"text",text} | {op:"newBlock",type,text} | {op:"enter"} |
            {op:"deleteLast"} | {op:"undo"} | {op:"stop"}]
     echo: short human string for the UI when a command fired ("→ CUT TO:")
   context: { type, before }  -- current block type + text before the caret
   opts   : { commands=true, autoCap=true }
   ==========================================================================*/

const splitWords = (s) => String(s).split(/\s+/).filter(Boolean);

/* ---------------- punctuation & control words (always active) ------------- */
/* kind: "after" attaches to the preceding word; "open" attaches the NEXT
   word to itself; "dash" floats with spaces; "enter"/"para" are structural */
const PUNCT = [
  [["question", "mark"], "?", "after"],
  [["exclamation", "point"], "!", "after"],
  [["exclamation", "mark"], "!", "after"],
  [["full", "stop"], ".", "after"],
  [["dot", "dot", "dot"], "…", "after"],
  [["open", "parenthesis"], "(", "open"],
  [["open", "paren"], "(", "open"],
  [["close", "parenthesis"], ")", "after"],
  [["close", "paren"], ")", "after"],
  [["new", "line"], null, "enter"],
  [["next", "line"], null, "enter"],
  [["new", "paragraph"], null, "para"],
  [["period"], ".", "after"],
  [["comma"], ",", "after"],
  [["exclamation"], "!", "after"],
  [["ellipsis"], "…", "after"],
  [["dash"], "—", "dash"],
  [["colon"], ":", "after"],
  [["semicolon"], ";", "after"],
  [["quote"], '"', "open"],
  [["unquote"], '"', "after"],
].sort((a, b) => b[0].length - a[0].length); // greedy: longest sequence first

const matchPunct = (words, i) => {
  for (const [seq, sym, kind] of PUNCT) {
    if (i + seq.length > words.length) continue;
    let ok = true;
    for (let k = 0; k < seq.length; k++) {
      if (words[i + k].toLowerCase().replace(/[.,!?]$/, "") !== seq[k]) { ok = false; break; }
    }
    if (ok) return [seq.length, sym, kind];
  }
  return null;
};

/* words -> text/enter/para ops, applying spacing + capitalization */
function tokenize(words, o) {
  const ops = [];
  let buf = "";
  let open = false; // last emitted char was ( or opening quote
  let capNext = o.capNext;
  const flush = () => { if (buf) { ops.push({ op: "text", text: buf }); buf = ""; } };
  for (let i = 0; i < words.length; ) {
    const m = matchPunct(words, i);
    if (m) {
      const [len, sym, kind] = m;
      if (kind === "enter") { flush(); ops.push({ op: "enter" }); capNext = true; open = false; }
      else if (kind === "para") { flush(); ops.push({ op: "newBlock", type: "action", text: "" }); capNext = true; open = false; }
      else if (kind === "open") { buf += (buf && !open ? " " : "") + sym; open = true; }
      else if (kind === "dash") { buf += (buf ? " " : "") + sym; open = false; }
      else { // "after"
        buf = buf.replace(/\s+$/, "") + sym;
        if (/[.!?…]/.test(sym)) capNext = true;
        open = false;
      }
      i += len;
      continue;
    }
    let w = words[i];
    if (o.upperAll) w = w.toUpperCase();
    else if (capNext && o.autoCap && /[a-z]/.test(w[0])) w = w[0].toUpperCase() + w.slice(1);
    if (/[a-z0-9]/i.test(w[0])) capNext = false;
    buf += (buf && !open ? " " : "") + w;
    open = false;
    i++;
  }
  flush();
  return ops;
}

/* ---------------- scene-heading sub-grammar ---------------- */
export function parseSlug(rest) {
  const words = splitWords(String(rest || "").toLowerCase().replace(/[.,!?]+$/, ""));
  if (!words.length) return "";
  let i = 0;
  let prefix = "";
  const two = words.slice(0, 2).join(" ");
  if (two === "interior exterior" || two === "inside outside") { prefix = "INT./EXT."; i = 2; }
  else if (/^(interior|inside|int)$/.test(words[0])) { prefix = "INT."; i = 1; }
  else if (/^(exterior|outside|ext)$/.test(words[0])) { prefix = "EXT."; i = 1; }
  const TIME = new Set(["day", "night", "morning", "evening", "afternoon", "dusk", "dawn", "continuous", "later", "sunset", "sunrise"]);
  let time = "";
  let end = words.length;
  if (end > i && TIME.has(words[end - 1])) {
    time = words[end - 1].toUpperCase();
    end--;
    if (end > i && words[end - 1] === "at") end--; // "coffee shop at night"
  }
  const loc = words.slice(i, end).join(" ").toUpperCase();
  const head = [prefix, loc].filter(Boolean).join(" ");
  return head + (time ? (head ? " - " : "") + time : "");
}

/* ---------------- command tables ---------------- */
/* transitions match only as the ENTIRE utterance -- "cut to the chase" in
   dialogue must stay literal, so there is no leading-match here at all */
const TRANSITIONS = [
  [/^cut to$/, "CUT TO:"],
  [/^smash cut( to)?$/, "SMASH CUT TO:"],
  [/^dissolve to$/, "DISSOLVE TO:"],
  [/^fade out$/, "FADE OUT."],
  [/^fade in$/, "FADE IN:"],
  [/^fade to black$/, "FADE TO BLACK."],
];

const ELEMENTS = [
  [/^(?:scene heading|slug ?line|new scene)\b/, "heading"],
  [/^(?:new action|action|description)\b/, "action"],
  [/^(?:character|cue)\b/, "character"],
  [/^(?:dialogue|dialog)\b/, "dialogue"],
  [/^(?:parenthetical|paren)\b/, "parenthetical"],
];

/* ---------------- the parser ---------------- */
export function parseUtterance(raw, context = {}, opts = {}) {
  const autoCap = opts.autoCap !== false;
  const commands = opts.commands !== false;
  const text = String(raw || "").trim();
  if (!text) return { ops: [], echo: "" };
  /* iOS auto-punctuates, so "cut to." must still read as a command */
  const stripped = text.replace(/[.,!?]+\s*$/, "");
  const lower = stripped.toLowerCase();

  if (commands) {
    if (/^(scratch|delete) that$/.test(lower)) return { ops: [{ op: "deleteLast" }], echo: "scratch that" };
    if (/^undo$/.test(lower)) return { ops: [{ op: "undo" }], echo: "undo" };
    if (/^stop (dictation|listening)$/.test(lower)) return { ops: [{ op: "stop" }], echo: "stopped" };
    if (/^wryly$/.test(lower)) return { ops: [{ op: "newBlock", type: "parenthetical", text: "(wryly)" }], echo: "→ (wryly)" };

    for (const [re, out] of TRANSITIONS) {
      if (re.test(lower)) return { ops: [{ op: "newBlock", type: "transition", text: out }], echo: `→ ${out}` };
    }
    if (/^transition\b/.test(lower)) {
      const rest = stripped.slice("transition".length).trim();
      const up = rest.toUpperCase().replace(/[.:]+$/, "");
      const body = rest ? up + (/(OUT|IN|BLACK)$/.test(up) ? "." : ":") : "CUT TO:";
      return { ops: [{ op: "newBlock", type: "transition", text: body }], echo: `→ ${body}` };
    }

    for (const [re, type] of ELEMENTS) {
      const m = re.exec(lower);
      if (!m) continue;
      const rest = stripped.slice(m[0].length).trim();
      if (type === "heading") {
        const slug = parseSlug(rest);
        return { ops: [{ op: "newBlock", type, text: slug }], echo: `→ ${slug || "scene heading"}` };
      }
      if (type === "character") {
        const name = rest.toUpperCase().replace(/[.,!?]+$/, "");
        return { ops: [{ op: "newBlock", type, text: name }], echo: `→ character${name ? ": " + name : ""}` };
      }
      if (type === "parenthetical") {
        const body = rest.toLowerCase().replace(/[.,!?]+$/, "");
        return { ops: [{ op: "newBlock", type, text: body ? `(${body})` : "" }], echo: "→ parenthetical" };
      }
      /* action / dialogue: the remainder is the new block's opening text */
      const tail = rest ? tokenize(splitWords(rest), { capNext: true, upperAll: false, autoCap }) : [];
      const ops = [{ op: "newBlock", type, text: "" }];
      if (tail.length && tail[0].op === "text") { ops[0].text = tail[0].text; tail.shift(); }
      return { ops: [...ops, ...tail], echo: `→ ${type}` };
    }
  }

  /* speech landing on a character cue that already has a name is the start
     of that character's dialogue -- open a dialogue block first, the way
     Enter does after a cue. An empty cue instead takes the words as its
     name (someone who said "character" and the name as separate utterances). */
  const toDialogue = context.type === "character" && (context.before || "").trim();
  const effType = toDialogue ? "dialogue" : context.type;

  /* plain content: punctuation words and "new line" stay active even with
     commands off -- they misfire far less than element words do */
  const upperAll = effType === "character" || effType === "heading" || effType === "transition";
  const capNext = autoCap && (toDialogue || !context.before || /(^|[.!?…]["')\]]?)\s*$/.test(context.before));
  const ops = tokenize(splitWords(text), { capNext, upperAll, autoCap });

  if (toDialogue) {
    const lead = { op: "newBlock", type: "dialogue", text: "" };
    if (ops.length && ops[0].op === "text") { lead.text = ops[0].text; ops.shift(); }
    return { ops: [lead, ...ops], echo: "" };
  }
  /* continuing mid-block after a word needs a joining space */
  if (ops.length && ops[0].op === "text" && context.before && !/\s$/.test(context.before) && !/^[\s.,!?;:)…"']/.test(ops[0].text)) {
    ops[0] = { ...ops[0], text: " " + ops[0].text };
  }
  return { ops, echo: "" };
}

/* ---------------- SpeechRecognition wrapper ---------------- */
export function createDictation({ onInterim, onOps, onStateChange, getContext, getOptions }) {
  const SR = typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);
  const supported = !!SR;

  let want = false;
  let rec = null;
  let restarts = 0;

  const handleFinal = (t) => {
    const { ops, echo } = parseUtterance(t, getContext ? getContext() : {}, getOptions ? getOptions() : {});
    if (ops.length || echo) onOps(ops, echo);
  };

  /* a fresh instance per (re)start: iOS wedges when instances are reused
     after errors, and instances are cheap */
  const spin = () => {
    rec = new SR();
    rec.lang = (getOptions && getOptions().lang) || "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      restarts = 0; // real audio is flowing; reset the restart budget
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) handleFinal(r[0].transcript);
        else interim += r[0].transcript;
      }
      onInterim(interim);
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") { want = false; onStateChange("denied"); }
      else if (e.error === "network") { want = false; onStateChange("network"); }
      /* no-speech / aborted: onend decides whether to restart */
    };
    rec.onend = () => {
      onInterim("");
      /* mobile engines auto-stop constantly; restart while the user still
         wants to listen, but never loop forever on a dead engine */
      if (want && restarts < 30) { restarts++; try { spin(); return; } catch {} }
      want = false;
      onStateChange("idle");
    };
    rec.start();
  };

  const start = () => {
    if (!supported || want) return;
    want = true;
    restarts = 0;
    try { spin(); onStateChange("listening"); }
    catch { want = false; onStateChange("idle"); }
  };

  const stop = () => {
    want = false;
    try { if (rec) rec.stop(); } catch {}
    onInterim("");
    onStateChange("idle");
  };

  return {
    supported,
    start,
    stop,
    toggle: () => (want ? stop() : start()),
    listening: () => want,
    feed: handleFinal, // test hook: inject a final transcript without a mic
  };
}
