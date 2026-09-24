import { useEffect, useLayoutEffect, useState } from 'react'
import type { BusyTask } from './busyTask'

/** The progress cursor, applied to the whole document (not just the app's
 * own `<main>`) so it also covers the help/tutorial overlays and the page
 * margins. A layout effect so it's in place before the paint that precedes
 * the blocking work. `!important` in the CSS because buttons, links and
 * disabled inputs all set their own `cursor`. */
function useBusyCursor(active: boolean) {
  useLayoutEffect(() => {
    if (!active) {
      return
    }
    const root = document.documentElement
    root.classList.add('app-busy')
    return () => root.classList.remove('app-busy')
  }, [active])
}

// A distinct React key per task object, so the card (and its elapsed-time
// counter) restarts whenever a different operation takes over the indicator.
const taskKeys = new WeakMap<BusyTask, number>()
let nextTaskKey = 0
function keyOf(task: BusyTask): number {
  let key = taskKeys.get(task)
  if (key === undefined) {
    key = nextTaskKey++
    taskKeys.set(task, key)
  }
  return key
}

/**
 * Global "working…" indicator: a small card pinned to the top of the
 * viewport with a spinner and a context-specific message, plus the progress
 * cursor. Rendered only while `task` is non-null, so it disappears on the
 * very render the operation ends in (success, failure or cancel alike).
 *
 * The card fades in after a short delay (pure CSS, see `.busy-indicator`)
 * so the many sub-frame recomputes - a candidate toggled on an easy grid -
 * never flash it; the spinner and the fade are transform/opacity
 * animations, which the browser runs off the main thread, so both still
 * play while the synchronous work has it blocked.
 */
export function BusyIndicator({ task }: { task: BusyTask | null }) {
  useBusyCursor(task !== null)
  return task ? <BusyCard key={keyOf(task)} task={task} /> : null
}

function BusyCard({ task }: { task: BusyTask }) {
  // Seconds since this card appeared. Only ticks while the main thread is
  // free (the worker-based puzzle generation) - during synchronous work
  // nothing can re-render anyway, and that's what the spinner is for.
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const startedAt = Date.now()
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <div className="busy-indicator" role="status" aria-live="polite">
      <span className="busy-spinner" aria-hidden="true" />
      <div className="busy-text">
        <span className="busy-title">{task.title}</span>
        {task.detail && <span className="busy-detail">{task.detail}</span>}
      </div>
      {elapsed >= 2 && <span className="busy-elapsed">{elapsed}s</span>}
      {task.onCancel && (
        <button type="button" className="busy-cancel" onClick={task.onCancel}>
          Cancel
        </button>
      )}
    </div>
  )
}
