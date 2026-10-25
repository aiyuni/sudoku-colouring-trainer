import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'
import App from '../App.tsx'
import { selectVariantStorage } from '../persistedState'
import { startUsageTracking } from '../usageTracking'
import { readReplayFromAddress } from '../techniqueShareLink'

// The Variant Sudoku Solver (/variants/): the same App as the Classic page,
// in its variant mode, with its puzzle and settings saved under their own
// localStorage keys - set before the first render reads them.
selectVariantStorage()
startUsageTracking()

// A technique share link is read before the first render, as on the Classic
// page (main.tsx).
void readReplayFromAddress(true).then((replayLink) => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App variant replayLink={replayLink} />
    </StrictMode>,
  )
})
