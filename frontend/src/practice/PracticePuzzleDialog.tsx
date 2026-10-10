import { useEffect, useId, useRef, useState } from 'react'
import { AREA_LAYER, useAnalyticsArea } from '../usageTracking'
import { generatePracticePuzzle, practiceSearchWindowMs, type PracticeOutcome } from './parallelPracticePuzzle'
import type { PracticePuzzleState } from './practicePuzzleGenerator'
import {
  PRACTICE_CATEGORY_TITLES,
  PRACTICE_TECHNIQUES,
  practiceTargetById,
  practiceTechniqueOfTarget,
  type PracticeCategory,
  type PracticeSolverSettings,
  type PracticeTarget,
} from './practiceTargets'

interface PracticePuzzleDialogProps {
  /** The user's Technique Selections: which techniques can be picked, and
   * what counts as "an easier technique" for the generated state. */
  settings: PracticeSolverSettings
  /** The Generate Puzzle menu's own timeout setting. */
  timeBudgetMs: number
  /** Last pick of this session, so reopening the dialog is one click from
   * another puzzle of the same kind. */
  initialTargetId: string | null
  onTargetChange: (targetId: string) => void
  /** "Start from beginning", likewise remembered for the session by App. */
  fromStart: boolean
  onFromStartChange: (fromStart: boolean) => void
  /** A verified state was found: load it. The dialog closes itself after. */
  onGenerated: (state: PracticePuzzleState, target: PracticeTarget, outcome: PracticeOutcome, fromStart: boolean) => void
  onClose: () => void
}

type Search =
  | { kind: 'idle' }
  | { kind: 'running'; startedAt: number; puzzlesTried: number; now: number; windowMs: number; pickingStock: boolean }
  | { kind: 'ended'; outcome: Exclude<PracticeOutcome, { kind: 'found' }>; targetName: string }

const CATEGORIES: readonly PracticeCategory[] = [0, 1, 2, 3]

function seconds(ms: number): string {
  return ms < 10_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 1000)} s`
}

/**
 * Generate Puzzle -> "More...": pick any non-colouring technique (or one of
 * its named patterns / types) and get a position where it is the easiest
 * technique that makes progress. Four collapsible sections, the groups of
 * Dragon Configuration's technique list with "Defaults" called "Normal".
 *
 * A technique that is switched off can't be picked - its row says where to
 * turn it on - because "easier technique" is judged with the user's own
 * Technique Selections, and the generated state has to show the pick as its
 * easiest row in their Techniques list.
 *
 * The search runs in Web Workers (parallelPracticePuzzle.ts), so the dialog
 * stays live while it runs: a count of puzzles tried, the time against the
 * limit, and a Cancel that stops it at once. When nothing is found in time
 * the dialog says so and stays open for another try or another pick. Same
 * backdrop and card as ConfirmDialog.
 */
export function PracticePuzzleDialog({
  settings,
  timeBudgetMs,
  initialTargetId,
  onTargetChange,
  fromStart,
  onFromStartChange,
  onGenerated,
  onClose,
}: PracticePuzzleDialogProps) {
  useAnalyticsArea('Practice Puzzle Picker', AREA_LAYER.dialog)
  const titleId = useId()
  const [targetId, setTargetId] = useState<string | null>(() => {
    const technique = initialTargetId ? practiceTechniqueOfTarget(initialTargetId) : null
    return technique && technique.disabledReason(settings) === null ? initialTargetId : null
  })
  const selectedTechnique = targetId ? practiceTechniqueOfTarget(targetId) : null
  const selectedTarget = targetId ? practiceTargetById(targetId) : null
  // Brutal and Unfair start collapsed, as in Dragon Configuration - unless
  // the remembered pick is in one of them.
  const [collapsed, setCollapsed] = useState<Record<PracticeCategory, boolean>>(() => ({
    0: false,
    1: false,
    2: selectedTechnique?.category !== 2,
    3: selectedTechnique?.category !== 3,
  }))
  const [search, setSearch] = useState<Search>({ kind: 'idle' })
  const running = search.kind === 'running'
  const abortRef = useRef<AbortController | null>(null)
  const generateButtonRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const latest = useRef({ onClose, running })
  useEffect(() => {
    latest.current = { onClose, running }
  })
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    generateButtonRef.current?.focus()
    // A remembered pick may sit far down the list.
    listRef.current?.querySelector('.practice-technique-selected')?.scrollIntoView({ block: 'nearest' })
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        // Escape stops a running search first; a second one closes.
        if (latest.current.running) {
          abortRef.current?.abort()
        } else {
          latest.current.onClose()
        }
      }
    }
    document.addEventListener('keydown', onKeyDown)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      previouslyFocused?.focus()
      // Closing the dialog any other way must not leave workers grinding.
      abortRef.current?.abort()
    }
  }, [])

  // The clock of a running search (the count arrives from the workers).
  useEffect(() => {
    if (!running) {
      return
    }
    const timer = window.setInterval(() => {
      setSearch((current) => (current.kind === 'running' ? { ...current, now: Date.now() } : current))
    }, 200)
    return () => window.clearInterval(timer)
  }, [running])

  function pick(id: string) {
    if (running) {
      return
    }
    setTargetId(id)
    onTargetChange(id)
    setSearch({ kind: 'idle' })
  }

  async function generate() {
    if (!selectedTarget || running) {
      return
    }
    const controller = new AbortController()
    abortRef.current = controller
    const startedAt = Date.now()
    const windowMs = practiceSearchWindowMs(selectedTarget.id, timeBudgetMs)
    setSearch({ kind: 'running', startedAt, puzzlesTried: 0, now: startedAt, windowMs, pickingStock: false })
    const outcome = await generatePracticePuzzle(
      { targetId: selectedTarget.id, settings, timeBudgetMs, fromStart },
      {
        signal: controller.signal,
        onProgress: (puzzlesTried) =>
          setSearch((current) => (current.kind === 'running' && current.startedAt === startedAt ? { ...current, puzzlesTried } : current)),
        onStockFallback: () =>
          setSearch((current) => (current.kind === 'running' && current.startedAt === startedAt ? { ...current, pickingStock: true } : current)),
      },
    )
    if (abortRef.current !== controller) {
      return
    }
    abortRef.current = null
    if (outcome.kind === 'found') {
      onGenerated(outcome.state, selectedTarget, outcome, fromStart)
      return
    }
    setSearch({ kind: 'ended', outcome, targetName: selectedTarget.name })
  }

  const elapsedMs = search.kind === 'running' ? search.now - search.startedAt : 0

  return (
    <div
      className="confirm-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !running) {
          onClose()
        }
      }}
    >
      <div className="confirm-dialog practice-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="confirm-header">
          <span className="confirm-icon" aria-hidden="true">
            🧩
          </span>
          <h2 id={titleId}>Practice a non-colouring technique</h2>
        </div>
        <div className="confirm-body practice-body">
          <p>
            Select the technique you want to practice, and click "Generate Puzzle" to generate a puzzle state where such a technique exists immediately for you to find.
          </p>
          <div className="practice-categories" aria-disabled={running} ref={listRef}>
            {CATEGORIES.map((category) => {
              const techniques = PRACTICE_TECHNIQUES.filter((technique) => technique.category === category)
              const isCollapsed = collapsed[category]
              const holdsSelection = selectedTechnique?.category === category
              return (
                <section key={category} className="practice-category">
                  <button
                    type="button"
                    className="practice-category-header"
                    aria-expanded={!isCollapsed}
                    onClick={() => setCollapsed((current) => ({ ...current, [category]: !current[category] }))}
                  >
                    <span className="practice-caret" aria-hidden="true">
                      {isCollapsed ? '▸' : '▾'}
                    </span>
                    <span className="practice-category-title">{PRACTICE_CATEGORY_TITLES[category]}</span>
                    <span className="practice-category-count">
                      {holdsSelection && isCollapsed && selectedTarget ? selectedTarget.name : `${techniques.length} techniques`}
                    </span>
                  </button>
                  {!isCollapsed && (
                    <ul className="practice-techniques">
                      {techniques.map((technique) => {
                        const reason = technique.disabledReason(settings)
                        const selected = selectedTechnique?.id === technique.id
                        const [whole, ...patterns] = technique.targets
                        return (
                          <li
                            key={technique.id}
                            className={`practice-technique${selected ? ' practice-technique-selected' : ''}${reason ? ' practice-technique-off' : ''}`}
                          >
                            <button
                              type="button"
                              className="practice-technique-button"
                              role="radio"
                              aria-checked={selected && targetId === whole.id}
                              disabled={reason !== null || running}
                              title={reason ? `${technique.name} is switched off. ${reason}` : undefined}
                              onClick={() => pick(whole.id)}
                            >
                              <span className="practice-radio" aria-hidden="true" />
                              <span className="practice-technique-name">{technique.name}</span>
                              {reason && <span className="practice-off-note">Off - {reason.replace(/^Turn it on/, 'turn it on')}</span>}
                            </button>
                            {patterns.length > 0 && reason === null && (
                              <div className="practice-patterns" role="group" aria-label={`${technique.name} patterns`}>
                                {[whole, ...patterns].map((target) => (
                                  <button
                                    key={target.id}
                                    type="button"
                                    className={`practice-pattern${targetId === target.id ? ' practice-pattern-selected' : ''}`}
                                    aria-pressed={targetId === target.id}
                                    disabled={running}
                                    onClick={() => pick(target.id)}
                                  >
                                    {target.label}
                                  </button>
                                ))}
                              </div>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </section>
              )
            })}
          </div>

          <label
            className="practice-from-start"
            title="Off: the puzzle loads at the point where the technique is needed. On: it loads at its very start (only the givens). Solve it taking the easiest available technique every time and you reach a point where your pick is the easiest way on, with nothing harder needed before it."
          >
            <input type="checkbox" checked={fromStart} disabled={running} onChange={(event) => onFromStartChange(event.target.checked)} />
            <span>
              <b>Start from beginning</b>
              <span className="practice-from-start-note">
                {fromStart
                  ? 'You get the puzzle from the start - the technique is required somewhere in the solving process.'
                  : 'You get the puzzle exactly at a state that requires your technique.'}
              </span>
            </span>
          </label>

          <div className="practice-status" aria-live="polite">
            {search.kind === 'running' ? (
              <>
                <div className="practice-progress" role="progressbar" aria-valuemin={0} aria-valuemax={search.windowMs} aria-valuenow={Math.min(elapsedMs, search.windowMs)}>
                  <div className="practice-progress-bar" style={{ width: `${Math.min(100, (elapsedMs / search.windowMs) * 100)}%` }} />
                </div>
                <p className="practice-status-line">
                  {search.pickingStock
                    ? `None found live in ${seconds(search.windowMs)} - picking a position that needs ${selectedTarget?.name} from the pre-generated collection…`
                    : `Searching for a position that needs ${selectedTarget?.name}… ${search.puzzlesTried.toLocaleString()} puzzle${
                        search.puzzlesTried === 1 ? '' : 's'
                      } tried, ${seconds(elapsedMs)} of ${seconds(search.windowMs)}.`}
                </p>
              </>
            ) : search.kind === 'ended' ? (
              <p className={`practice-status-line practice-status-${search.outcome.kind}`}>
                {search.outcome.kind === 'cancelled'
                  ? `Search cancelled after ${seconds(search.outcome.elapsedMs)}.`
                  : search.outcome.kind === 'timeout'
                    ? `No position that needs ${search.targetName} turned up in ${seconds(search.outcome.elapsedMs)} (${search.outcome.puzzlesTried.toLocaleString()} random puzzles tried). ` +
                      'Such positions are rare with your current Technique Selections - try again, pick the whole technique instead of one pattern, or raise the timeout under Generate Puzzle.'
                    : 'The search could not run in this browser. Nothing was changed on the grid.'}
              </p>
            ) : selectedTarget ? (
              <p className="practice-status-line">
                Selected: <b>{selectedTarget.name}</b>
              </p>
            ) : (
              <p className="practice-status-line practice-status-none">No technique selected yet.</p>
            )}
          </div>
        </div>
        <div className="confirm-actions">
          {running ? (
            <button type="button" onClick={() => abortRef.current?.abort()}>
              Cancel search
            </button>
          ) : (
            <button type="button" onClick={onClose}>
              Close
            </button>
          )}
          <button
            type="button"
            className="confirm-accept practice-generate"
            ref={generateButtonRef}
            disabled={!selectedTarget || running}
            onClick={() => void generate()}
          >
            {running ? 'Generating…' : search.kind === 'ended' && search.outcome.kind !== 'failed' ? 'Try again' : 'Generate puzzle'}
          </button>
        </div>
      </div>
    </div>
  )
}
