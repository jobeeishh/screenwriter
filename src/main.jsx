import React from 'react'
import ReactDOM from 'react-dom/client'
import Screenwriter from './Screenwriter.jsx'
import ShareView from './ShareView.jsx'
import ErrorBoundary from './ErrorBoundary.jsx'

/* The only route in the app: /s/<id> is somebody else's script, read-only.
   Everything else is the editor. Split here rather than inside Screenwriter so
   a reader never loads the library, the sync loop, or anyone's local drafts. */
const share = location.pathname.match(/^\/s\/([A-Za-z0-9_-]{1,64})\/?$/)

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      {share ? <ShareView id={share[1]} /> : <Screenwriter />}
    </ErrorBoundary>
  </React.StrictMode>,
)
