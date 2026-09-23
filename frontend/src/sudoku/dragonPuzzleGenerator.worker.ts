import {
  SudokuDragonPuzzleGenerator,
  type DragonPuzzleGenerateOptions,
  type GeneratedDragonPuzzle,
} from './SudokuDragonPuzzleGenerator'

/** One independent search, run by ParallelDragonPuzzleGenerator. Every
 * worker gets the same options and searches its own random solved grids
 * (Math.random is seeded per worker, so no two workers retrace each other),
 * posting exactly one message back: the puzzle, or null on timeout. */
export interface DragonWorkerRequest {
  options: DragonPuzzleGenerateOptions
}

export interface DragonWorkerResponse {
  result: GeneratedDragonPuzzle | null
}

const generator = new SudokuDragonPuzzleGenerator()

self.onmessage = (event: MessageEvent<DragonWorkerRequest>) => {
  const response: DragonWorkerResponse = { result: generator.generateBlocking(event.data.options) }
  self.postMessage(response)
}
