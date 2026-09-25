import type { SolvePathOptions, SolvePathWorkerRequest, SolvePathWorkerResponse } from './solvePath.worker'
import { buildSolvePath, type SolvePathResult } from './techniqueEngine'
import type { Board, CandidateGrid } from './sudoku/types'

export type { SolvePathOptions } from './solvePath.worker'

function runOnMainThread(board: Board, candidates: CandidateGrid, options: SolvePathOptions): SolvePathResult {
  return buildSolvePath(
    board,
    candidates,
    new Set(options.allowedRule3Techniques),
    options.shortAicEnabled,
    options.shortSingleDigitAicEnabled,
    options.aicLimitPerDragonStep,
    options.exhaustiveDragon,
    options.genericAicEnabled,
    options.easySolveEnabled,
    options.optimizeDragons,
    options.optimizeDynamicDragons,
    options.timeBudgetMs,
    options.dynamicDragonEnabled,
    new Set(options.enabledFish),
    options.alsXzEnabled,
  )
}

/**
 * Runs the Solve Path search (buildSolvePath) in its own Web Worker, so the
 * page stays responsive for however long the search takes - up to the whole
 * "Solve path timeout", which used to freeze the page solid for its full
 * length.
 *
 * Aborting `signal` terminates the worker on the spot and rejects with an
 * AbortError. A fresh worker per search keeps that simple (there's no
 * long-lived worker to restart after a terminate); the cost is loading the
 * engine module each time, tens of milliseconds against a search that can
 * run for seconds. Falls back to the main thread where Workers aren't
 * available, or if the worker can't be started at all.
 */
export function solvePathInWorker(
  board: Board,
  candidates: CandidateGrid,
  options: SolvePathOptions,
  signal?: AbortSignal,
): Promise<SolvePathResult> {
  return new Promise((resolve, reject) => {
    const abortError = () => new DOMException('Solve path search cancelled', 'AbortError')
    if (signal?.aborted) {
      reject(abortError())
      return
    }

    let worker: Worker
    try {
      if (typeof Worker === 'undefined') {
        throw new Error('Web Workers unavailable')
      }
      worker = new Worker(new URL('./solvePath.worker.ts', import.meta.url), { type: 'module' })
    } catch {
      try {
        resolve(runOnMainThread(board, candidates, options))
      } catch (error) {
        reject(error)
      }
      return
    }

    const finish = () => {
      signal?.removeEventListener('abort', onAbort)
      worker.terminate()
    }
    const onAbort = () => {
      finish()
      reject(abortError())
    }
    signal?.addEventListener('abort', onAbort)

    worker.onmessage = (event: MessageEvent<SolvePathWorkerResponse>) => {
      finish()
      if ('result' in event.data) {
        resolve(event.data.result)
      } else {
        reject(new Error(event.data.error))
      }
    }
    worker.onerror = (event) => {
      event.preventDefault()
      finish()
      reject(new Error(event.message || 'Solve path worker failed'))
    }

    const request: SolvePathWorkerRequest = { board, candidates, options }
    worker.postMessage(request)
  })
}
