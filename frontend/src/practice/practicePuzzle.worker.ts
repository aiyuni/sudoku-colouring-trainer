import { generatePracticePuzzleBlocking, type PracticeGenerateOptions, type PracticePuzzleState } from './practicePuzzleGenerator'
import { pickStockPracticePuzzle } from './practicePuzzleStock'
import type { PracticeSolverSettings } from './practiceTargets'

/** What parallelPracticePuzzle.ts asks a worker for. `search`: one
 * independent search - every worker gets the same options and walks its own
 * random puzzles, posting how many it has tried as it goes and exactly one
 * `done` at the end (the state, or null when its time is up). `stock`: pick
 * and re-check a pre-generated position (the re-check is a full Techniques
 * list on a hard grid - too slow for the page's own thread). */
export type PracticeWorkerRequest =
  | { kind: 'search'; options: PracticeGenerateOptions }
  | { kind: 'stock'; targetId: string; settings: PracticeSolverSettings; fromStart: boolean }

export type PracticeWorkerResponse =
  | { kind: 'progress'; puzzlesTried: number }
  | { kind: 'done'; state: PracticePuzzleState | null; puzzlesTried: number }

/** How often a worker reports its count, at most. */
const PROGRESS_INTERVAL_MS = 200

self.onmessage = (event: MessageEvent<PracticeWorkerRequest>) => {
  const request = event.data
  if (request.kind === 'stock') {
    const picked: PracticeWorkerResponse = { kind: 'done', state: pickStockPracticePuzzle(request.targetId, request.settings, Math.random, request.fromStart), puzzlesTried: 0 }
    self.postMessage(picked)
    return
  }
  let lastReport = Date.now()
  const result = generatePracticePuzzleBlocking(request.options, (puzzlesTried) => {
    const now = Date.now()
    if (now - lastReport >= PROGRESS_INTERVAL_MS) {
      lastReport = now
      const progress: PracticeWorkerResponse = { kind: 'progress', puzzlesTried }
      self.postMessage(progress)
    }
  })
  const done: PracticeWorkerResponse = { kind: 'done', state: result.state, puzzlesTried: result.puzzlesTried }
  self.postMessage(done)
}
