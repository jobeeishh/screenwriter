import { useEffect, useMemo, useRef, useState } from "react";
import { buildHTML, migrateDoc, plainText } from "./engine.js";
import { openShare, trackReading, addComment, readerName, setReaderName } from "./share.js";
import { CSS } from "./styles.js";

/* ============================================================================
   The read-only end of a share link: /s/<id>.

   Deliberately not the editor. It renders the same buildHTML output under the
   same page CSS, so what the reader sees is what would print -- but nothing is
   editable, nothing syncs, and the reader never learns the project exists.
   ==========================================================================*/

export default function ShareView({ id }) {
  const [state, setState] = useState({ phase: "loading" });
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const pageRef = useRef(null);

  /* notes: what's on the page, which line is being annotated, and the draft */
  const [notes, setNotes] = useState([]);
  const [openOn, setOpenOn] = useState(null); // blockId being commented on
  const [draft, setDraft] = useState("");
  const [name, setName] = useState(readerName);
  const [posting, setPosting] = useState(false);
  const passRef = useRef(undefined); // replayed when posting a note

  const load = async (pass) => {
    setBusy(true);
    try {
      const res = await openShare(id, pass);
      if (res.needsPassword) {
        setState({ phase: "locked", wrong: pass !== undefined });
        return;
      }
      passRef.current = pass;
      setNotes(res.notes || []);
      setState({
        phase: "ready", doc: migrateDoc(res.doc), title: res.title, comments: !!res.comments,
      });
    } catch (e) {
      setState({ phase: "error", message: e.message });
    } finally {
      setBusy(false);
    }
  };

  const post = async () => {
    if (!draft.trim() || !openOn) return;
    setPosting(true);
    try {
      const c = await addComment(id, {
        blockId: openOn, text: draft, name, password: passRef.current,
      });
      setNotes((n) => [...n, c]);
      setReaderName(name);
      setDraft("");
      setOpenOn(null);
    } catch (e) {
      setState((s) => ({ ...s, noteError: e.message }));
    } finally {
      setPosting(false);
    }
  };

  /* Notes hang off block ids, so they survive the writer republishing as long
     as the line itself survives. A note on a deleted line simply stops showing. */
  const byBlock = useMemo(() => {
    const m = new Map();
    notes.forEach((n) => {
      if (!m.has(n.blockId)) m.set(n.blockId, []);
      m.get(n.blockId).push(n);
    });
    return m;
  }, [notes]);

  useEffect(() => { load(undefined); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [id]);

  /* only count a read once there is something to read */
  useEffect(() => {
    if (state.phase !== "ready") return;
    return trackReading(id);
  }, [state.phase, id]);

  const html = useMemo(
    () => (state.phase === "ready" ? buildHTML(state.doc.blocks || []) : ""),
    [state.phase, state.doc]
  );

  useEffect(() => {
    if (state.phase === "ready") document.title = state.title || "Script";
  }, [state.phase, state.title]);

  /* Which lines carry notes is a decoration, same as scene numbers: a data
     attribute set from the model, never woven into the rendered text. */
  useEffect(() => {
    const page = pageRef.current;
    if (!page) return;
    page.querySelectorAll(".blk").forEach((el) => {
      const n = byBlock.get(el.dataset.id);
      if (n) el.dataset.notes = String(n.length);
      else if (el.dataset.notes) delete el.dataset.notes;
      el.classList.toggle("is-open", el.dataset.id === openOn);
    });
  }, [byBlock, openOn, html]);

  const onPageClick = (e) => {
    if (state.phase !== "ready" || !state.comments) return;
    const blk = e.target.closest && e.target.closest(".blk");
    if (!blk || !blk.dataset.id) return;
    setOpenOn((cur) => (cur === blk.dataset.id ? null : blk.dataset.id));
    setState((s) => ({ ...s, noteError: null }));
  };

  const quoted = () => {
    const b = (state.doc && state.doc.blocks || []).find((x) => x.id === openOn);
    const t = b ? plainText(b.text).trim() : "";
    return t.length > 60 ? t.slice(0, 60) + "…" : t || "this line";
  };

  const jumpTo = (blockId) => {
    const el = pageRef.current && pageRef.current.querySelector(`[data-id="${blockId}"]`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    setOpenOn(blockId);
  };

  return (
    <div className="sw-root share-root">
      <style>{CSS}</style>

      {state.phase === "loading" && <div className="share-msg">Opening…</div>}

      {state.phase === "error" && (
        <div className="share-msg">
          <h1>Not available</h1>
          <p>{state.message}</p>
        </div>
      )}

      {state.phase === "locked" && (
        <form
          className="share-msg"
          onSubmit={(e) => { e.preventDefault(); load(password); }}
        >
          <h1>This script is password protected</h1>
          <p>Ask whoever sent you the link for the password.</p>
          <input
            className="theme-input"
            type="password"
            value={password}
            autoFocus
            placeholder="Password"
            onChange={(e) => setPassword(e.target.value)}
          />
          {state.wrong && <p className="share-wrong">That password didn't work.</p>}
          <button className="share-open" type="submit" disabled={busy || !password}>
            {busy ? "Checking…" : "Open script"}
          </button>
        </form>
      )}

      {state.phase === "ready" && (
        <>
          <div className="share-bar">
            <span className="share-title">{state.title}</span>
            <span className="share-bar-right">
              {state.comments && (
                <span className="share-notes-count">
                  {notes.length === 0 ? "Click any line to leave a note" :
                    `${notes.length} note${notes.length === 1 ? "" : "s"}`}
                </span>
              )}
              <button className="share-print" onClick={() => window.print()}>Print / save as PDF</button>
            </span>
          </div>
          <div className={`share-scroll${state.comments ? " share-commentable" : ""}`}>
            <div className="page" ref={pageRef} onClick={onPageClick}>
              {state.doc.titlePage && (state.doc.titlePage.byline || state.doc.titlePage.contact) ? (
                <div className="print-title-page" aria-hidden="true">
                  <div className="ptp-center">
                    <div className="ptp-title">{(state.doc.title || "").toUpperCase()}</div>
                    {state.doc.titlePage.byline && (
                      <>
                        <div className="ptp-by">Written by</div>
                        <div className="ptp-byline">{state.doc.titlePage.byline}</div>
                      </>
                    )}
                  </div>
                  {state.doc.titlePage.contact && <div className="ptp-contact">{state.doc.titlePage.contact}</div>}
                </div>
              ) : null}
              {/* read-only: the same markup the editor renders, without contenteditable */}
              <div className="page-body" dangerouslySetInnerHTML={{ __html: html }} />
            </div>

            {state.comments && notes.length > 0 && (
              <div className="note-list">
                <div className="note-list-head">Notes</div>
                {notes.map((n) => (
                  <button key={n.id} className="note-item" onClick={() => jumpTo(n.blockId)}>
                    <span className="note-who">{n.name}</span>
                    <span className="note-text">{n.text}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {state.comments && openOn && (
            <div className="note-composer">
              <div className="note-on">Note on “{quoted()}”</div>
              {(byBlock.get(openOn) || []).map((n) => (
                <div className="note-existing" key={n.id}>
                  <span className="note-who">{n.name}</span> {n.text}
                </div>
              ))}
              <div className="note-fields">
                <input
                  className="note-name" value={name} placeholder="Your name"
                  onChange={(e) => setName(e.target.value)}
                />
                <textarea
                  className="note-text-input" value={draft} rows={2} autoFocus
                  placeholder="What did you think?"
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); post(); }
                    if (e.key === "Escape") { e.preventDefault(); setOpenOn(null); }
                  }}
                />
              </div>
              {state.noteError && <div className="note-error">{state.noteError}</div>}
              <div className="note-actions">
                <button className="note-cancel" onClick={() => { setOpenOn(null); setDraft(""); }}>Cancel</button>
                <button className="note-send" onClick={post} disabled={posting || !draft.trim()}>
                  {posting ? "Sending…" : "Leave note"}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
