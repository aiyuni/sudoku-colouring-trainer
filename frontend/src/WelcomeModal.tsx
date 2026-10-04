import { useEffect, useId, useRef, useState } from 'react'
import { AREA_LAYER, useAnalyticsArea } from './usageTracking'

/** Where a link in the popup leads; undefined = just closed. */
export type WelcomeLink = 'learn' | 'dragon-settings' | 'techniques'

interface WelcomeModalProps {
  /** Called on every way out: the Close button, Escape, the backdrop, or one
   * of the links (`link` says which). `neverShowAgain` is the checkbox's
   * state at that moment - a link click with the box ticked counts too. */
  onDismiss: (neverShowAgain: boolean, link?: WelcomeLink) => void
}

/** The popup shown on every page load (until "Never show again" is ticked)
 * telling a new visitor where to start. Same wording and links as the page
 * header, which a phone hides. Reuses the confirm dialog's backdrop and
 * card. */
export default function WelcomeModal({ onDismiss }: WelcomeModalProps) {
  const titleId = useId()
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const [neverShowAgain, setNeverShowAgain] = useState(false)
  useAnalyticsArea('Welcome', AREA_LAYER.dialog)
  // Read through a ref so the setup effect runs once, on open, yet Escape
  // still sees the checkbox's current state.
  const dismissRef = useRef(() => onDismiss(neverShowAgain))
  useEffect(() => {
    dismissRef.current = () => onDismiss(neverShowAgain)
  }, [onDismiss, neverShowAgain])

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    closeButtonRef.current?.focus()

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        dismissRef.current()
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

  return (
    <div
      className="confirm-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onDismiss(neverShowAgain)
        }
      }}
    >
      <div className="confirm-dialog welcome-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="confirm-header">
          <h2 id={titleId}>Quickstart / What is this</h2>
        </div>
        <div className="confirm-body">
          <p>This is an advanced Sudoku solver and trainer emphasizing Colouring techniques, such as Dragon Colouring.  You can import any 3rd-party puzzle or click "Generate Puzzle" to generate a Colouring practice puzzle to start. </p>
          <p>
            <strong>For beginners or Colouring enthusiasts</strong>, use the default settings and click{' '}
            <button type="button" className="help-link" onClick={() => onDismiss(neverShowAgain, 'learn')}>
              Learn techniques
            </button>{' '}
            for a quick overview.
          </p>
          <p>
            <strong>For advanced Colourists and solvers</strong>, learn how to configure your{' '}
            <button type="button" className="help-link" onClick={() => onDismiss(neverShowAgain, 'dragon-settings')}>
              Dragon settings
            </button>{' '}
            and enable your preferred{' '}
            <button type="button" className="help-link" onClick={() => onDismiss(neverShowAgain, 'techniques')}>
              techniques
            </button>
            .
          </p>
        
        </div>
        <div className="confirm-actions welcome-actions">
          <label className="welcome-never">
            <input
              type="checkbox"
              checked={neverShowAgain}
              onChange={(event) => setNeverShowAgain(event.target.checked)}
            />
            Never show again
          </label>
          <button type="button" className="primary" ref={closeButtonRef} onClick={() => onDismiss(neverShowAgain)}>
            Get started
          </button>
        </div>
      </div>
    </div>
  )
}
