import { useEffect, useState } from 'react'
import type { SeRatingWorkerResponse } from './seRating.worker'

/**
 * The puzzle's Sudoku Explainer rating, shown under the grid.
 *
 * This is not an imitation: the worker runs Sudoku Explainer 1.2.1's own
 * solver (with gsf's serate loop), compiled from the Java sources in
 * se-rating/ at the repo root, so the number is the one serate prints. All
 * ratings here are in tenths (72 = SE 7.2), as the worker reports them.
 *
 * SE is slow on the hardest puzzles (its nested forcing chains: a minute or
 * more natively for a 10+), so the search reports the rating so far as it
 * climbs, and is cut off after SE_RATING_TIME_LIMIT_MS with that lower bound.
 */
export type SeRating =
  /** Still running; `atLeast` is the rating so far (0 = nothing yet). */
  | { kind: 'calculating'; atLeast: number }
  /** ER = the rating; EP/ED = serate's pearl and diamond ratings. */
  | { kind: 'rated'; er: number; ep: number; ed: number }
  /** Cut off at the time limit. */
  | { kind: 'timed-out'; atLeast: number }
  /** The rating code couldn't be run at all (no Web Workers, a crash). */
  | { kind: 'unavailable' }

export const SE_RATING_TIME_LIMIT_MS = 3 * 60 * 1000

/** serate reports 20.0 for a puzzle SE cannot solve at all. */
const SE_UNSOLVED = 200

// Finished ratings, by 81-character puzzle string. A rating never changes,
// and a hard one takes long enough that redoing it on every reload (or on
// undo back to an earlier puzzle) would be felt, so the newest few are also
// kept in localStorage.
const STORAGE_KEY = 'sudoku-solver.seRatings'
const MAX_STORED = 100
type Finished = Extract<SeRating, { kind: 'rated' | 'timed-out' }>
const finishedRatings = new Map<string, Finished>()

function isFinished(value: unknown): value is Finished {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const rating = value as Record<string, unknown>
  const tenths = (key: string) => typeof rating[key] === 'number' && Number.isFinite(rating[key])
  return (
    (rating.kind === 'rated' && tenths('er') && tenths('ep') && tenths('ed')) ||
    (rating.kind === 'timed-out' && tenths('atLeast'))
  )
}

try {
  const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
  if (Array.isArray(stored)) {
    for (const entry of stored) {
      if (Array.isArray(entry) && typeof entry[0] === 'string' && isFinished(entry[1])) {
        finishedRatings.set(entry[0], entry[1])
      }
    }
  }
} catch {
  // No storage, or something else's data under the key: start empty.
}

// The same for positions part-way through a solve (the "current" rating):
// there is a new one after every move, so they are kept for this session
// only - stored with the puzzles' own ratings they would push those out.
const MAX_SESSION = 300
const sessionRatings = new Map<string, Finished>()

function remember(puzzle: string, rating: Finished, persist: boolean) {
  if (!persist) {
    sessionRatings.set(puzzle, rating)
    if (sessionRatings.size > MAX_SESSION) {
      sessionRatings.delete(sessionRatings.keys().next().value as string)
    }
    return
  }
  finishedRatings.delete(puzzle)
  finishedRatings.set(puzzle, rating)
  while (finishedRatings.size > MAX_STORED) {
    finishedRatings.delete(finishedRatings.keys().next().value as string)
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...finishedRatings]))
  } catch {
    // Storage full or blocked: the in-memory copy still serves this session.
  }
}

const finishedRating = (puzzle: string) => finishedRatings.get(puzzle) ?? sessionRatings.get(puzzle)

/**
 * Rates `puzzle` (81 characters, 1-9 or 0; must have exactly one solution -
 * SE's rating means nothing otherwise, and the caller already knows) in a
 * Web Worker of its own. Null while there is no puzzle. A new puzzle
 * terminates the search still running for the old one.
 *
 * `puzzle` may carry 729 more characters, nine per cell, with a 0 for each
 * candidate already eliminated (see `seRatingPosition`): SE then rates the
 * rest of the solve from those pencil marks. `persist: false` keeps the
 * result for this session only.
 */
export function useSeRating(puzzle: string | null, persist = true): SeRating | null {
  const [live, setLive] = useState<{ puzzle: string; rating: SeRating } | null>(null)

  useEffect(() => {
    if (!puzzle || finishedRating(puzzle)) {
      return
    }
    const report = (rating: SeRating) => setLive({ puzzle, rating })
    let worker: Worker
    try {
      worker = new Worker(new URL('./seRating.worker.ts', import.meta.url), { type: 'module' })
    } catch {
      report({ kind: 'unavailable' })
      return
    }
    let atLeast = 0
    const stop = () => {
      clearTimeout(timer)
      worker.terminate()
    }
    const finish = (rating: Finished) => {
      stop()
      remember(puzzle, rating, persist)
      report(rating)
    }
    const timer = setTimeout(() => finish({ kind: 'timed-out', atLeast }), SE_RATING_TIME_LIMIT_MS)
    worker.onmessage = (event: MessageEvent<SeRatingWorkerResponse>) => {
      const response = event.data
      if (response.type === 'progress') {
        atLeast = response.tenths
        report({ kind: 'calculating', atLeast })
      } else if (response.type === 'done' && response.er > 0 && response.er < SE_UNSOLVED) {
        finish({ kind: 'rated', er: response.er, ep: response.ep, ed: response.ed })
      } else {
        if (response.type === 'error') {
          console.error('SE rating failed', response.message)
        }
        stop()
        report({ kind: 'unavailable' })
      }
    }
    worker.onerror = (event) => {
      console.error('SE rating failed', event.message)
      stop()
      report({ kind: 'unavailable' })
    }
    worker.postMessage(puzzle)
    return stop
  }, [puzzle, persist])

  if (!puzzle) {
    return null
  }
  return finishedRating(puzzle) ?? (live?.puzzle === puzzle ? live.rating : { kind: 'calculating', atLeast: 0 })
}

/**
 * What to rate for the position on the grid: the board, plus - only when
 * some pencil mark has actually been eliminated - the candidates SE should
 * start from. A cell with no marks at all counts as fully marked (the same
 * reading the candidate-accuracy check uses), and marking a digit a peer
 * already holds changes nothing, so `legal` (a fresh autofill of `board`)
 * decides what counts as an elimination.
 */
export function seRatingPosition(board: number[][], candidates: boolean[][][], legal: boolean[][][]): string {
  const cells = board.map((row) => row.join('')).join('')
  let eliminated = false
  let marks = ''
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const marked = candidates[r][c]
      const partial = board[r][c] === 0 && marked.some(Boolean)
      for (let d = 0; d < 9; d++) {
        const gone = partial && legal[r][c][d] && !marked[d]
        eliminated ||= gone
        marks += gone ? '0' : '1'
      }
    }
  }
  return eliminated ? cells + marks : cells
}

const oneDecimal = (tenths: number) => (tenths / 10).toFixed(1)

/** The two ratings shown under the grid: the puzzle's own, and what is left
 * of it from the position now on the grid. */
export type SeRatingLabel = 'puzzle' | 'current'

/** One rating's text and tooltip. Null = show nothing. */
export function seRatingText(rating: SeRating, label: SeRatingLabel): { text: string; title: string } | null {
  const name = label === 'puzzle' ? 'SE rating' : 'Current SE rating'
  const source =
    label === 'puzzle'
      ? "SE rating of the original puzzle."
      : "SE rating of the current state of the puzzle."
  switch (rating.kind) {
    case 'rated':
      return {
        text: `${name}: ${oneDecimal(rating.er)}`,
        title: `${source}. Hardest step overall ${oneDecimal(rating.er)}, hardest step up to the first placed digit ${oneDecimal(rating.ep)}, first step ${oneDecimal(rating.ed)}.`,
      }
    case 'calculating':
      return {
        text: rating.atLeast > 0 ? `${name}: ${oneDecimal(rating.atLeast)} or higher - calculating…` : `${name}: calculating…`,
        title: `${source}. The hardest puzzles can take a few minutes.`,
      }
    case 'timed-out':
      if (rating.atLeast === 0) {
        return null
      }
      return {
        text: `${name}: ${oneDecimal(rating.atLeast)} or higher`,
        title: `${source}. Stopped after ${SE_RATING_TIME_LIMIT_MS / 60000} minutes, so this is only the hardest step found by then.`,
      }
    case 'unavailable':
      return null
  }
}
