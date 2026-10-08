import { useEffect, useState } from 'react'
import type { SeRating } from './seRating'
import type { SudokuConstraints } from './sudoku/SudokuConstraints'
import type { VariantRatingWorkerResponse } from './variantRating.worker'

/**
 * A variant puzzle's difficulty rating on the Sudoku Explainer scale, shown
 * under the Variant page's grid the way the Classic page shows its SE rating
 * (same `SeRating` states: calculating with the rating so far, rated,
 * timed out, unavailable). The Classic rating itself (seRating.ts) is not
 * touched by any of this.
 *
 * Where the number comes from - variant-rating/ at the repo root, compiled
 * from Java by TeaVM like se-rating/ (see its README and RATINGS.md):
 *  - **Jigsaw**: SukakuExplainer's own rating (1to9only's maintained Sudoku
 *    Explainer, which knows Jigsaws as "a Latin square with nine custom
 *    regions"). An existing rater, run as it is - the number is the one its
 *    serate prints.
 *  - **Killer** (and Killer Jigsaw): no rater on the SE scale knows cages, so
 *    this is that same engine with this project's Killer techniques added
 *    (Cage Sum, Cage Combinations, Cage Locked Candidate, Rule of 45), each
 *    given a place among the Explainer's own difficulties. SE's method, a
 *    new extension - `system` says which, so the UI can say so too.
 *
 *  - **X-Sudoku**: SukakuExplainer's own rating again - the diagonals are
 *    one of the variants it knows (its serate -X). An existing rater, as is.
 *  - **Anti-Knight**: SukakuExplainer has no such variant. The rule brings
 *    no technique of its own, only more pairs of cells that can't hold the
 *    same digit, so the same engine is told about those pairs (and has its
 *    uniqueness techniques switched off) - every technique and difficulty is
 *    still the Explainer's. A minimal adaptation, not an official rating.
 *  - **Entropy**: SukakuExplainer has no such variant either. The same
 *    engine keeps the 2x2 squares' placed digits in its candidates and gets
 *    one technique, Entropy Square, priced with pointing and claiming - see
 *    variant-rating/RATINGS.md for how that was checked against Sudoku.Coach
 *    grades. A minimal adaptation, not an official rating.
 *
 * Adding a variant's rating later: a `VariantRatingSystem` id here, its case
 * in `variantRatingRequest` (what to send) and `variantRatingText` (what to
 * call it), and the Java side behind `rateVariant`.
 */
export type VariantRatingSystem =
  /** SukakuExplainer, unmodified in what it rates. */
  | 'sukaku-explainer-jigsaw'
  /** SukakuExplainer's engine + this project's Killer techniques. */
  | 'explainer-killer-extension'
  /** SukakuExplainer's own X (diagonals) variant, unmodified. */
  | 'sukaku-explainer-x'
  /** SukakuExplainer's engine told which cells a knight's move links. */
  | 'explainer-anti-knight-adaptation'
  /** SukakuExplainer's engine told about the 2x2 squares, plus one
   * technique (Entropy Square). */
  | 'explainer-entropy-adaptation'

/** What the rating worker is asked to rate. Plain strings, so it is also the
 * cache key and the JVM reference run's input. */
export interface VariantRatingRequest {
  system: VariantRatingSystem
  /** 81 characters, 1-9 for a given, 0 for an empty cell. */
  givens: string
  /** 81 characters 1-9, the Jigsaw region of each cell; '' for 3x3 boxes. */
  regions: string
  /** The cages as "sum:cell,cell;..." (cells 0-80, row by row); '' for none. */
  cages: string
  /** The extra rules, one letter each: 'x' = the two diagonals, 'k' =
   * Anti-Knight, 'e' = Entropy; '' = none. */
  rules: string
}

export const VARIANT_RATING_TIME_LIMIT_MS = 3 * 60 * 1000

/** The Explainer reports 20.0 for a puzzle its techniques cannot finish. */
const UNSOLVED = 200

/**
 * The request for the puzzle on the grid - its givens under its constraints
 * - or null when there is nothing for this rating to say: a puzzle with
 * nothing a Classic Sudoku lacks is the SE rating's job.
 *
 * `system` names the least established thing the number rests on: cages
 * (this project's techniques) before the Entropy adaptation (one technique
 * of ours) before the Anti-Knight adaptation (none) before
 * SukakuExplainer's own variants.
 */
export function variantRatingRequest(board: number[][], givens: boolean[][], constraints: SudokuConstraints): VariantRatingRequest | null {
  const rules = `${constraints.diagonals ? 'x' : ''}${constraints.antiKnight ? 'k' : ''}${constraints.entropy ? 'e' : ''}`
  if (!constraints.regions && constraints.cages.length === 0 && rules === '') {
    return null
  }
  const hasGivens = givens.some((row) => row.some(Boolean))
  return {
    system:
      constraints.cages.length > 0
        ? 'explainer-killer-extension'
        : constraints.entropy
          ? 'explainer-entropy-adaptation'
          : constraints.antiKnight
            ? 'explainer-anti-knight-adaptation'
          : constraints.regions
            ? 'sukaku-explainer-jigsaw'
            : 'sukaku-explainer-x',
    givens: board.map((row, r) => row.map((value, c) => (value !== 0 && (!hasGivens || givens[r][c]) ? value : 0)).join('')).join(''),
    regions: constraints.regions ? constraints.regions.map((row) => row.map((region) => region + 1).join('')).join('') : '',
    cages: constraints.cages.map((cage) => `${cage.sum}:${cage.cells.map(([row, col]) => row * 9 + col).join(',')}`).join(';'),
    rules,
  }
}

// The rules are only appended when there are any, so the ratings already
// stored for Jigsaws and Killers keep their keys.
const requestKey = (request: VariantRatingRequest) => `${request.givens}|${request.regions}|${request.cages}${request.rules ? `|${request.rules}` : ''}`

type Finished = Extract<SeRating, { kind: 'rated' | 'timed-out' }>

// Finished ratings by request, newest last; kept in localStorage like the SE
// ratings (a rating never changes, and a hard one takes a while).
const STORAGE_KEY = 'sudoku-solver.variantRatings'
const MAX_STORED = 60
const finished = new Map<string, Finished>()
try {
  const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
  if (Array.isArray(stored)) {
    for (const entry of stored) {
      if (Array.isArray(entry) && typeof entry[0] === 'string' && entry[1] && typeof entry[1] === 'object' && typeof entry[1].kind === 'string') {
        finished.set(entry[0], entry[1] as Finished)
      }
    }
  }
} catch {
  // No storage (or not in a browser at all): start empty.
}

function remember(key: string, rating: Finished) {
  finished.delete(key)
  finished.set(key, rating)
  while (finished.size > MAX_STORED) {
    finished.delete(finished.keys().next().value as string)
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...finished]))
  } catch {
    // Storage full or blocked: the in-memory copy still serves this session.
  }
}

/**
 * Rates `request` in a Web Worker of its own (null while there is none). A
 * new request terminates the search still running for the old one. The
 * puzzle must have exactly one solution - the caller already knows.
 */
export function useVariantRating(request: VariantRatingRequest | null): SeRating | null {
  const key = request ? requestKey(request) : null
  const [live, setLive] = useState<{ key: string; rating: SeRating } | null>(null)

  useEffect(() => {
    if (!request || !key || finished.has(key)) {
      return
    }
    const report = (rating: SeRating) => setLive({ key, rating })
    let worker: Worker
    try {
      worker = new Worker(new URL('./variantRating.worker.ts', import.meta.url), { type: 'module' })
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
      remember(key, rating)
      report(rating)
    }
    const timer = setTimeout(() => finish({ kind: 'timed-out', atLeast }), VARIANT_RATING_TIME_LIMIT_MS)
    worker.onmessage = (event: MessageEvent<VariantRatingWorkerResponse>) => {
      const response = event.data
      if (response.type === 'progress') {
        atLeast = response.tenths
        report({ kind: 'calculating', atLeast })
      } else if (response.type === 'done' && response.er > 0 && response.er < UNSOLVED) {
        finish({ kind: 'rated', er: response.er, ep: response.ep, ed: response.ed })
      } else {
        if (response.type === 'error') {
          console.error('Variant rating failed', response.message)
        }
        stop()
        report({ kind: 'unavailable' })
      }
    }
    worker.onerror = (event) => {
      console.error('Variant rating failed', event.message)
      stop()
      report({ kind: 'unavailable' })
    }
    worker.postMessage(request)
    return stop
    // `key` stands for the whole request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  if (!key) {
    return null
  }
  return finished.get(key) ?? (live?.key === key ? live.rating : { kind: 'calculating', atLeast: 0 })
}

const oneDecimal = (tenths: number) => (tenths / 10).toFixed(1)

const RATING_WORDING: Record<VariantRatingSystem, { name: string; source: string }> = {
  'sukaku-explainer-jigsaw': {
    name: 'SE rating (Jigsaw)',
    source: "The puzzle's rating from SukakuExplainer, the Sudoku Explainer that knows Jigsaw regions - the same scale as the Classic page's SE rating",
  },
  'explainer-killer-extension': {
    name: 'Killer rating (SE scale)',
    source:
      "The hardest step of a Sudoku Explainer solve with this solver's Killer techniques added (cage sums and combinations, Rule of 45), each placed on the SE scale. SE's method, but not an official SE rating: Sudoku Explainer itself does not know Killer cages",
  },
  'sukaku-explainer-x': {
    name: 'SE rating (X-Sudoku)',
    source:
      "The puzzle's rating from SukakuExplainer, the Sudoku Explainer that knows the two diagonals as extra units - the same scale as the Classic page's SE rating",
  },
  'explainer-entropy-adaptation': {
    name: 'Entropy rating (SE scale)',
    source:
      'The hardest step of a SukakuExplainer solve that also knows the 2x2 squares (a low, a middle and a high digit in each), with one technique added for them, Entropy Square, at 2.6 / 2.8 - and without its uniqueness techniques. Checked against Sudoku.Coach difficulty grades, but not an official SE rating: Sudoku Explainer itself has no Entropy rule',
  },
  'explainer-anti-knight-adaptation': {
    name: 'Anti-Knight rating (SE scale)',
    source:
      "The hardest step of a SukakuExplainer solve that also knows which cells are a knight's move apart (and leaves out its uniqueness techniques). Every technique and difficulty is Sudoku Explainer's own, but it is not an official SE rating: Sudoku Explainer itself has no Anti-Knight rule",
  },
}

/** One rating's text and tooltip for the line under the grid - the same
 * shape as seRatingText, worded for where the number comes from. Null = show
 * nothing. */
export function variantRatingText(rating: SeRating, system: VariantRatingSystem): { text: string; title: string } | null {
  const { name, source } = RATING_WORDING[system]
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
        title: `${source}. Stopped after ${VARIANT_RATING_TIME_LIMIT_MS / 60000} minutes, so this is only the hardest step found by then.`,
      }
    case 'unavailable':
      return null
  }
}
