import type { DragonWorkerRequest, DragonWorkerResponse } from './dragonPuzzleGenerator.worker'
import {
  SudokuDragonPuzzleGenerator,
  type DragonPuzzleGenerateOptions,
  type GeneratedDragonPuzzle,
} from './SudokuDragonPuzzleGenerator'

/** Upper bound on the worker pool. Each search is independent and
 * CPU-bound, so throughput scales with physical cores and then only mildly
 * with SMT siblings - benchmarked on a 8-core/16-thread Ryzen 7700X, see
 * DRAGON_COLOURING_HANDOFF.md's "Parallel generation" section. The cap
 * mostly protects memory on very wide machines. */
const MAX_WORKERS = 16
/** Extra time past the budget before the main thread gives up on workers
 * that haven't reported back. Each worker checks its own deadline only
 * between grid attempts, so it can overrun by up to one attempt. */
const DEADLINE_GRACE_MS = 2_000

const fallbackGenerator = new SudokuDragonPuzzleGenerator()

/** One worker per spare logical core, keeping one core for the UI thread. */
export function dragonGenerationWorkerCount(): number {
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 2 : 2
  return Math.max(1, Math.min(MAX_WORKERS, cores - 1))
}

/**
 * Runs SudokuDragonPuzzleGenerator's search in several Web Workers at once
 * and returns the first puzzle any of them finds (or null if none does
 * within the time budget).
 *
 * The search is a lottery over random solved grids - most grids never
 * reduce to a qualifying checkpoint, and a Dynamic-Dragon-only one with no
 * AIC kind disregarded is rare enough that one thread can take minutes.
 * Grids are independent, so N workers buy close to N tickets per unit of
 * time and the expected wait drops almost proportionally, with no change
 * to what counts as a qualifying puzzle (every worker runs the identical
 * checks). The losers are terminated the moment one worker succeeds,
 * which is also the only cancellation mechanism: `generateBlocking`
 * never yields, so a worker couldn't receive a "stop" message anyway.
 *
 * Falls back to the main-thread `generate` (which yields to keep the page
 * responsive) where Workers aren't available, or with whatever budget is
 * left if every worker failed to start or crashed.
 */
export async function generateDragonPuzzleInParallel(
  options: DragonPuzzleGenerateOptions,
): Promise<GeneratedDragonPuzzle | null> {
  const budgetMs = options.timeBudgetMs ?? 30_000
  const startedAt = Date.now()
  if (typeof Worker === 'undefined') {
    return fallbackGenerator.generate(options)
  }

  const workers: Worker[] = []
  const outcome = await new Promise<GeneratedDragonPuzzle | null | 'all-failed'>((resolve) => {
    let pending = 0
    let failed = 0
    let settled = false
    const finish = (value: GeneratedDragonPuzzle | null | 'all-failed') => {
      if (settled) {
        return
      }
      settled = true
      window.clearTimeout(timer)
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
        finish(failed === workers.length ? 'all-failed' : null)
      }
    }
    const timer = window.setTimeout(() => finish(null), budgetMs + DEADLINE_GRACE_MS)

    const request: DragonWorkerRequest = { options }
    for (let i = 0; i < dragonGenerationWorkerCount(); i++) {
      let worker: Worker
      try {
        worker = new Worker(new URL('./dragonPuzzleGenerator.worker.ts', import.meta.url), { type: 'module' })
      } catch {
        break
      }
      workers.push(worker)
      pending++
      let reported = false
      worker.onmessage = (event: MessageEvent<DragonWorkerResponse>) => {
        if (reported) {
          return
        }
        reported = true
        if (event.data.result) {
          finish(event.data.result)
        } else {
          workerDone(false)
        }
      }
      worker.onerror = (event) => {
        event.preventDefault()
        if (reported) {
          return
        }
        reported = true
        workerDone(true)
      }
      worker.postMessage(request)
    }
    if (workers.length === 0) {
      finish('all-failed')
    }
  })

  if (outcome !== 'all-failed') {
    return outcome
  }
  const remainingMs = budgetMs - (Date.now() - startedAt)
  return remainingMs > 0 ? fallbackGenerator.generate({ ...options, timeBudgetMs: remainingMs }) : null
}
