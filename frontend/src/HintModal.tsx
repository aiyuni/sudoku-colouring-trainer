import { useEffect, useId, useRef } from 'react'
import type { TechniqueHint } from './hints'
import type { TutorialTarget } from './tutorial/tutorialLinks'
import { AREA_LAYER, useAnalyticsArea } from './usageTracking'

interface HintModalProps {
  /** Null: no technique applies to the grid right now. */
  hint: TechniqueHint | null
  /** With no hint: a cell's correct digit is missing from its candidates, so
   * the Techniques list is hidden and there is nothing to hint at. */
  wrongCandidates?: boolean
  /** How many of `hint.steps` are shown (at least 1). */
  revealed: number
  onNextHint: () => void
  onClose: () => void
  /** A hint's "Learn this technique" link: open How It Works there. */
  onOpenTutorial: (target: TutorialTarget) => void
}

/** The Techniques tab's Hint popup: the easiest technique on the grid, one
 * hint at a time (see hints.ts for what each one says). Centred over a
 * dimmed backdrop like ConfirmDialog; closes on the X, the Close button,
 * Escape, or a click on the backdrop. */
export default function HintModal({ hint, wrongCandidates = false, revealed, onNextHint, onClose, onOpenTutorial }: HintModalProps) {
  useAnalyticsArea('Hint', AREA_LAYER.dialog)
  const titleId = useId()
  const nextButtonRef = useRef<HTMLButtonElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const listEndRef = useRef<HTMLDivElement>(null)
  // Read through a ref so the setup effect runs once, on open.
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  const steps = hint?.steps.slice(0, revealed) ?? []
  const hasMore = hint !== null && revealed < hint.steps.length

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    ;(nextButtonRef.current ?? closeButtonRef.current)?.focus()

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

  // Keep the newest hint in view, and focus on Close once there are no more.
  useEffect(() => {
    listEndRef.current?.scrollIntoView({ block: 'nearest' })
    if (!hasMore) {
      closeButtonRef.current?.focus()
    }
  }, [revealed, hasMore])

  return (
    <div
      className="confirm-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <div className="confirm-dialog hint-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="confirm-header">
          <span className="hint-icon" aria-hidden="true">
            ?
          </span>
          <h2 id={titleId}>Hint</h2>
          <button type="button" className="hint-close-x" aria-label="Close hint" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="confirm-body">
          {hint === null && wrongCandidates ? (
            <p>
              There are wrong candidates on the grid: a cell's correct digit has been removed from its candidates, so
              no hint can be trusted. Undo the removal, or click "Autofill all" under Candidates.
            </p>
          ) : hint === null ? (
            <p>
              No technique applies to the grid right now. Either the solver can't find one, or the puzzle doesn't have
              full candidates (click "Autofill all" under Candidates).
            </p>
          ) : (
            <ol className="hint-steps">
              {steps.map((step, index) => (
                <li key={index} className={index === steps.length - 1 ? 'hint-step-latest' : undefined}>
                  <span className="hint-step-label">{index === hint.steps.length - 1 && index > 0 ? 'Answer' : `Hint ${index + 1}`}</span>
                  <p>{step.text}</p>
                  {step.learn && (
                    <button type="button" className="hint-learn-link" onClick={() => onOpenTutorial(step.learn!)}>
                      Learn this technique
                    </button>
                  )}
                  {step.lines && step.lines.length > 0 && (
                    <ul>
                      {step.lines.map((line, i) => (
                        <li key={i}>{line}</li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ol>
          )}
          <div ref={listEndRef} />
        </div>
        <div className="confirm-actions">
          <button type="button" ref={closeButtonRef} onClick={onClose}>
            Close
          </button>
          {hasMore && (
            <button type="button" ref={nextButtonRef} className="hint-next" onClick={onNextHint}>
              {revealed === hint.steps.length - 1 ? 'Show answer' : 'Next hint'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
