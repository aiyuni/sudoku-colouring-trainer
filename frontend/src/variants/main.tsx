import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'
import App from '../App.tsx'
import { selectVariantStorage } from '../persistedState'
import { startUsageTracking } from '../usageTracking'

// The Variant Sudoku Solver (/variants/): the same App as the Classic page,
// in its variant mode, with its puzzle and settings saved under their own
// localStorage keys - set before the first render reads them.
selectVariantStorage()
startUsageTracking()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App variant />
  </StrictMode>,
)
