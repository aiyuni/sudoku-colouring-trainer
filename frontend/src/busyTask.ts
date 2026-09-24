import { useEffect, useState } from 'react'

/** One long-running operation the global busy indicator is showing. */
export interface BusyTask {
  /** Headline, e.g. "Generating a Dragon Colouring practice puzzle…". */
  title: string
  /** Optional second line saying what's actually going on / how long it may take. */
  detail?: string
  /** Shown as a Cancel button when present (only for work that can really be
   * stopped - the async, worker-based puzzle generation). */
  onCancel?: () => void
}

/**
 * Runs `callback` once the browser has painted the current frame, and
 * returns a function that cancels it if it hasn't run yet.
 *
 * Nearly every long operation in this app is synchronous and CPU-bound, so
 * it blocks the main thread: anything React commits right before it (the
 * indicator, the busy cursor) is only ever seen if a paint happens *between*
 * that commit and the work starting. A bare `setTimeout(0)` doesn't
 * guarantee that - the browser may run the timeout before its next frame.
 * `requestAnimationFrame` runs just before a paint, so a timeout queued from
 * inside it runs just after one. rAF never fires in a background tab, hence
 * the plain-timeout fallback so the work can't stall there.
 */
export function afterPaint(callback: () => void): () => void {
  let done = false
  let afterFrameTimer = 0
  const run = () => {
    if (!done) {
      done = true
      callback()
    }
  }
  const frame = requestAnimationFrame(() => {
    afterFrameTimer = window.setTimeout(run, 0)
  })
  const fallbackTimer = window.setTimeout(run, 100)
  return () => {
    done = true
    cancelAnimationFrame(frame)
    window.clearTimeout(afterFrameTimer)
    window.clearTimeout(fallbackTimer)
  }
}

/**
 * Returns `[settled, pending]`: `settled` lags `value` by one painted frame.
 *
 * Expensive derived data (the Techniques list, the solvability check) is
 * computed in render from `settled` instead of `value`, so when an input
 * changes React first commits a cheap render - `pending` true, busy
 * indicator up, every heavy memo still a cache hit - and only after that has
 * been painted does it re-render with the new value and pay for the
 * recompute. Without this, the page just froze with no feedback, sometimes
 * for several seconds (a fresh solve-path search runs on every board change).
 * `useDeferredValue` looks like the tool for this but doesn't promise a paint
 * before the deferred render either (see afterPaint).
 */
export function useSettledValue<T>(value: T): [T, boolean] {
  const [settled, setSettled] = useState(value)
  const pending = !Object.is(settled, value)
  useEffect(() => {
    if (!pending) {
      return
    }
    return afterPaint(() => setSettled(() => value))
  }, [value, pending])
  return [settled, pending]
}
