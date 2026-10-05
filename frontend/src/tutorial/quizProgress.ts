import { useSyncExternalStore } from 'react'

// Which practice quizzes this browser has finished (the ✓ on a Practice pill
// and its sub-tab). Only the quiz ids - no scores, by design: the quiz is
// practice, not a test. Kept in localStorage like the app's other state, and
// never needed for anything to work, so every failure is swallowed.
const STORAGE_KEY = 'sudoku-solver-quizzes-done'

let done: ReadonlySet<string> | null = null
const listeners = new Set<() => void>()

function load(): ReadonlySet<string> {
  if (done) return done
  let ids: string[] = []
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    if (Array.isArray(parsed)) ids = parsed.filter((id): id is string => typeof id === 'string')
  } catch {
    // Unreadable or blocked storage: nothing is marked done.
  }
  done = new Set(ids)
  return done
}

export function markQuizDone(id: string): void {
  if (load().has(id)) return
  // A new Set each time: useSyncExternalStore compares snapshots by identity.
  done = new Set([...load(), id])
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...done]))
  } catch {
    // Private mode: the ✓ lasts until the page is closed.
  }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The ids of the quizzes finished so far; re-renders when one is added. */
export function useQuizzesDone(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, load)
}
