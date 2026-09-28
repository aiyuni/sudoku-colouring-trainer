import type { PuzzleStringFormat } from './sudoku/PuzzleImporter'
import type { Board } from './sudoku/types'
import { deviceHints } from './deviceHints'
import { trackEvent } from './usageTracking'

// Anonymous import analytics: every successful import (string or screenshot)
// is sent to a Cloudflare Worker (`analytics/` at the repo root) that stores
// it in D1 along with the time, the importer's country (from Cloudflare's own
// geolocation - no IP is sent or stored), whether the grid has a unique
// solution (worked out on the Worker, not here) and the device, OS and
// browser (worked out on the Worker from the User-Agent header, helped by
// the hints in deviceHints below). The page holds no
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
  // Also in the usage events (never in puzzle_imports itself), so imports
  // can be tied to a visitor: label = the same 81-char puzzle string.
  trackEvent('import', report.importType === 'string' ? `string (${report.sourceFormat})` : 'ocr', boardString(board))
  void sendImport(ANALYTICS_URL, board, report)
}

function boardString(board: Board): string {
  return board.flat().map((v) => (v >= 1 && v <= 9 ? String(v) : '0')).join('')
}

async function sendImport(url: string, board: Board, report: ImportReport): Promise<void> {
  try {
    const puzzle = boardString(board)
    const body = JSON.stringify({ puzzle, ...report, device: await deviceHints() })
    // text/plain keeps this a CORS "simple request" (no preflight), and
    // keepalive lets it finish even if the tab closes right after an import.
    // Deliberately not sendBeacon: content blockers filter beacon ("ping")
    // requests as a type, which silently dropped imports from browsers
    // running one.
    await fetch(url, {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'text/plain' },
      keepalive: true,
      mode: 'cors',
    })
  } catch {
    // Analytics must never affect the app.
  }
}
