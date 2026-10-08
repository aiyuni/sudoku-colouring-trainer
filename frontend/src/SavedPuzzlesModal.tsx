import { useEffect, useId, useRef, useState } from 'react'
import {
  MAX_SAVED_PUZZLES,
  SAVED_PUZZLE_NAME_MAX_LENGTH,
  filledCellCount,
  savedPuzzleNamed,
  unusedSavedPuzzleName,
  type SavedPuzzle,
} from './savedPuzzles'
import { AREA_LAYER, useAnalyticsArea } from './usageTracking'

interface SavedPuzzlesModalProps {
  /** This page's list, most recently saved first. */
  puzzles: SavedPuzzle[]
  /** The save of the puzzle now on the grid, if it has one: Save updates it. */
  current: SavedPuzzle | undefined
  /** False while there is nothing on the grid to save. */
  canSave: boolean
  /** "Variant Solver" on the Variant page - the analytics area's prefix. */
  areaPrefix: string
  /** Saves the grid; `replaceId` = the entry to overwrite. Returns an error
   * message to show, or null when it worked. */
  onSave: (name: string, replaceId: string | null) => string | null
  onOpen: (puzzle: SavedPuzzle) => void
  /** Returns an error message to show, or null when it worked. */
  onDelete: (puzzle: SavedPuzzle) => string | null
  onClose: () => void
}

function savedAt(time: number): string {
  if (!time) {
    return ''
  }
  try {
    return new Date(time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  } catch {
    return new Date(time).toLocaleString()
  }
}

/** The Saved Puzzles dialog: name and save the puzzle on the grid, and open
 * or delete an earlier save. One dialog for both rather than a Save prompt
 * and a separate list - the list is where you check a name isn't taken.
 * Reuses the confirm dialog's backdrop and card.
 *
 * Duplicate names: saving under the name of the save this same puzzle
 * already has just updates it (that is what saving your progress again
 * means); a name another puzzle's save uses asks whether to replace that
 * one or keep both ("name (2)"). A delete asks in the row itself first. */
export default function SavedPuzzlesModal({
  puzzles,
  current,
  canSave,
  areaPrefix,
  onSave,
  onOpen,
  onDelete,
  onClose,
}: SavedPuzzlesModalProps) {
  const titleId = useId()
  const nameInputRef = useRef<HTMLInputElement>(null)
  useAnalyticsArea(areaPrefix ? `${areaPrefix} › Saved Puzzles` : 'Saved Puzzles', AREA_LAYER.dialog)
  const [name, setName] = useState(() => current?.name ?? unusedSavedPuzzleName(puzzles, `Puzzle ${puzzles.length + 1}`))
  /** The entry whose name the typed one clashes with, awaiting an answer. */
  const [clash, setClash] = useState<SavedPuzzle | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [savedId, setSavedId] = useState<string | null>(null)

  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    // Not on a touch screen: focusing a text field there brings up the
    // keyboard over the list, when the visit may be to open a save.
    let touch = false
    try {
      touch = window.matchMedia('(pointer: coarse)').matches
    } catch {
      touch = false
    }
    if (!touch) {
      nameInputRef.current?.focus()
      nameInputRef.current?.select()
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onCloseRef.current()
      }
    }
    document.addEventListener('keydown', onKeyDown)

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      previouslyFocused?.focus()
    }
  }, [])

  const trimmed = name.trim()
  const updatesCurrent = !!current && savedPuzzleNamed(puzzles, trimmed)?.id === current.id

  function save(saveName: string, replaceId: string | null) {
    const failure = onSave(saveName, replaceId)
    setClash(null)
    setError(failure)
    if (!failure) {
      setName(saveName)
      setSavedId(replaceId ?? 'new')
    }
  }

  function submit() {
    if (!canSave || trimmed === '') {
      return
    }
    const existing = savedPuzzleNamed(puzzles, trimmed)
    if (!existing) {
      save(trimmed, null)
    } else if (existing.id === current?.id) {
      save(trimmed, existing.id)
    } else {
      setClash(existing)
    }
  }

  function remove(puzzle: SavedPuzzle) {
    setConfirmDeleteId(null)
    setError(onDelete(puzzle))
  }

  return (
    <div
      className="confirm-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <div className="confirm-dialog saved-puzzles-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="confirm-header">
          <h2 id={titleId}>Saved puzzles</h2>
        </div>
        <div className="confirm-body">
          <form
            className="saved-puzzles-save"
            onSubmit={(event) => {
              event.preventDefault()
              submit()
            }}
          >
            <label className="saved-puzzles-label" htmlFor={`${titleId}-name`}>
              Save the puzzle on the grid as
            </label>
            <div className="saved-puzzles-save-row">
              <input
                id={`${titleId}-name`}
                ref={nameInputRef}
                type="text"
                value={name}
                maxLength={SAVED_PUZZLE_NAME_MAX_LENGTH}
                placeholder="Name this puzzle"
                autoComplete="off"
                disabled={!canSave}
                onChange={(event) => {
                  setName(event.target.value)
                  setClash(null)
                  setSavedId(null)
                }}
              />
              <button type="submit" className="primary" disabled={!canSave || trimmed === ''}>
                {updatesCurrent ? 'Save progress' : 'Save'}
              </button>
            </div>
            {!canSave ? (
              <p className="saved-puzzles-note">The grid is empty - there is nothing to save yet.</p>
            ) : clash ? (
              <div className="saved-puzzles-clash" role="alert">
                <p>
                  A saved puzzle is already called <b>{clash.name}</b>.
                </p>
                <div className="saved-puzzles-clash-actions">
                  <button type="button" onClick={() => save(clash.name, clash.id)}>
                    Replace it
                  </button>
                  <button type="button" onClick={() => save(unusedSavedPuzzleName(puzzles, trimmed), null)}>
                    Keep both
                  </button>
                  <button type="button" onClick={() => setClash(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : savedId && !error ? (
              <p className="saved-puzzles-note saved-puzzles-done" role="status">
                Saved ✓
              </p>
            ) : updatesCurrent ? (
              <p className="saved-puzzles-note">
                This puzzle is already saved as <b>{current?.name}</b> - saving updates it. Type another name to keep a
                separate copy.
              </p>
            ) : (
              <p className="saved-puzzles-note">
                Digits, candidates and colours are all saved - in this browser, on this device only.
              </p>
            )}
            {error && (
              <p className="saved-puzzles-error" role="alert">
                {error}
              </p>
            )}
          </form>

          {puzzles.length === 0 ? (
            <p className="saved-puzzles-empty">
              No saved puzzles yet. Save the one you are working on and it will be waiting here when you come back.
            </p>
          ) : (
            <ul className="saved-puzzles-list">
              {puzzles.map((puzzle) => (
                <li key={puzzle.id} className={puzzle.id === current?.id ? 'saved-puzzle saved-puzzle-current' : 'saved-puzzle'}>
                  <div className="saved-puzzle-text">
                    <span className="saved-puzzle-name">{puzzle.name}</span>
                    <span className="saved-puzzle-meta">
                      {[puzzle.kind, puzzle.rating, `${filledCellCount(puzzle.grid)}/81 filled`, savedAt(puzzle.updatedAt)]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </div>
                  {confirmDeleteId === puzzle.id ? (
                    <div className="saved-puzzle-actions" role="alert">
                      <span className="saved-puzzle-confirm">Delete for good?</span>
                      <button type="button" className="saved-puzzle-delete" data-track="Delete saved puzzle (confirm)" onClick={() => remove(puzzle)}>
                        Delete
                      </button>
                      <button type="button" data-track="Delete saved puzzle (cancel)" onClick={() => setConfirmDeleteId(null)}>
                        Keep
                      </button>
                    </div>
                  ) : (
                    <div className="saved-puzzle-actions">
                      <button type="button" className="primary" data-track="Open saved puzzle" onClick={() => onOpen(puzzle)}>
                        Open
                      </button>
                      <button
                        type="button"
                        data-track="Delete saved puzzle"
                        aria-label={`Delete ${puzzle.name}`}
                        onClick={() => setConfirmDeleteId(puzzle.id)}
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          {puzzles.length >= MAX_SAVED_PUZZLES && (
            <p className="saved-puzzles-note">The list is full ({MAX_SAVED_PUZZLES}) - delete one to save another.</p>
          )}
        </div>
        <div className="confirm-actions">
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
