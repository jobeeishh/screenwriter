/* ============================================================================
   Put your Google client ID here ONCE and every device — yours, your friends' —
   goes straight to a plain "Sign in with Google" button. No one is ever asked
   to paste an ID.

   Where to get it:
     console.cloud.google.com -> Credentials -> your OAuth 2.0 Client ID
     It ends in .apps.googleusercontent.com

   Two ways to set it (either works):

   1. Simplest — paste it between the quotes below, save, commit, push.

   2. Or keep it out of your repo: make a file named `.env` next to package.json
      containing this one line, then rebuild:
          VITE_GOOGLE_CLIENT_ID=xxxxx.apps.googleusercontent.com

   Note: an OAuth client ID is not a secret. It's visible in any browser that
   loads your site, by design. Google restricts it to the domains you listed
   under "Authorized JavaScript origins", which is what actually protects it.
   Committing it is fine.
   ==========================================================================*/

const PASTE_YOUR_CLIENT_ID_HERE = "293246585026-4inu0qhc3bcihc9hgv0ot5ik72eo45jh.apps.googleusercontent.com";

export const GOOGLE_CLIENT_ID =
  (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_GOOGLE_CLIENT_ID) ||
  PASTE_YOUR_CLIENT_ID_HERE ||
  "";

/* The live-session relay (collab/ worker). wss:// URL of the deployed
   screenwriter-collab worker; empty disables the Live button. */
const COLLAB_WORKER_URL = "wss://screenwriter-collab.josephpyao.workers.dev";

export const COLLAB_URL =
  (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_COLLAB_URL) ||
  COLLAB_WORKER_URL ||
  "";
