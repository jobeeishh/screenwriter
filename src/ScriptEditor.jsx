import { useEffect, useRef, useState, useCallback, forwardRef, useImperativeHandle } from "react";
import {
  HEADING_RE, NEXT_TYPE, TYPE_CYCLE, CHAR_EXTENSIONS,
  buildHTML, readBlocks, needsContd, priorSpeakers, allCharacters,
  parseScriptText, canPairAt, pairAt, unpair, uid,
} from "./engine.js";

/* ===========================================================================
   One contenteditable surface for the whole script.

   Rules that keep the caret sane:
     - React never renders the editor's children. innerHTML is written only when
       `version` changes (load, undo, structural edit).
     - While typing, the DOM is the source of truth. State syncs FROM it, debounced.
     - Decorations (scene numbers, CONT'D) ride on data-attributes + CSS, so they
       never touch text nodes and never disturb the caret.
   =========================================================================*/

/* ------------------------------------------------------------ caret helpers */
const blockOf = (node, root) => {
  let n = node;
  while (n && n !== root) {
    if (n.nodeType === 1 && n.classList.contains("blk")) return n;
    n = n.parentNode;
  }
  return null;
};

const currentBlock = (root) => {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  return blockOf(sel.anchorNode, root);
};

const caretOffset = (blk) => {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return 0;
  const r = sel.getRangeAt(0).cloneRange();
  r.selectNodeContents(blk);
  try { r.setEnd(sel.anchorNode, sel.anchorOffset); } catch { return 0; }
  return r.toString().length;
};

const setCaret = (blk, pos) => {
  if (!blk) return;
  const sel = window.getSelection();
  const r = document.createRange();
  const text = blk.firstChild && blk.firstChild.nodeType === 3 ? blk.firstChild : null;
  const target = pos === "end" ? (text ? text.length : 0) : pos === "start" ? 0 : pos;
  if (text) r.setStart(text, Math.max(0, Math.min(target, text.length)));
  else r.setStart(blk, 0);
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
};

const setBlockText = (blk, text) => {
  if (text) blk.textContent = text;
  else blk.innerHTML = "<br>";
};

const makeBlk = (type, text) => {
  const d = document.createElement("div");
  d.className = `blk ${type}`;
  d.dataset.id = uid();
  d.dataset.type = type;
  setBlockText(d, text);
  return d;
};

const setType = (blk, type) => {
  blk.className = `blk ${type}`;
  blk.dataset.type = type;
};

const isInDual = (blk) => blk.parentNode && blk.parentNode.classList.contains("dual-col");

/* ------------------------------------------------- mobile element bar ----- */
/* iOS has no Tab key, so the type cycle that `Tab` drives on desktop is
   unreachable by touch. The bar makes the same TYPE_CYCLE tappable. */
const BAR_TYPES = [
  ["heading", "Scene"],
  ["action", "Action"],
  ["character", "Character"],
  ["dialogue", "Dialogue"],
  ["parenthetical", "Paren"],
  ["transition", "Transition"],
];

const isCoarse = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(pointer: coarse)").matches;

const scrollParent = (node) => {
  let n = node;
  while (n && n !== document.body) {
    if (n.classList && n.classList.contains("editor-scroll")) return n;
    n = n.parentNode;
  }
  return null;
};

/* =========================================================================== */
const ScriptEditor = forwardRef(function ScriptEditor(
  { blocks, version, onChange, onCaretBlock, night, dict },
  ref
) {
  const rootRef = useRef(null);
  const [menu, setMenu] = useState(null); // { items, index, top, left, blkId, interacted }
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;
  const syncTimer = useRef(null);
  const restoreRef = useRef(null); // { id, offset } to restore after a version bump

  /* mobile bar: the caret's type, where the keyboard ends, whether we're editing */
  const [coarse] = useState(isCoarse);
  const [caretType, setCaretType] = useState(null);
  const [caretDual, setCaretDual] = useState(false);
  const [kbTop, setKbTop] = useState(0);
  const [editing, setEditing] = useState(false);
  const lastBlkIdRef = useRef(null);
  const barRef = useRef(null);
  const caretCbRef = useRef(onCaretBlock);
  caretCbRef.current = onCaretBlock;

  /* ---------------- write DOM (only on version change) ---------------- */
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    root.innerHTML = buildHTML(blocksRef.current);
    decorate();
    const r = restoreRef.current;
    if (r) {
      const el = root.querySelector(`[data-id="${r.id}"]`);
      if (el) setCaret(el, r.offset);
      restoreRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  /* ---------------- decorations: scene numbers + CONT'D ---------------- */
  const decorate = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const list = readBlocks(root);
    let sceneNo = 0;
    const nodes = root.querySelectorAll(".blk");
    nodes.forEach((el, i) => {
      const b = list[i];
      if (!b) return;
      if (b.type === "heading") {
        sceneNo += 1;
        el.dataset.num = String(sceneNo);
      } else if (el.dataset.num) {
        delete el.dataset.num;
      }
      if (b.type === "character" && needsContd(list, i)) el.dataset.contd = "(CONT'D)";
      else if (el.dataset.contd) delete el.dataset.contd;
    });
  }, []);

  /* ---------------- sync DOM -> state (debounced, no re-render) -------- */
  const sync = useCallback((immediate = false) => {
    const root = rootRef.current;
    if (!root) return;
    clearTimeout(syncTimer.current);
    const run = () => {
      normalize(root);
      decorate();
      onChange(readBlocks(root));
    };
    if (immediate) run();
    else syncTimer.current = setTimeout(run, 250);
  }, [onChange, decorate]);

  /* structural edits bump the version so the DOM is rebuilt from state */
  const commit = useCallback((nextBlocks, restore) => {
    restoreRef.current = restore || null;
    onChange(nextBlocks, true);
  }, [onChange]);

  /* find the block dictation should act on: the caret's block, else the one
     the caret was last seen in, else the end of the script */
  const targetBlock = () => {
    const root = rootRef.current;
    if (!root) return null;
    let blk = currentBlock(root);
    if (!blk) {
      blk = (lastBlkIdRef.current && root.querySelector(`[data-id="${lastBlkIdRef.current}"]`)) ||
        root.querySelector(".blk:last-of-type");
      if (blk) setCaret(blk, "end");
    }
    return blk;
  };

  useImperativeHandle(ref, () => ({
    focusBlock(id) {
      const root = rootRef.current;
      if (!root) return;
      const el = root.querySelector(`[data-id="${id}"]`);
      if (el) { el.scrollIntoView({ behavior: "smooth", block: "center" }); setCaret(el, "end"); }
    },
    toggleDual,
    root: () => rootRef.current,

    /* ------- dictation interface: all DOM mutation stays in here ------- */
    insertText(str) {
      const root = rootRef.current;
      if (!root || !str) return;
      const blk = targetBlock();
      if (!blk) return;
      if (blk.childNodes.length === 1 && blk.firstChild.nodeName === "BR") {
        blk.innerHTML = "";
        setCaret(blk, 0);
      }
      document.execCommand("insertText", false, str);
      decorate();
      sync();
    },
    setCurrentType(type) { applyType(type); },
    newBlockAfterCurrent(type, text) {
      const root = rootRef.current;
      if (!root) return;
      const blk = targetBlock();
      const anchor = blk && isInDual(blk) ? blk.parentNode.parentNode : blk;
      const nb = makeBlk(type, text || "");
      if (anchor) anchor.after(nb); else root.appendChild(nb);
      setCaret(nb, "end");
      lastBlkIdRef.current = nb.dataset.id;
      setCaretType(type);
      if (type === "character") openMenuFor(nb); else closeMenu();
      sync(true);
    },
    pressEnter() {
      const root = rootRef.current;
      const blk = targetBlock();
      if (root && blk) handleEnter(blk, root);
    },
    getContext() {
      const root = rootRef.current;
      const blk = root && (currentBlock(root) ||
        (lastBlkIdRef.current && root.querySelector(`[data-id="${lastBlkIdRef.current}"]`)));
      if (!blk) return { type: null, before: "", id: null, cast: [] };
      const inCaret = currentBlock(root) === blk;
      const text = blk.textContent.replace(/\u00a0/g, " ");
      return {
        type: blk.dataset.type,
        before: inCaret ? text.slice(0, caretOffset(blk)) : text,
        id: blk.dataset.id,
        cast: allCharacters(readBlocks(root)),
      };
    },
    setReadingBlock(id) {
      const root = rootRef.current;
      if (!root) return;
      root.querySelectorAll("[data-reading]").forEach((el) => delete el.dataset.reading);
      if (id) {
        const el = root.querySelector(`[data-id="${id}"]`);
        if (el) { el.dataset.reading = "1"; el.scrollIntoView({ behavior: "smooth", block: "center" }); }
      }
    },
    deleteBeforeCaret(n) {
      const root = rootRef.current;
      if (!root || !n) return;
      const blk = currentBlock(root);
      if (!blk) return;
      const t = blk.firstChild && blk.firstChild.nodeType === 3 ? blk.firstChild : null;
      if (!t) return;
      const end = Math.min(caretOffset(blk), t.length);
      const start = Math.max(0, end - n);
      if (start >= end) return;
      const sel = window.getSelection();
      const r = document.createRange();
      r.setStart(t, start); r.setEnd(t, end);
      sel.removeAllRanges(); sel.addRange(r);
      document.execCommand("delete");
      decorate();
      sync();
    },
  }));

  /* ---------------- normalize stray DOM the browser may create --------- */
  const normalize = (root) => {
    if (!root.children.length) root.appendChild(makeBlk("heading", ""));
    Array.from(root.childNodes).forEach((n) => {
      if (n.nodeType === 3) {
        // bare text node: wrap it
        const d = makeBlk("action", n.textContent);
        root.replaceChild(d, n);
        return;
      }
      if (n.nodeType !== 1) { n.remove(); return; }
      if (n.classList.contains("dual")) {
        const cols = Array.from(n.children).filter((c) => c.classList.contains("dual-col"));
        if (cols.length !== 2 || cols.every((c) => !c.children.length)) {
          // collapse a broken dual back into plain blocks
          const kids = Array.from(n.querySelectorAll(".blk"));
          kids.forEach((k) => root.insertBefore(k, n));
          n.remove();
        }
        return;
      }
      if (!n.classList.contains("blk")) {
        const type = n.dataset && n.dataset.type ? n.dataset.type : "action";
        const d = makeBlk(type, n.textContent);
        root.replaceChild(d, n);
        return;
      }
      if (!n.dataset.id) n.dataset.id = uid();
      if (!n.dataset.type) n.dataset.type = "action";
      // strip pasted markup: keep text only (skip if it would nuke the caret needlessly)
      if (n.querySelector("*:not(br)")) n.textContent = n.textContent;
      if (!n.textContent.length && !n.querySelector("br")) n.innerHTML = "<br>";
    });
  };

  /* ---------------- autocomplete ---------------- */
  const closeMenu = () => setMenu(null);

  const openMenuFor = useCallback((blk) => {
    const root = rootRef.current;
    if (!root || !blk || blk.dataset.type !== "character") { closeMenu(); return; }
    const list = readBlocks(root);
    const idx = Array.from(root.querySelectorAll(".blk")).indexOf(blk);
    const raw = blk.textContent.toUpperCase();
    let items = [];

    const paren = raw.match(/^(.*?)(\([A-Z.' -]*)$/);
    if (paren) {
      const [, base, frag] = paren;
      items = CHAR_EXTENSIONS.filter((x) => x.startsWith(frag) && x !== frag).map((x) => base + x);
    } else if (!raw.trim()) {
      items = priorSpeakers(list, idx);
    } else {
      items = allCharacters(list).filter((n) => n.startsWith(raw.trim()) && n !== raw.trim());
    }
    items = items.slice(0, 5);
    if (!items.length) { closeMenu(); return; }
    setMenu({
      items, index: 0, interacted: false, blkId: blk.dataset.id,
      top: blk.offsetTop + blk.offsetHeight,
      left: blk.offsetLeft,
    });
  }, []);

  const acceptMenu = (item) => {
    const root = rootRef.current;
    const blk = root && root.querySelector(`[data-id="${menu.blkId}"]`);
    if (blk) { setBlockText(blk, item); setCaret(blk, "end"); }
    closeMenu();
    suppressRef.current = Date.now();
    sync(true);
  };

  /* The menu follows the caret. Whenever it lands on a character line, the prior
     speakers show up, no matter how it got there (Enter, Tab, click, arrow). */
  const suppressRef = useRef(0);
  useEffect(() => {
    let raf = null;
    const onSelChange = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const root = rootRef.current;
        if (!root || !root.isConnected) return;
        if (Date.now() - suppressRef.current < 250) return; // just accepted a suggestion
        const sel = window.getSelection();
        if (!sel || !sel.rangeCount || !sel.isCollapsed) { closeMenu(); return; }
        if (!root.contains(sel.anchorNode)) return;
        const blk = blockOf(sel.anchorNode, root);
        if (blk) {
          lastBlkIdRef.current = blk.dataset.id;
          setCaretType(blk.dataset.type);
          setCaretDual(isInDual(blk));
          if (caretCbRef.current) caretCbRef.current(blk.dataset.id, blk.dataset.type);
        }
        if (blk && blk.dataset.type === "character") openMenuFor(blk);
        else closeMenu();
      });
    };
    document.addEventListener("selectionchange", onSelChange);
    return () => { document.removeEventListener("selectionchange", onSelChange); if (raf) cancelAnimationFrame(raf); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------- mobile element bar ---------------- */
  /* The visual viewport shrinks to the space above the software keyboard, so
     its bottom edge is where the bar has to sit. */
  useEffect(() => {
    const vv = window.visualViewport;
    if (!coarse || !vv) return;
    const measure = () => setKbTop(Math.max(0, window.innerHeight - vv.height - vv.offsetTop));
    vv.addEventListener("resize", measure);
    vv.addEventListener("scroll", measure);
    measure();
    return () => { vv.removeEventListener("resize", measure); vv.removeEventListener("scroll", measure); };
  }, [coarse]);

  /* Safari scrolls the caret clear of the keyboard but knows nothing of the bar. */
  const barVisible = coarse && editing;
  useEffect(() => {
    if (!barVisible) return;
    const t = setTimeout(() => {
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount) return;
      const scroller = scrollParent(rootRef.current);
      if (!scroller) return;
      const caret = sel.getRangeAt(0).getBoundingClientRect();
      if (!caret.height && !caret.top) return; // collapsed range in an empty block
      const barH = barRef.current ? barRef.current.offsetHeight : 44;
      const floor = (window.visualViewport ? window.visualViewport.height : window.innerHeight) - barH - 12;
      if (caret.bottom > floor) scroller.scrollTop += caret.bottom - floor;
    }, 60);
    return () => clearTimeout(t);
  }, [barVisible, caretType, kbTop, menu]);

  /* Tapping the bar must not blur the editor. Preventing mousedown's default
     suppresses the focus change on both desktop and iOS, so the caret stays put
     and applyType still has a block to act on. */
  const applyType = (type) => {
    const root = rootRef.current;
    if (!root) return;
    const blk =
      currentBlock(root) ||
      (lastBlkIdRef.current && root.querySelector(`[data-id="${lastBlkIdRef.current}"]`));
    if (!blk) return;
    setType(blk, type);
    setCaretType(type);
    if (!currentBlock(root)) setCaret(blk, "end");
    if (type === "character") openMenuFor(blk);
    else closeMenu();
    sync(true);
  };

  /* ---------------- dual dialogue toggle (Cmd/Ctrl+D) ---------------- */
  const toggleDual = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const blk = currentBlock(root);
    if (!blk) return;
    const list = readBlocks(root);
    const idx = Array.from(root.querySelectorAll(".blk")).indexOf(blk);
    const b = list[idx];
    if (!b) return;
    if (b.pairId) {
      commit(unpair(list, b.pairId), { id: b.id, offset: caretOffset(blk) });
      return;
    }
    /* find the character block that starts this speech */
    let ci = idx;
    while (ci >= 0 && list[ci].type !== "character") {
      if (list[ci].type !== "dialogue" && list[ci].type !== "parenthetical") { ci = -1; break; }
      ci--;
    }
    if (ci < 0 || !canPairAt(list, ci)) return;
    commit(pairAt(list, ci), { id: b.id, offset: caretOffset(blk) });
  }, [commit]);

  /* ---------------- keys ---------------- */
  const onKeyDown = (e) => {
    const root = rootRef.current;
    if (!root) return;

    /* menu navigation first */
    if (menu) {
      if (e.key === "ArrowDown") { e.preventDefault(); setMenu((m) => ({ ...m, index: (m.index + 1) % m.items.length, interacted: true })); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setMenu((m) => ({ ...m, index: (m.index - 1 + m.items.length) % m.items.length, interacted: true })); return; }
      if (e.key === "Escape") { e.preventDefault(); closeMenu(); return; }
      if (e.key === "Tab") { e.preventDefault(); acceptMenu(menu.items[menu.index]); return; }
      if (e.key === "Enter") {
        const blk = currentBlock(root);
        /* Enter on an untouched empty suggestion means "no name" -> fall through,
           so a second Enter turns the line into action, like Final Draft. */
        if (blk && (blk.textContent.trim() || menu.interacted)) {
          e.preventDefault();
          acceptMenu(menu.items[menu.index]);
          return;
        }
        closeMenu();
      }
    }

    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "d") {
      e.preventDefault();
      toggleDual();
      return;
    }

    if (e.key === "Tab") {
      e.preventDefault();
      const blk = currentBlock(root);
      if (!blk) return;
      const dir = e.shiftKey ? -1 : 1;
      const i = TYPE_CYCLE.indexOf(blk.dataset.type);
      setType(blk, TYPE_CYCLE[(i + dir + TYPE_CYCLE.length) % TYPE_CYCLE.length]);
      sync(true);
      return;
    }

    if (e.key === "Enter" && !e.shiftKey) {
      const blk = currentBlock(root);
      if (!blk) return;
      e.preventDefault();
      handleEnter(blk, root);
      return;
    }
  };

  const handleEnter = (blk, root) => {
    const type = blk.dataset.type;
    const text = blk.textContent;
    const empty = !text.trim();

    /* empty line inside a dual block: step out of the block entirely */
    if (empty && isInDual(blk)) {
      const dual = blk.parentNode.parentNode;
      blk.remove();
      const nb = makeBlk("action", "");
      dual.after(nb);
      setCaret(nb, "start");
      sync(true);
      return;
    }

    /* empty non-action line: become action (the double-Enter flow) */
    if (empty && type !== "action") {
      setType(blk, "action");
      closeMenu();
      sync(true);
      return;
    }

    /* an action line that reads like a slugline becomes one */
    if (type === "action" && HEADING_RE.test(text.trim())) {
      setType(blk, "heading");
      const nb = makeBlk("action", "");
      blk.after(nb);
      setCaret(nb, "start");
      sync(true);
      return;
    }

    /* otherwise: split at the caret and start the next element */
    const pos = caretOffset(blk);
    const before = text.slice(0, pos);
    const after = text.slice(pos);
    setBlockText(blk, before);

    const nextType = NEXT_TYPE[type] || "action";
    const nb = makeBlk(nextType, after);

    if (isInDual(blk)) {
      const col = blk.parentNode;
      const isRightCol = col.dataset.side === "right";
      const isLast = blk === col.lastElementChild;
      if (isRightCol && isLast && !after) {
        /* finishing the right column exits dual dialogue */
        col.parentNode.after(nb);
      } else {
        blk.after(nb);
      }
    } else {
      blk.after(nb);
    }

    setCaret(nb, "start");
    sync(true);
  };

  /* ---------------- input / paste / click ---------------- */
  const onInput = () => {
    const root = rootRef.current;
    const blk = currentBlock(root);
    if (blk && blk.dataset.type === "character") openMenuFor(blk);
    else closeMenu();
    decorate();
    sync();
  };

  const onPaste = (e) => {
    const text = e.clipboardData && e.clipboardData.getData("text/plain");
    if (!text) return;
    e.preventDefault();
    const root = rootRef.current;
    const blk = currentBlock(root);
    if (!blk) return;

    if (!text.includes("\n")) {
      document.execCommand("insertText", false, text);
      sync();
      return;
    }
    /* multi-line: parse into real screenplay elements and splice them in */
    let parsed;
    try { parsed = parseScriptText(text); } catch { return; }
    const list = readBlocks(root);
    const idx = Array.from(root.querySelectorAll(".blk")).indexOf(blk);
    const cur = list[idx];
    const head = cur && cur.text.trim() ? [cur] : [];
    const next = [...list.slice(0, idx), ...head, ...parsed, ...list.slice(idx + 1)];
    commit(next, { id: parsed[parsed.length - 1].id, offset: "end" });
  };

  const onMouseUp = () => {
    const root = rootRef.current;
    const blk = currentBlock(root);
    if (blk && onCaretBlock) onCaretBlock(blk.dataset.id, blk.dataset.type);
    if (!blk || blk.dataset.type !== "character") closeMenu();
  };

  const onBlur = () => setTimeout(() => { closeMenu(); setEditing(false); }, 150);

  return (
    <div className="editor-host">
      <div
        ref={rootRef}
        className="page-body"
        contentEditable
        suppressContentEditableWarning
        spellCheck
        onKeyDown={onKeyDown}
        onInput={onInput}
        onPaste={onPaste}
        onMouseUp={onMouseUp}
        onFocus={() => setEditing(true)}
        onBlur={onBlur}
      />
      {menu && (
        <div className="ac-menu" style={{ top: menu.top, left: menu.left }}>
          {menu.items.map((it, i) => (
            <div
              key={it}
              className={`ac-item${i === menu.index ? " active" : ""}`}
              onMouseDown={(e) => { e.preventDefault(); acceptMenu(it); }}
            >
              {it}
            </div>
          ))}
        </div>
      )}

      {/* dictation preview: interim words + command echo, docked above the
          element bar (or the keyboard, or the window bottom on desktop) */}
      {dict && dict.state !== "idle" && (
        <div
          className={`dict-bar${night ? " night" : ""}${dict.state !== "listening" ? " err" : ""}`}
          style={{ bottom: barVisible ? kbTop + ((barRef.current && barRef.current.offsetHeight) || 44) : coarse ? kbTop : 0 }}
        >
          {dict.state === "denied" && <span>Enable mic access in your browser settings to dictate.</span>}
          {dict.state === "network" && <span>Dictation needs a connection — speech is recognized server-side.</span>}
          {dict.state === "listening" && (
            <>
              <span className="dict-dot" aria-hidden="true" />
              {dict.echo && <span className="dict-echo">{dict.echo}</span>}
              <span className="dict-interim">{dict.interim || (dict.echo ? "" : "Listening…")}</span>
            </>
          )}
        </div>
      )}

      {barVisible && (
        <div className={`mbar${night ? " night" : ""}`} ref={barRef} style={{ bottom: kbTop }}>
          {menu && (
            <div className="mbar-row mbar-sugg">
              {menu.items.map((it) => (
                <button
                  key={it}
                  type="button"
                  className="mbar-chip"
                  onMouseDown={(e) => { e.preventDefault(); acceptMenu(it); }}
                >
                  {it}
                </button>
              ))}
            </div>
          )}
          <div className="mbar-row mbar-types">
            {dict && dict.supported && (
              <button
                type="button"
                className={`mbar-btn mbar-mic${dict.state === "listening" ? " on live" : ""}`}
                title={dict.state === "listening" ? "Stop dictation" : "Dictate"}
                onMouseDown={(e) => e.preventDefault() /* keep the caret */}
                onClick={dict.toggle /* click = certain user activation for rec.start() */}
              >
                🎙
              </button>
            )}
            {BAR_TYPES.map(([type, label]) => (
              <button
                key={type}
                type="button"
                className={`mbar-btn${caretType === type ? " on" : ""}`}
                onMouseDown={(e) => { e.preventDefault(); applyType(type); }}
              >
                {label}
              </button>
            ))}
            <button
              type="button"
              className={`mbar-btn mbar-dual${caretDual ? " on" : ""}`}
              title="Dual dialogue"
              onMouseDown={(e) => { e.preventDefault(); toggleDual(); }}
            >
              Dual
            </button>
          </div>
        </div>
      )}
    </div>
  );
});

export default ScriptEditor;
