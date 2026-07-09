import React from "react";

/* ============================================================================
   A throw during render unmounts the whole tree, leaving a blank page and no
   clue what happened. Catch it and say so instead.

   The app's <style> tag lives inside Screenwriter, so it is gone by the time
   this renders. Everything here is inline on purpose.
   ==========================================================================*/

const wrap = {
  position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
  padding: 24, background: "#EEF0EF", color: "#1C1F1E",
  fontFamily: "'Jost', 'Century Gothic', system-ui, sans-serif",
};
const card = {
  maxWidth: 520, width: "100%", background: "#fff", border: "1px solid #E1E3E1",
  borderRadius: 10, padding: 24, boxShadow: "0 10px 30px rgba(20,20,15,.14)",
};
const h = { margin: "0 0 10px", fontSize: 16, fontWeight: 600 };
const p = { margin: "0 0 16px", fontSize: 13, lineHeight: 1.6, color: "#6B716F" };
const pre = {
  margin: "0 0 16px", padding: "10px 12px", background: "#F4F5F4", border: "1px solid #E1E3E1",
  borderRadius: 6, fontSize: 11, lineHeight: 1.5, color: "#B4453B",
  whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 160, overflowY: "auto",
};
const btn = {
  background: "#2C4A73", color: "#fff", border: "none", borderRadius: 6,
  padding: "9px 16px", fontSize: 12, fontWeight: 600, cursor: "pointer", font: "inherit",
};

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("Screenwriter crashed:", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div style={wrap}>
        <div style={card}>
          <h1 style={h}>Something broke.</h1>
          <p style={p}>
            Your script is saved. Reloading should pick it up where it left off — at most the
            last second of typing is lost.
          </p>
          <pre style={pre}>{String((error && error.stack) || error)}</pre>
          <button style={btn} onClick={() => window.location.reload()}>Reload</button>
        </div>
      </div>
    );
  }
}
