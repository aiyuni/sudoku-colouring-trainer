import { dragonGenerationWorkerCount } from '../sudoku/ParallelDragonPuzzleGenerator'
import {
  generatePracticePuzzleBlocking,
  type PracticeGenerateOptions,
  type PracticePuzzleState,
} from './practicePuzzleGenerator'
import { pickStockPracticePuzzle, practiceTargetHasStock } from './practicePuzzleStock'
import type { PracticeWorkerRequest, PracticeWorkerResponse } from './practicePuzzle.worker'

export type PracticeOutcome =
  /** A state that needs the target (already verified, by the generator or
   * the stock picker). `fromStock`: a pre-generated position, served because
   * the live search found none in its window. */
  | { kind: 'found'; state: PracticePuzzleState; puzzlesTried: number; elapsedMs: number; fromStock: boolean }
  /** The time ran out with nothing found. */
  | { kind: 'timeout'; puzzlesTried: number; elapsedMs: number }
  | { kind: 'cancelled'; puzzlesTried: number; elapsedMs: number }
  /** The search itself broke (every worker crashed and so did the fallback). */
  | { kind: 'failed'; puzzlesTried: number; elapsedMs: number }

/** What the pool is built from - the browser's Worker by default; the tests
 * pass a stand-in (Node has no module Workers of this shape). */
export interface PracticeWorkerLike {
  onmessage: ((event: { data: PracticeWorkerResponse }) => void) | null
  onerror: ((event: { preventDefault?: () => void }) => void) | null
  postMessage: (request: PracticeWorkerRequest) => void
  terminate: () => void
}

export interface PracticeRunHooks {
  /** Total random puzzles walked so far, across every worker. */
  onProgress?: (puzzlesTried: number) => void
  signal?: AbortSignal
  /** The live search found nothing in its window and a pre-generated
   * position is being picked instead. */
  onStockFallback?: () => void
  createWorker?: () => PracticeWorkerLike
  workerCount?: number
}

/** How long the live search runs for a target that has a stock, before a
 * stock position is served instead. Those targets are the rare ones (a
 * single thread needs minutes for one), so waiting out the whole timeout
 * first would only make the usual case slow. */
export const STOCK_LIVE_SEARCH_MS = 5_000

/** The longest a search for `targetId` runs before it ends one way or the
 * other (the dialog's progress bar). */
export function practiceSearchWindowMs(targetId: string, timeBudgetMs: number): number {
  return practiceTargetHasStock(targetId) ? Math.min(timeBudgetMs, STOCK_LIVE_SEARCH_MS) : timeBudgetMs
}

/**
 * A practice position for `options.targetId`, off the main thread: the live
 * search (generatePracticePuzzleInParallel), and for a target with a stock,
 * a pre-generated position when the live search's shorter window ends empty.
 * Never rejects; ends at a find, the time limit or the moment `signal`
 * aborts.
 */
export async function generatePracticePuzzle(options: PracticeGenerateOptions, hooks: PracticeRunHooks = {}): Promise<PracticeOutcome> {
  const startedAt = Date.now()
  const live = await generatePracticePuzzleInParallel(
    { ...options, timeBudgetMs: practiceSearchWindowMs(options.targetId, options.timeBudgetMs) },
    hooks,
  )
  if (live.kind !== 'timeout' || !practiceTargetHasStock(options.targetId)) {
    return live
  }
  hooks.onStockFallback?.()
  const picked = await pickStockOffThread(options, hooks)
  const elapsedMs = Date.now() - startedAt
  if (picked === 'cancelled') {
    return { kind: 'cancelled', puzzlesTried: live.puzzlesTried, elapsedMs }
  }
  return picked
    ? { kind: 'found', state: picked, puzzlesTried: live.puzzlesTried, elapsedMs, fromStock: true }
    : { kind: 'timeout', puzzlesTried: live.puzzlesTried, elapsedMs }
}

/** pickStockPracticePuzzle in one worker (its re-check is too slow for the
 * page's thread), or right here where there are no Workers. */
function pickStockOffThread(options: PracticeGenerateOptions, hooks: PracticeRunHooks): Promise<PracticePuzzleState | null | 'cancelled'> {
  const { signal } = hooks
  const inline = () => {
    try {
      return pickStockPracticePuzzle(options.targetId, options.settings, Math.random, options.fromStart === true)
    } catch {
      return null
    }
  }
  const createWorker = hooks.createWorker ?? (typeof Worker === 'undefined' ? null : defaultCreateWorker)
  if (signal?.aborted) {
    return Promise.resolve('cancelled')
  }
  if (!createWorker) {
    return Promise.resolve(inline())
  }
  return new Promise((resolve) => {
    let worker: PracticeWorkerLike
    try {
      worker = createWorker()
    } catch {
      resolve(inline())
      return
    }
    let settled = false
    const finish = (value: PracticePuzzleState | null | 'cancelled') => {
      if (settled) {
        return
      }
      settled = true
      signal?.removeEventListener('abort', onAbort)
      worker.terminate()
      resolve(value)
    }
    const onAbort = () => finish('cancelled')
    signal?.addEventListener('abort', onAbort)
    worker.onmessage = (event) => {
      if (event.data.kind === 'done') {
        finish(event.data.state)
      }
    }
    worker.onerror = (event) => {
      event.preventDefault?.()
      finish(inline())
    }
    worker.postMessage({ kind: 'stock', targetId: options.targetId, settings: options.settings, fromStart: options.fromStart === true })
  })
}

/** Extra time past the budget before giving up on workers that haven't
 * reported back: a worker checks its deadline between rounds of a walk, so
 * it can overrun by one Techniques-list computation. */
const DEADLINE_GRACE_MS = 3_000

function defaultCreateWorker(): PracticeWorkerLike {
  return new Worker(new URL('./practicePuzzle.worker.ts', import.meta.url), { type: 'module' }) as unknown as PracticeWorkerLike
}

/**
 * The "More..." practice-puzzle search, off the main thread: one Web Worker
 * per spare core (the Dragon generator's count), each walking its own random
 * puzzles, the first state found wins and the rest are terminated - the same
 * race as generateDragonPuzzleInParallel, for the same reason (the search is
 * a lottery over independent puzzles, so N workers find one about N times
 * sooner). Never rejects and always ends: at the first find, at the time
 * budget, or the moment `signal` aborts.
 */
export async function generatePracticePuzzleInParallel(
  options: PracticeGenerateOptions,
  hooks: PracticeRunHooks = {},
): Promise<PracticeOutcome> {
  const startedAt = Date.now()
  const elapsed = () => Date.now() - startedAt
  const { signal, onProgress } = hooks
  if (signal?.aborted) {
    return { kind: 'cancelled', puzzlesTried: 0, elapsedMs: 0 }
  }
  const createWorker = hooks.createWorker ?? (typeof Worker === 'undefined' ? null : defaultCreateWorker)
  if (!createWorker) {
    return runOnMainThread(options, startedAt, hooks)
  }

  const workers: PracticeWorkerLike[] = []
  const tried: number[] = []
  const total = () => tried.reduce((sum, count) => sum + count, 0)
  const outcome = await new Promise<PracticeOutcome | 'all-failed'>((resolve) => {
    let pending = 0
    let failed = 0
    let settled = false
    const finish = (value: PracticeOutcome | 'all-failed') => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      for (const worker of workers) {
        worker.terminate()
      }
      resolve(value)
    }
    const workerDone = (crashed: boolean) => {
      pending--
      if (crashed) {
        failed++
      }
      if (pending === 0) {
        finish(failed === workers.length ? 'all-failed' : { kind: 'timeout', puzzlesTried: total(), elapsedMs: elapsed() })
      }
    }
    const timer = setTimeout(
      () => finish({ kind: 'timeout', puzzlesTried: total(), elapsedMs: elapsed() }),
      options.timeBudgetMs + DEADLINE_GRACE_MS,
    )
    const onAbort = () => finish({ kind: 'cancelled', puzzlesTried: total(), elapsedMs: elapsed() })
    signal?.addEventListener('abort', onAbort)

    const count = hooks.workerCount ?? dragonGenerationWorkerCount()
    for (let i = 0; i < count; i++) {
      let worker: PracticeWorkerLike
      try {
        worker = createWorker()
      } catch {
        break
      }
      const index = workers.length
      workers.push(worker)
      tried.push(0)
      pending++
      let reported = false
      worker.onmessage = (event) => {
        if (reported || settled) {
          return
        }
        tried[index] = event.data.puzzlesTried
        if (event.data.kind === 'progress') {
          onProgress?.(total())
          return
        }
        reported = true
        if (event.data.state) {
          finish({ kind: 'found', state: event.data.state, puzzlesTried: total(), elapsedMs: elapsed(), fromStock: false })
        } else {
          workerDone(false)
        }
      }
      worker.onerror = (event) => {
        event.preventDefault?.()
        if (reported) {
          return
        }
        reported = true
        workerDone(true)
      }
      worker.postMessage({ kind: 'search', options })
    }
    if (workers.length === 0) {
      finish('all-failed')
    }
  })

  if (outcome !== 'all-failed') {
    return outcome
  }
  const remainingMs = options.timeBudgetMs - elapsed()
  if (remainingMs <= 0) {
    return { kind: 'failed', puzzlesTried: 0, elapsedMs: elapsed() }
  }
  return runOnMainThread({ ...options, timeBudgetMs: remainingMs }, startedAt, hooks)
}

/** No Workers (or none would start): the same search on the main thread,
 * one random puzzle at a time, yielding to the page (and its Cancel button)
 * between puzzles. */
async function runOnMainThread(options: PracticeGenerateOptions, startedAt: number, hooks: PracticeRunHooks): Promise<PracticeOutcome> {
  const deadline = Date.now() + options.timeBudgetMs
  const elapsed = () => Date.now() - startedAt
  let puzzlesTried = 0
  try {
    while (Date.now() < deadline) {
      if (hooks.signal?.aborted) {
        return { kind: 'cancelled', puzzlesTried, elapsedMs: elapsed() }
      }
      const result = generatePracticePuzzleBlocking({ ...options, timeBudgetMs: deadline - Date.now(), maxPuzzles: 1 })
      puzzlesTried += result.puzzlesTried
      hooks.onProgress?.(puzzlesTried)
      if (result.state) {
        return { kind: 'found', state: result.state, puzzlesTried, elapsedMs: elapsed(), fromStock: false }
      }
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  } catch {
    return { kind: 'failed', puzzlesTried, elapsedMs: elapsed() }
  }
  return hooks.signal?.aborted
    ? { kind: 'cancelled', puzzlesTried, elapsedMs: elapsed() }
    : { kind: 'timeout', puzzlesTried, elapsedMs: elapsed() }
}
