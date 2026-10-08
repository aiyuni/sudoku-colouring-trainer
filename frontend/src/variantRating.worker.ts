import wasmUrl from './variant-rating/variantRating.wasm?url'
import type { VariantRatingRequest } from './variantRating'

/** Messages from the variant rating worker - the same three as the SE
 * rating worker's: `progress` each time the rating so far goes up, then one
 * `done` (ER/EP/ED in tenths) or `error`. */
export type VariantRatingWorkerResponse =
  | { type: 'progress'; tenths: number }
  | { type: 'done'; er: number; ep: number; ed: number }
  | { type: 'error'; message: string }

type Rate = (givens: string, regions: string, cages: string, rules: string) => string

/** variant-rating/ at the repo root (SukakuExplainer's solver plus the Killer
 * techniques), compiled by TeaVM. WebAssembly first, the JavaScript build as
 * the fallback for a browser without WebAssembly GC - both give the same
 * ratings. */
async function loadRate(): Promise<Rate> {
  try {
    const { load } = await import('./variant-rating/wasm-gc-module-runtime.min.js')
    return (await load(wasmUrl)).exports.rateVariantRules as Rate
  } catch {
    return (await import('./variant-rating/variantRating.js')).rateVariantRules as Rate
  }
}

self.onmessage = async (event: MessageEvent<VariantRatingRequest>) => {
  const post = (response: VariantRatingWorkerResponse) => self.postMessage(response)
  try {
    // Called by the compiled code itself (VariantRating.reportProgress).
    ;(globalThis as { variantRatingProgress?: (tenths: number) => void }).variantRatingProgress = (tenths) =>
      post({ type: 'progress', tenths })
    const rate = await loadRate()
    const { givens, regions, cages, rules } = event.data
    const [er, ep, ed] = rate(givens, regions, cages, rules).split('/').map(Number)
    post({ type: 'done', er, ep, ed })
  } catch (error) {
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) })
  }
}
