/* ============================================================================
   Per-project Drive sync: pure planning logic.

   One JSON file per script (sw-<id>.json) plus a generated .fountain
   companion. This module decides WHAT to do; Screenwriter.jsx does the
   fetching. Keeping the decision matrix pure makes it testable in node,
   which matters because the failure mode here is silent data loss.

   Inputs:
     library : [{ id, title, updatedAt }]        local projects (local clock)
     bases   : { id: { fileId, fountainId, modifiedTime, syncedAt } }
               what we last saw of each remote file. modifiedTime is Drive's
               clock (opaque string, compared only for equality); syncedAt is
               the local clock at the last successful push/pull of that id.
     remote  : { id: { fileId, modifiedTime } }  current Drive listing

   A project is "dirty" when it was edited locally after its last sync.
   Both timestamps in that comparison come from the local clock, so device
   clock skew cannot corrupt the decision.
   ==========================================================================*/

export const PROJECT_FILE_RE = /^sw-([a-z0-9]+)\.json$/;
export const projectFileName = (id) => `sw-${id}.json`;
export const fountainFileName = (title, id) =>
  `${(String(title || "untitled").trim() || "untitled").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "untitled"}-${id}.fountain`;

export function planSync({ library, bases, remote }) {
  const actions = [];
  const ids = new Set([...library.map((p) => p.id), ...Object.keys(remote)]);
  for (const id of ids) {
    const loc = library.find((p) => p.id === id);
    const rem = remote[id];
    const base = bases[id];
    const dirty = !!loc && loc.updatedAt > ((base && base.syncedAt) || 0);

    if (rem && (!base || rem.modifiedTime !== base.modifiedTime)) {
      /* the remote file is new to us or changed since we last synced it */
      if (!loc || !dirty) actions.push({ op: "pull", id });
      else actions.push({ op: "conflict", id });
    } else if (!rem) {
      if (loc && base && !dirty) actions.push({ op: "removeLocal", id }); // deleted on another device
      else if (loc) actions.push({ op: "push", id }); // brand new locally (or dirty: resurrect)
    } else if (dirty) {
      actions.push({ op: "push", id });
    }
    /* remote unchanged + local clean = nothing to do */
  }
  return actions;
}
