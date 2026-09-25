import type { Board, CandidateGrid } from './sudoku/types'
import type { Rule3Technique } from './sudoku/SudokuDragonFinder'
import type { FishTechnique } from './sudoku/SudokuFishFinder'
import { buildSolvePath, type SolvePathResult } from './techniqueEngine'

/** Everything buildSolvePath takes besides the grid - plain data, so it
 * survives the trip into the worker (a Set would too, but an array keeps the
 * message shape obvious). */
export interface SolvePathOptions {
  allowedRule3Techniques: Rule3Technique[]
  shortAicEnabled: boolean
  shortSingleDigitAicEnabled: boolean
  aicLimitPerDragonStep: boolean
  exhaustiveDragon: boolean
  genericAicEnabled: boolean
  easySolveEnabled: boolean
  optimizeDragons: boolean
  optimizeDynamicDragons: boolean
  timeBudgetMs: number
  /** False under the "Disable Dynamic Dragons" setting. */
  dynamicDragonEnabled: boolean
  /** The fish enabled in Settings (none by default). */
  enabledFish: FishTechnique[]
  /** ALS-xz enabled in Settings (off by default). */
  alsXzEnabled: boolean
}

export interface SolvePathWorkerRequest {
  board: Board
  candidates: CandidateGrid
  options: SolvePathOptions
}

export type SolvePathWorkerResponse = { result: SolvePathResult } | { error: string }

/** The Solve Path search, off the main thread (see solvePathInWorker.ts).
 * One request per worker: the caller terminates it afterwards, which is also
 * how a search is cancelled - buildSolvePath never yields, so a "stop"
 * message couldn't be received anyway. */
self.onmessage = (event: MessageEvent<SolvePathWorkerRequest>) => {
  const { board, candidates, options } = event.data
  let response: SolvePathWorkerResponse
  try {
    response = {
      result: buildSolvePath(
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
      ),
    }
  } catch (error) {
    response = { error: error instanceof Error ? error.message : String(error) }
  }
  self.postMessage(response)
}
