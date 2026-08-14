import { useEffect, useMemo, useRef, useState } from "react";
import { buildHTML, migrateDoc } from "./engine.js";
import { openShare, trackReading } from "./share.js";
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

  const load = async (pass) => {
    setBusy(true);
    try {
      const res = await openShare(id, pass);
      if (res.needsPassword) {
        setState({ phase: "locked", wrong: pass !== undefined });
        return;
      }
      setState({ phase: "ready", doc: migrateDoc(res.doc), title: res.title });
    } catch (e) {
      setState({ phase: "error", message: e.message });
    } finally {
      setBusy(false);
    }
  };

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
            <button className="share-print" onClick={() => window.print()}>Print / save as PDF</button>
          </div>
          <div className="share-scroll">
            <div className="page" ref={pageRef}>
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
          </div>
        </>
      )}
    </div>
  );
}
