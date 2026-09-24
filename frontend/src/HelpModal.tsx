import { useEffect, useRef, useState, type ReactNode } from 'react'
import { HELP_QUICKSTART, HELP_QUICKSTART_HEADING, HELP_TABS, HELP_TITLE } from './helpContent'
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

/** The "Settings guide" dialog: the quickstart box, then one tab per settings
 * menu. All of its wording lives in helpContent.ts; this only lays it out.
 * Closes on the X, the Close button, Escape, or a click on the dimmed
 * backdrop. */
export default function HelpModal({ onClose, onOpenTutorial }: HelpModalProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const tabsRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [tabIndex, setTabIndex] = useState(0)
  const tab = HELP_TABS[tabIndex]
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

  // The quickstart box, tabs and content scroll together (the tab bar sticks
  // at the top), so the box doesn't eat a phone's screen for good. Switching
  // tab after scrolling past the box starts the new tab right under the tab
  // bar, rather than jumping back up to the box or landing mid-tab.
  // Measured from the panel, not the tab bar: a stuck sticky element's
  // offsetTop is where it's stuck, not where it would sit.
  useEffect(() => {
    const scroller = scrollRef.current
    const tabs = tabsRef.current
    const panel = panelRef.current
    if (!scroller || !tabs || !panel) {
      return
    }
    const panelStart = panel.offsetTop - tabs.offsetHeight
    if (scroller.scrollTop > panelStart) {
      scroller.scrollTop = panelStart
    }
    // On a phone the tab bar scrolls sideways - keep the chosen tab in view.
    const active = tabs.children[tabIndex] as HTMLElement | undefined
    if (
      active &&
      (active.offsetLeft < tabs.scrollLeft ||
        active.offsetLeft + active.offsetWidth > tabs.scrollLeft + tabs.clientWidth)
    ) {
      tabs.scrollLeft = active.offsetLeft - 16
    }
  }, [tabIndex])

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

        <div className="help-scroll" ref={scrollRef}>
          <div className="help-quickstart">
            <p className="help-quickstart-heading">{HELP_QUICKSTART_HEADING}</p>
            {HELP_QUICKSTART.split('\n\n').map((paragraph) => (
              <p key={paragraph} className="help-quickstart-text">
                {renderWithLinks(paragraph, onOpenTutorial)}
              </p>
            ))}
          </div>

          <div className="help-tabs" role="tablist" aria-label="Settings menus" ref={tabsRef}>
            {HELP_TABS.map((t, i) => (
              <button
                key={t.label}
                type="button"
                role="tab"
                id={`help-tab-${i}`}
                aria-selected={i === tabIndex}
                aria-controls="help-panel"
                className={['help-tab', i === tabIndex ? 'active' : ''].filter(Boolean).join(' ')}
                onClick={() => setTabIndex(i)}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="help-body" role="tabpanel" id="help-panel" aria-labelledby={`help-tab-${tabIndex}`} ref={panelRef}>
            {tab.intro && <p className="help-tab-intro">{renderWithLinks(tab.intro, onOpenTutorial)}</p>}

            {tab.sections.map((section) => (
              <section key={section.title} className="help-section">
                <h3 className="help-section-title">{section.title}</h3>
                {section.intro && <p className="help-section-intro">{renderWithLinks(section.intro, onOpenTutorial)}</p>}
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
                          {renderWithLinks(paragraph, onOpenTutorial)}
                        </p>
                      ))}
                    </article>
                  )
                })}
              </section>
            ))}
          </div>
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
