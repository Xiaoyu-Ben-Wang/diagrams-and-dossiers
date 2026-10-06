import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App'
import { restoreDeepLink } from './app/router'
import './index.css'

// Before anything reads the location: on GitHub Pages the address may be the
// board's, handed back by `public/404.html`.
restoreDeepLink()

const container = document.getElementById('root')
if (!container) throw new Error('missing #root')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
