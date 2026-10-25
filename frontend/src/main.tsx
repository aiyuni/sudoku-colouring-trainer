import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { startUsageTracking } from './usageTracking'
import { readReplayFromAddress } from './techniqueShareLink'

startUsageTracking()

// A technique share link (#d=...) is read before the first render, so a
// replay never starts the ordinary page's technique search (see
// techniqueShareLink.ts). Any other address renders at once.
void readReplayFromAddress(false).then((replayLink) => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App replayLink={replayLink} />
    </StrictMode>,
  )
})
