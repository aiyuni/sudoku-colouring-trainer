import { useRef, useState, type KeyboardEvent } from 'react'
import {
  DEFAULT_HOTKEYS,
  HOTKEY_ACTIONS,
  HOTKEY_LABELS,
  formatHotkey,
  hotkeysOverlap,
  recordHotkey,
  type HotkeyAction,
  type HotkeyBindings,
} from './hotkeys'

interface HotkeySettingsProps {
  hotkeys: HotkeyBindings
  onChange: (next: HotkeyBindings) => void
}

/** Settings -> Keyboard shortcuts: collapsed to its heading by default, so
 * the rarely-changed bindings don't take up most of the Settings menu;
 * clicking the heading expands it (and the menu starts collapsed again each
 * time it opens, since it unmounts on close). Expanded, one row per action. Clicking a shortcut
 * starts recording and the next key combination pressed becomes it -
 * including Escape, since that is itself a default binding; clicking it
 * again (or tabbing away) cancels. A combination another action already
 * uses moves to this one, and the other is left unbound (said so under the
 * list) rather than two actions silently sharing a key. */
export default function HotkeySettings({ hotkeys, onChange }: HotkeySettingsProps) {
  const [expanded, setExpanded] = useState(false)
  const [recording, setRecording] = useState<HotkeyAction | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  /** Set when a key press was just recorded, so its keyup can't also
   * "click" the button (Space/Enter) and start recording all over again. */
  const recordedKeyRef = useRef(false)

  function onRecordKeyDown(action: HotkeyAction, event: KeyboardEvent<HTMLButtonElement>) {
    if (recording !== action) {
      return
    }
    // Keep the key from the grid's own handler and from the menu's
    // "Escape closes me" listener.
    event.preventDefault()
    event.stopPropagation()
    const result = recordHotkey(action, event)
    if (result === 'pending') {
      return
    }
    if ('error' in result) {
      setMessage(result.error)
      return
    }
    const next = { ...hotkeys, [action]: result }
    const displaced = HOTKEY_ACTIONS.filter((other) => {
      const binding = hotkeys[other]
      return other !== action && binding !== null && hotkeysOverlap(binding, result)
    })
    for (const other of displaced) {
      next[other] = null
    }
    onChange(next)
    recordedKeyRef.current = true
    setRecording(null)
    setMessage(
      displaced.length > 0
        ? `${formatHotkey(result)} was used by "${displaced.map((other) => HOTKEY_LABELS[other]).join('", "')}", which is now unbound.`
        : null,
    )
  }

  const header = (
    <button
      type="button"
      className="hotkey-settings-toggle"
      aria-expanded={expanded}
      aria-controls="hotkey-settings-list"
      onClick={() => {
        setExpanded((current) => !current)
        setRecording(null)
        setMessage(null)
      }}
    >
      <span className="dropdown-section-title">Keyboard shortcuts</span>
      <span className="hotkey-settings-toggle-hint">{expanded ? 'Hide' : 'Customize'}</span>
      <span className="hotkey-settings-chevron" aria-hidden="true">
        {expanded ? '▾' : '▸'}
      </span>
    </button>
  )

  if (!expanded) {
    return header
  }

  return (
    <>
      {header}
      <p className="dropdown-hint">
        Work while the grid or the Solution, Candidates, Candidate Colours or Highlight digit pad is focused.
      </p>
      <div className="hotkey-settings" id="hotkey-settings-list">
        {HOTKEY_ACTIONS.map((action) => {
          const isRecording = recording === action
          const binding = hotkeys[action]
          return (
            <div key={action} className="hotkey-row">
              <span className="hotkey-label">{HOTKEY_LABELS[action]}</span>
              <button
                type="button"
                className={['hotkey-binding', isRecording ? 'recording' : ''].filter(Boolean).join(' ')}
                aria-label={`${HOTKEY_LABELS[action]} shortcut: ${formatHotkey(binding)}. Click to change.`}
                title={`Click, then press the new shortcut. Default: ${formatHotkey(DEFAULT_HOTKEYS[action])}`}
                onClick={() => {
                  setMessage(null)
                  setRecording(isRecording ? null : action)
                }}
                onKeyDown={(event) => onRecordKeyDown(action, event)}
                onKeyUp={(event) => {
                  if (recordedKeyRef.current) {
                    recordedKeyRef.current = false
                    event.preventDefault()
                  }
                }}
                onBlur={() => isRecording && setRecording(null)}
              >
                {isRecording ? 'Press keys…' : formatHotkey(binding)}
              </button>
              <button
                type="button"
                className="hotkey-clear"
                disabled={binding === null}
                aria-label={`Remove the ${HOTKEY_LABELS[action]} shortcut`}
                title="Remove this shortcut"
                onClick={() => {
                  setRecording(null)
                  setMessage(null)
                  onChange({ ...hotkeys, [action]: null })
                }}
              >
                ×
              </button>
            </div>
          )
        })}
        {message && <p className="hotkey-message">{message}</p>}
      </div>
    </>
  )
}
