/* ============================================================================
   Per-project Drive sync: pure planning logic.

   One JSON file per script (sw-<id>.json) plus a generated .fountain
   companion. This module decides WHAT to do; Screenwriter.jsx does the
   fetching. Keeping the decision matrix pure makes it testable in node,
   which matters because the failure mode here is silent data loss.

   Inputs:
     library : [{ id, title, updatedAt }]        local projects (local clock)
     bases   : { id: { fileId, fountainId, modifiedTime, syncedAt, coreHash } }
               what we last saw of each remote file. modifiedTime is Drive's
               clock (opaque string, compared only for equality); syncedAt is
               the local clock at the last successful push/pull of that id;
               coreHash is the content hash the file held at that moment.
     remote  : { id: { fileId, modifiedTime } }  current Drive listing
     dirty   : Set of project ids whose CONTENT differs from their base's
               coreHash. The caller computes this from actual doc content --
               never from timestamps, which lie: merely opening the app used
               to stamp updatedAt, making a stale device look "edited" and
               letting its old copy beat newer remote work in a conflict.
               (Timestamps remain only as a fallback for bases written before
               coreHash existed.)
   ==========================================================================*/

/* One format everywhere: a script IS a title-named .sws file, in Drive and in
   the menu export alike. The legacy patterns are still recognized so folders
   written by older builds keep syncing; on their next push the same Drive
   file is renamed in place (the id, not the name, is a file's identity). */
export const SWS_FILE_RE = /-([a-z0-9]+)\.sws$/;
export const LEGACY_JSON_RE = /^sw-([a-z0-9]+)\.json$/;
export const FOUNTAIN_FILE_RE = /-([a-z0-9]+)\.fountain$/;

const slug = (title) =>
  (String(title || "untitled").trim() || "untitled").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "untitled";

export const swsFileName = (title, id) => `${slug(title)}-${id}.sws`;
export const fountainFileName = (title, id) => `${slug(title)}-${id}.fountain`;

/* updatedAt is the EDIT clock, not the push clock: a stale device pushing
   right now must not look newer than work written ten minutes ago */
export const swsEnvelope = (id, doc, editedAt) => ({
  format: "screenwriter-script", version: 1, id,
  title: doc.title || "UNTITLED", updatedAt: editedAt != null ? editedAt : Date.now(), doc,
});

/* cheap stable hash (djb2) for content-identity comparisons */
export const hashStr = (s) => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return String(h);
};

export function planSync({ library, bases, remote, dirty }) {
  const actions = [];
  const ids = new Set([...library.map((p) => p.id), ...Object.keys(remote)]);
  for (const id of ids) {
    const loc = library.find((p) => p.id === id);
    const rem = remote[id];
    const base = bases[id];
    const isDirty = !!loc && (dirty
      ? dirty.has(id)
      : loc.updatedAt > ((base && base.syncedAt) || 0));

    if (rem && (!base || rem.modifiedTime !== base.modifiedTime)) {
      /* the remote file is new to us or changed since we last synced it */
      if (!loc || !isDirty) actions.push({ op: "pull", id });
      else actions.push({ op: "conflict", id });
    } else if (!rem) {
      if (loc && base && !isDirty) actions.push({ op: "removeLocal", id }); // deleted on another device
      else if (loc) actions.push({ op: "push", id }); // brand new locally (or dirty: resurrect)
    } else if (isDirty) {
      actions.push({ op: "push", id });
    }
    /* remote unchanged + local clean = nothing to do */
  }
  return actions;
}
