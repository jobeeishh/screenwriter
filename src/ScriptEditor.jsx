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

/* =========================================================================== */
const ScriptEditor = forwardRef(function ScriptEditor(
  { blocks, version, onChange, onCaretBlock, night },
  ref
) {
  const rootRef = useRef(null);
  const [menu, setMenu] = useState(null); // { items, index, top, left, blkId, interacted }
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;
  const syncTimer = useRef(null);
  const restoreRef = useRef(null); // { id, offset } to restore after a version bump

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

  useImperativeHandle(ref, () => ({
    focusBlock(id) {
      const root = rootRef.current;
      if (!root) return;
      const el = root.querySelector(`[data-id="${id}"]`);
      if (el) { el.scrollIntoView({ behavior: "smooth", block: "center" }); setCaret(el, "end"); }
    },
    toggleDual,
    root: () => rootRef.current,
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
    if (nextType === "character") setTimeout(() => openMenuFor(nb), 0);
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

  const onBlur = () => setTimeout(closeMenu, 150);

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
    </div>
  );
});

export default ScriptEditor;
