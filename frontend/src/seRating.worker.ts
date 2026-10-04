import wasmUrl from './se-rating/seRating.wasm?url'

/** Messages from the SE rating worker: `progress` each time the rating so
 * far goes up (the final rating can only be that or higher), then one
 * `done` (ER/EP/ED, all in tenths) or `error`. */
export type SeRatingWorkerResponse =
  | { type: 'progress'; tenths: number }
  | { type: 'done'; er: number; ep: number; ed: number }
  | { type: 'error'; message: string }

/** Sudoku Explainer's own rating code (se-rating/ at the repo root, compiled
 * from its Java by TeaVM). The WebAssembly build is about 2.5x faster than
 * the JavaScript one, which is only the fallback for a browser without
 * WebAssembly GC (before Chrome 119 / Firefox 120 / Safari 18.2) - both give
 * exactly the same ratings. */
async function loadRate(): Promise<(puzzle: string) => string> {
  try {
    const { load } = await import('./se-rating/wasm-gc-module-runtime.min.js')
    return (await load(wasmUrl)).exports.rate
  } catch {
    return (await import('./se-rating/seRating.js')).rate
  }
}

self.onmessage = async (event: MessageEvent<string>) => {
  const post = (response: SeRatingWorkerResponse) => self.postMessage(response)
  try {
    // Called by the compiled code itself (SeRating.reportProgress).
    ;(globalThis as { seRatingProgress?: (tenths: number) => void }).seRatingProgress = (tenths) =>
      post({ type: 'progress', tenths })
    const rate = await loadRate()
    const [er, ep, ed] = rate(event.data).split('/').map(Number)
    post({ type: 'done', er, ep, ed })
  } catch (error) {
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) })
  }
}
