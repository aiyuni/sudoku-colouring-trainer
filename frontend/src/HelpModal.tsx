import { useEffect, useRef, type ReactNode } from 'react'
import { HELP_INTRO, HELP_SECTIONS, HELP_TITLE } from './helpContent'
import { describeDefault } from './settingsDefaults'

interface HelpModalProps {
  onClose: () => void
  /** Opens the How It Works page - what a [text](how-it-works) link in the
   * intro (see helpContent.ts) does. */
  onOpenTutorial: () => void
}

/** Renders `text`, turning each [label](how-it-works) into a link button. */
function renderWithLinks(text: string, onOpenTutorial: () => void): ReactNode[] {
  const parts: ReactNode[] = []
  const pattern = /\[([^\]]+)\]\(how-it-works\)/g
  let last = 0
  for (const match of text.matchAll(pattern)) {
    parts.push(text.slice(last, match.index))
    parts.push(
      <button key={match.index} type="button" className="help-link" onClick={onOpenTutorial}>
        {match[1]}
      </button>,
    )
    last = match.index + match[0].length
  }
  parts.push(text.slice(last))
  return parts
}

/** The "Settings guide" dialog. All of its wording lives in helpContent.ts;
 * this only lays it out. Closes on the X, the Close button, Escape, or a
 * click on the dimmed backdrop. */
export default function HelpModal({ onClose, onOpenTutorial }: HelpModalProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  // The setup effect below runs once, on open. Reading onClose through a ref
  // keeps it from re-running (and re-grabbing focus) whenever the parent
  // happens to pass a new function identity on a re-render.
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    closeButtonRef.current?.focus()

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onCloseRef.current()
      }
    }
    document.addEventListener('keydown', onKeyDown)

    // The page behind shouldn't scroll while the dialog is open.
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      previouslyFocused?.focus()
    }
  }, [])

  return (
    <div className="help-backdrop" onClick={onClose}>
      <div
        className="help-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="help-header">
          <h2 id="help-modal-title">{HELP_TITLE}</h2>
          <button type="button" className="help-close" aria-label="Close" onClick={onClose} ref={closeButtonRef}>
            ×
          </button>
        </header>

        <div className="help-body">
          <p className="help-intro">{renderWithLinks(HELP_INTRO, onOpenTutorial)}</p>

          {HELP_SECTIONS.map((section) => (
            <section key={section.title} className="help-section">
              <h3 className="help-section-title">{section.title}</h3>
              {section.intro && <p className="help-section-intro">{section.intro}</p>}
              {section.items.map((item) => {
                const defaultLabel = item.settingKey ? describeDefault(item.settingKey) : item.defaultText
                return (
                  <article key={item.name} className="help-item">
                    <div className="help-item-head">
                      <h4 className="help-item-name">{item.name}</h4>
                      {defaultLabel && (
                        <span className="help-default">
                          Default: <strong>{defaultLabel}</strong>
                        </span>
                      )}
                    </div>
                    {item.description.split('\n\n').map((paragraph) => (
                      <p key={paragraph} className="help-item-description">
                          {renderWithLinks(paragraph, onOpenTutorial)}                      </p>
                    ))}
                  </article>
                )
              })}
            </section>
          ))}
        </div>

        <footer className="help-footer">
          <button type="button" className="primary" onClick={onClose}>
            Close
          </button>
        </footer>
      </div>
    </div>
  )
}
