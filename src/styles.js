export const CSS = `
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
  --topbar-h: 52px;

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
  align-items: center; padding: 0 14px; gap: 12px;
  background: var(--panel); border-bottom: 1px solid var(--line);
  position: relative; z-index: 5;
}
.tb-left, .tb-right { display: flex; align-items: center; gap: 6px; min-width: 0; }
.tb-left { justify-self: start; }
.tb-right { justify-self: end; }
.title-input {
  background: transparent; border: none; outline: none; color: var(--text);
  font-size: 12px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase;
  width: 170px; padding: 6px 4px; border-radius: 4px;
}
.title-input:focus { background: var(--panel2); }

.theme-strip {
  display: flex; align-items: center; gap: 10px; width: 100%;
  padding: 5px 14px; background: var(--panel2);
  border: 1px solid var(--line); border-radius: 999px;
  transition: background .2s, border-color .2s, box-shadow .2s;
}
.theme-strip.filled { background: var(--panel); border-color: var(--accent); box-shadow: 0 1px 3px rgba(44,74,115,.10); }
.theme-label { font-size: 9px; font-weight: 600; letter-spacing: 0.22em; text-transform: uppercase; color: var(--accent); flex: 0 0 auto; }
.theme-input {
  background: transparent; border: none; outline: none; width: 100%; color: var(--text);
  font-family: 'Courier Prime', monospace; font-style: italic; font-size: 13px;
  transition: font-weight .15s;
}
.theme-strip.filled .theme-input { font-style: normal; font-weight: 700; letter-spacing: 0.01em; }
.theme-input::placeholder { color: var(--faint); font-style: italic; }

.icon-btn {
  display: flex; align-items: center; justify-content: center;
  width: 30px; height: 30px; border-radius: 6px;
  background: transparent; border: 1px solid transparent; color: var(--dim);
  transition: all .15s; position: relative;
}
.icon-btn:hover { color: var(--text); background: var(--panel2); }
.icon-btn.on { color: var(--accent); border-color: var(--line); background: var(--panel2); }
.icon-btn.warn-badge::after {
  content: ""; position: absolute; top: 4px; right: 4px;
  width: 6px; height: 6px; border-radius: 50%; background: #B4453B;
}
.icon-btn:focus-visible, .export-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }

.export-btn {
  display: flex; align-items: center; gap: 6px; padding: 6px 12px;
  border-radius: 6px; border: none; background: var(--accent); color: #fff;
  font-size: 12px; font-weight: 600;
}
.export-btn:hover { filter: brightness(1.08); }

.page-est { font-size: 10px; color: var(--faint); }
.save-dot { display: flex; align-items: center; gap: 5px; font-size: 10px; letter-spacing: 0.06em; color: var(--faint); }
.save-dot.saved svg { color: #3E7A52; }
.save-dot.saving svg { color: var(--accent2); }
.sync-warn { font-size: 10px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: #B4453B; }
.streak-chip { display: flex; align-items: center; gap: 3px; font-size: 11px; font-weight: 600; color: #C46A2B; }
.pomo-chip {
  display: flex; align-items: center; gap: 5px; padding: 4px 9px; border-radius: 999px;
  font-size: 11px; font-weight: 600; cursor: pointer; user-select: none;
}
.pomo-chip.work { background: rgba(44,74,115,.1); color: var(--accent); border: 1px solid rgba(44,74,115,.3); }
.pomo-chip.break { background: rgba(62,122,82,.1); color: #3E7A52; border: 1px solid rgba(62,122,82,.3); }
.pomo-chip.paused { opacity: .55; }
.pomo-x { opacity: .6; }

/* ---- popovers ---- */
.pop-wrap { position: relative; }
.pop-panel {
  position: absolute; top: 38px; right: 0; z-index: 20; width: 280px;
  background: var(--panel); border: 1px solid var(--line); border-radius: 10px;
  box-shadow: 0 10px 30px rgba(20,20,15,.14); padding: 14px;
}
.pop-title { font-size: 12px; font-weight: 600; margin-bottom: 8px; }
.pop-label { display: block; font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: var(--faint); margin: 8px 0 3px; }
.pop-input { width: 100%; background: var(--panel2); border: 1px solid var(--line); border-radius: 6px; padding: 7px 9px; font-size: 12px; color: var(--text); outline: none; }
.pop-input:focus { border-color: var(--faint); }
.pop-error { font-size: 11px; color: #B4453B; margin-top: 8px; }
.pop-meta { font-size: 11px; color: var(--dim); word-break: break-all; margin-bottom: 6px; }
.pop-status { font-size: 11px; color: var(--faint); margin-bottom: 10px; }
.pop-hint { font-size: 11px; color: var(--faint); line-height: 1.5; margin-top: 8px; }
.pop-btn { width: 100%; margin-top: 10px; background: var(--accent); color: #fff; border: none; border-radius: 6px; padding: 8px; font-size: 12px; font-weight: 600; }
.pop-btn:disabled { opacity: .6; }
.pop-row { display: flex; gap: 8px; }
.pop-row .pop-btn { margin-top: 0; }
.pop-btn.secondary { background: var(--panel2); color: var(--text); border: 1px solid var(--line); }
.pop-btn.secondary.danger:hover { color: #B4453B; border-color: #B4453B; }
.menu-item { display: flex; align-items: center; gap: 9px; width: 100%; padding: 8px 9px; background: transparent; border: none; border-radius: 6px; font-size: 12px; color: var(--text); text-align: left; }
.menu-item:hover { background: var(--panel2); }
.ver-list { margin-top: 10px; max-height: 240px; overflow-y: auto; }
.ver-row { display: flex; align-items: center; gap: 6px; padding: 6px 2px; border-top: 1px solid var(--line); }
.ver-info { flex: 1; min-width: 0; }
.ver-name { font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ver-date { font-size: 10px; color: var(--faint); }

/* ---- layout ---- */
.body { flex: 1; display: flex; min-height: 0; }
.side { background: var(--panel); display: flex; flex-direction: column; min-height: 0; }
.projects, .board { width: 268px; flex: 0 0 268px; border-right: 1px solid var(--line); }
.chars { width: 300px; flex: 0 0 300px; border-left: 1px solid var(--line); }
.treatment { width: 320px; flex: 0 0 320px; border-left: 1px solid var(--line); }
.treatment.wide { width: 560px; flex-basis: 560px; }
.side-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 14px 8px; font-size: 10px; font-weight: 600;
  letter-spacing: .2em; text-transform: uppercase; color: var(--dim);
}
.head-actions { display: flex; gap: 6px; align-items: center; }
.side-body { flex: 1; overflow-y: auto; padding: 4px 14px 24px; }
.side-note { padding: 10px 14px 16px; font-size: 11px; line-height: 1.5; color: var(--faint); border-top: 1px solid var(--line); }
.mini-btn { display: flex; align-items: center; gap: 4px; background: transparent; border: 1px solid var(--line); border-radius: 5px; color: var(--dim); font-size: 11px; padding: 3px 8px; }
.mini-btn:hover { color: var(--text); border-color: var(--faint); }
.ghost { background: transparent; border: none; color: var(--faint); padding: 2px; border-radius: 4px; display: flex; align-items: center; }
.ghost:hover { color: var(--text); }
.ghost.danger:hover { color: #B4453B; }

/* ---- board ---- */
.cards { flex: 1; overflow-y: auto; padding: 2px 10px 24px; }
.act-row { display: flex; align-items: center; gap: 6px; color: var(--accent2); margin: 14px 4px 6px; }
.act-input { background: transparent; border: none; outline: none; color: var(--accent2); font-size: 10px; font-weight: 600; letter-spacing: .24em; text-transform: uppercase; width: 100%; }
.act-del { opacity: 0; margin-left: auto; }
.act-row:hover .act-del { opacity: 1; }
.card { background: var(--panel2); border: 1px solid var(--line); border-radius: 8px; padding: 9px 10px 8px; margin-bottom: 8px; cursor: grab; transition: border-color .15s, opacity .15s; }
.card:hover { border-color: var(--faint); }
.card.dragging { opacity: .35; }
.card.over { border-top: 2px solid var(--accent); }
.card.selected { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent) inset; }
.drop-end { height: 28px; border-radius: 6px; }
.drop-end.over { border-top: 2px solid var(--accent); }
.card-top { display: flex; align-items: center; gap: 7px; }
.card-num { font-size: 9px; color: var(--faint); flex: 0 0 auto; }
.card-heading { font-size: 11px; font-weight: 500; text-transform: uppercase; letter-spacing: .03em; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.card-actions { display: none; gap: 2px; flex: 0 0 auto; }
.card:hover .card-actions, .project-card:hover .card-actions { display: flex; }
.card-note { display: block; width: 100%; margin-top: 5px; background: transparent; border: none; outline: none; font-size: 11px; color: var(--dim); line-height: 1.45; }
.card-note::placeholder { color: var(--faint); }
.scene-check { display: flex; align-items: center; background: transparent; border: none; padding: 0; color: var(--faint); flex: 0 0 auto; }
.scene-check.done { color: #3E7A52; }
.card:has(.scene-check.done) .card-heading { color: var(--faint); }
.scene-progress { color: var(--accent); margin-left: 4px; }

.board.full { position: absolute; z-index: 6; inset: 0; width: 100%; flex-basis: 100%; border-right: none; }
.board.full .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 10px; align-content: start; padding: 6px 18px 40px; }
.board.full .card-slot { display: contents; }
.board.full .act-row { grid-column: 1 / -1; margin: 12px 4px 0; }
.board.full .card { margin-bottom: 0; }
.board.full .drop-end { grid-column: 1 / -1; }

/* ---- projects ---- */
.project-card { background: var(--panel2); border: 1px solid var(--line); border-radius: 8px; padding: 9px 10px 8px; margin-bottom: 8px; cursor: pointer; }
.project-card:hover { border-color: var(--faint); }
.project-card.active { border-color: var(--accent); }
.project-title { flex: 1; font-size: 13px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.project-meta { margin-top: 4px; font-size: 10px; letter-spacing: .04em; text-transform: uppercase; color: var(--faint); }
.project-card.active .project-meta { color: var(--accent); }

/* ---- the page ---- */
.editor-scroll { flex: 1; overflow-y: auto; min-width: 0; position: relative; }
.page {
  position: relative;
  background: var(--paper); color: var(--ink);
  width: min(816px, calc(100% - 48px));
  margin: 28px auto 80px;
  padding: 0.9in 1in 1.2in 1.5in;
  border-radius: 3px;
  box-shadow: 0 1px 2px rgba(20,20,15,.08), 0 12px 32px rgba(20,20,15,.10);
  font-family: 'Courier Prime', monospace;
  font-size: 15px; line-height: 1.15;
  min-height: 70vh;
}
.line-probe { position: absolute; top: 0; left: 0; visibility: hidden; pointer-events: none; font-family: 'Courier Prime', monospace; font-size: 15px; line-height: 1.15; }
.editor-host { position: relative; }
.page-body { outline: none; }
.page-body:focus { outline: none; }

/* ---- screenplay blocks (inside one contenteditable) ---- */
.blk { position: relative; white-space: pre-wrap; word-wrap: break-word; min-height: 1.15em; }
.blk.heading {
  margin-top: 30px; font-weight: 700; text-transform: uppercase;
}
.blk.heading::before {
  content: attr(data-num);
  position: absolute; left: -0.7in; width: 0.45in; text-align: right;
  font-weight: 400; color: var(--ink-dim); font-size: 11px; top: 3px;
  user-select: none; pointer-events: none;
}
.blk.action { margin-top: 14px; }
.blk.character {
  margin-top: 14px; margin-left: 2.2in; text-transform: uppercase;
}
.blk.character::after {
  content: attr(data-contd);
  color: var(--ink-dim); padding-left: 8px;
  user-select: none; pointer-events: none;
}
.blk.parenthetical { margin-left: 1.6in; width: 2.4in; color: #4A4A46; }
.blk.dialogue { margin-left: 1in; width: 3.5in; }
.blk.transition { margin-top: 14px; text-align: right; text-transform: uppercase; }
/* placeholders: an "empty" block holds a single <br>, so :empty won't match it */
.blk:has(> br:only-child)::before {
  color: #C6C4BA; font-weight: 400; text-transform: none;
  position: absolute; pointer-events: none; user-select: none;
}
.page-body > .blk.heading:has(> br:only-child)::before { content: "INT. LOCATION - DAY"; left: 0; width: auto; text-align: left; font-size: inherit; top: 0; }
.page-body > .blk.action:has(> br:only-child)::before { content: "Action"; }
.blk.character:has(> br:only-child)::before { content: "CHARACTER"; }
.blk.dialogue:has(> br:only-child)::before { content: "Dialogue"; }
.blk.parenthetical:has(> br:only-child)::before { content: "(beat)"; }

/* dual dialogue: two columns inside the same editable flow */
.dual { display: flex; gap: 0.35in; margin-top: 14px; }
.dual-col { flex: 1 1 0; min-width: 0; }
.dual-col .blk { margin-left: 0; width: 100%; margin-top: 0; }
.dual-col .blk + .blk { margin-top: 1px; }
.dual-col .blk.parenthetical { margin-left: 0.25in; width: calc(100% - 0.25in); }
.dual-col .blk.character::after { content: none; }

/* selection actually spans blocks now */
.page-body ::selection { background: rgba(44,74,115,.22); }
.sw-root.night .page-body ::selection { background: rgba(127,163,212,.3); }

/* ---- page breaks ---- */
.page-break { position: absolute; left: 0; right: 0; height: 0; border-top: 1px dashed #CFCDC2; pointer-events: none; }
.page-break-num { position: absolute; top: -7px; right: 0; background: var(--paper); padding-left: 8px; font-size: 11px; color: #9C9A90; }

/* ---- autocomplete ---- */
.ac-menu {
  position: absolute; z-index: 10; min-width: 2.2in;
  background: var(--panel); border: 1px solid var(--line); border-radius: 6px;
  box-shadow: 0 6px 18px rgba(20,20,15,.12); overflow: hidden;
}
.ac-item { padding: 5px 10px; font-family: 'Jost', sans-serif; font-size: 11px; letter-spacing: .05em; color: var(--text); cursor: pointer; }
.ac-item.active, .ac-item:hover { background: var(--panel2); color: var(--accent); }

.hint-bar {
  position: sticky; bottom: 0; width: 100%; text-align: center; padding: 8px 0 10px;
  font-size: 9px; letter-spacing: .1em; color: var(--faint);
  background: linear-gradient(transparent, var(--bg) 55%); pointer-events: none;
}

/* ---- treatment + characters ---- */
.treatment-editor { flex: 1; overflow-y: auto; outline: none; color: var(--text); padding: 4px 16px 16px; font-size: 13px; line-height: 1.6; }
.treatment-editor:empty::before { content: attr(data-placeholder); color: var(--faint); font-style: italic; }
.treatment-editor ul { padding-left: 20px; margin: 6px 0; }
.char-new { width: 100%; margin-bottom: 10px; background: var(--panel2); border: 1px solid var(--line); border-radius: 6px; color: var(--text); outline: none; font-size: 11px; text-transform: uppercase; padding: 7px 9px; }
.char-block { margin-bottom: 14px; }
.char-head { display: flex; align-items: center; gap: 8px; margin-bottom: 5px; }
.char-name { font-size: 11px; font-weight: 600; letter-spacing: .06em; flex: 1; }
.in-script { font-size: 8px; letter-spacing: .14em; text-transform: uppercase; color: var(--accent); border: 1px solid rgba(44,74,115,.3); border-radius: 999px; padding: 2px 7px; }
.char-note { width: 100%; resize: vertical; background: var(--panel2); border: 1px solid var(--line); border-radius: 6px; color: var(--text); outline: none; font-size: 12px; line-height: 1.5; padding: 8px 9px; }
.empty-note { font-size: 12px; color: var(--faint); line-height: 1.5; padding: 4px 2px; }

/* ---- scrollbars ---- */
.sw-root ::-webkit-scrollbar { width: 10px; }
.sw-root ::-webkit-scrollbar-thumb { background: var(--line); border-radius: 5px; border: 2px solid var(--panel); }
.editor-scroll::-webkit-scrollbar-thumb { border-color: var(--bg); }

/* ---- night ---- */
.sw-root.night {
  --bg: #141519; --panel: #1B1D23; --panel2: #22252C; --line: #2B2E36;
  --text: #E8E8E3; --dim: #8B8F99; --faint: #5A5E68;
  --accent: #7FA3D4; --accent2: #C9A25E;
  --paper: #1D1E22; --ink: #DDDDD6; --ink-dim: #5F605C;
}
.sw-root.night .page { box-shadow: 0 1px 2px rgba(0,0,0,.5), 0 12px 32px rgba(0,0,0,.4); }
.sw-root.night .blk.parenthetical { color: #96968E; }
.sw-root.night .page-break { border-top-color: #35363C; }
.sw-root.night .export-btn, .sw-root.night .pop-btn { color: #10131A; }

/* ---- print ---- */
.print-title-page { display: none; }
@media print {
  .topbar, .side, .hint-bar, .page-break, .ac-menu { display: none !important; }
  .sw-root { position: static; overflow: visible; background: #fff; }
  .body { display: block; }
  .editor-scroll { overflow: visible; }
  .page {
    box-shadow: none; border-radius: 0; width: 100%; margin: 0;
    padding: 1in 1in 1in 1.5in !important; min-height: 0;
    background: #fff; color: #000;
  }
  .blk.heading::before { display: none; }
  .print-title-page { display: flex !important; flex-direction: column; height: 8.6in; page-break-after: always; font-family: 'Courier Prime', monospace; color: #000; }
  .ptp-center { margin: auto; text-align: center; }
  .ptp-title { font-size: 15px; font-weight: 700; letter-spacing: .05em; }
  .ptp-by { margin-top: 28px; font-size: 14px; }
  .ptp-byline { margin-top: 10px; font-size: 14px; }
  .ptp-contact { font-size: 12px; white-space: pre-line; }
  @page { margin: 0; size: letter; }
}

/* ---- responsive ---- */
@media (max-width: 900px) {
  .page { padding: 40px 28px 80px 40px; width: calc(100% - 24px); }
  .blk.heading::before { display: none; }
  .blk.character { margin-left: 26%; }
  .blk.dialogue { margin-left: 13%; width: 70%; }
  .blk.parenthetical { margin-left: 20%; width: 55%; }
  .projects, .board { position: absolute; left: 0; z-index: 4; top: var(--topbar-h); bottom: 0; box-shadow: 12px 0 24px rgba(20,20,15,.10); }
  .chars, .treatment { position: absolute; right: 0; z-index: 4; top: var(--topbar-h); bottom: 0; box-shadow: -12px 0 24px rgba(20,20,15,.10); }
  .treatment.wide { width: 100%; flex-basis: 100%; }
  .board.full { top: 0; }
}

@media (max-width: 700px) {
  .sw-root { --topbar-h: 92px; }
  .topbar { display: flex; flex-wrap: wrap; height: auto; min-height: 92px; padding: 6px 10px; row-gap: 4px; column-gap: 6px; }
  .tb-left { flex: 1; min-width: 0; }
  .tb-right { flex: 0 0 auto; margin-left: auto; }
  .theme-strip { order: 3; width: 100%; }
  .title-input { flex: 1; width: auto; min-width: 40px; font-size: 11px; }
  .save-word, .streak-chip, .page-est, .sync-warn { display: none; }
  .icon-btn { width: 28px; height: 28px; }
  .export-btn { padding: 5px 9px; font-size: 11px; }
  .pop-panel { position: fixed; left: 10px; right: 10px; top: var(--topbar-h); width: auto; }
}
`;
