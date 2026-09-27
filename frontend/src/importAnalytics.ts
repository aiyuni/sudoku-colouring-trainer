import type { PuzzleStringFormat } from './sudoku/PuzzleImporter'
import type { Board } from './sudoku/types'

// Anonymous import analytics: every successful import (string or screenshot)
// is sent to a Cloudflare Worker (`analytics/` at the repo root) that stores
// it in D1 along with the time, the importer's country (from Cloudflare's own
// geolocation - no IP is sent or stored) and whether the grid has a unique
// solution (worked out on the Worker, not here). The page holds no
// credentials and can't read anything back.
//
// Only active when the build sets VITE_ANALYTICS_URL (CI does; local dev
// doesn't unless you put it in frontend/.env.local), and fully fire-and-
// forget: never awaited, never surfaces an error, never delays the import.
const ANALYTICS_URL: string | undefined = import.meta.env.VITE_ANALYTICS_URL

export type ImportReport =
  | { importType: 'string'; sourceFormat: PuzzleStringFormat }
  | { importType: 'ocr' }

export function reportImport(board: Board, report: ImportReport): void {
  if (!ANALYTICS_URL) {
    return
  }
  try {
    const puzzle = board.flat().map((v) => (v >= 1 && v <= 9 ? String(v) : '0')).join('')
    const body = JSON.stringify({ puzzle, ...report })
    // text/plain keeps this a CORS "simple request" (no preflight), and
    // keepalive lets it finish even if the tab closes right after an import.
    // Deliberately not sendBeacon: content blockers filter beacon ("ping")
    // requests as a type, which silently dropped imports from browsers
    // running one.
    void fetch(ANALYTICS_URL, {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'text/plain' },
      keepalive: true,
      mode: 'cors',
    }).catch(() => {})
  } catch {
    // Analytics must never affect the app.
  }
}
