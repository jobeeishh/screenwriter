import React from 'react'
import ReactDOM from 'react-dom/client'
import Screenwriter from './Screenwriter.jsx'
import ErrorBoundary from './ErrorBoundary.jsx'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <Screenwriter />
    </ErrorBoundary>
  </React.StrictMode>,
)
