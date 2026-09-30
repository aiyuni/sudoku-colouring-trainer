/** Keyboard shortcuts for the grid and the four pads next to it (Solution,
 * Candidates, Candidate Colours, Highlight digit) - see App's onKeyDown and
 * the Settings -> Keyboard shortcuts section, where each one is rebindable.
 *
 * A binding is stored as plain data (it is an AppSettings value, so it is
 * saved to localStorage and diffed for analytics): the key plus which
 * modifiers must be held. Ctrl and the Mac's Cmd are treated as the same
 * modifier, so the defaults read "Ctrl+Z" but Cmd+Z works too. */

export type HotkeyAction = 'toggleInputMode' | 'candidateDigit' | 'deselect' | 'undo' | 'redo' | 'copyGrid' | 'paste'

export interface Hotkey {
  /** A normalized key name (see keyNameOf): an upper-case letter, a digit,
   * 'Space', or a KeyboardEvent.key name like 'Escape' / 'F2'. For
   * candidateDigit it is always DIGITS_KEY - the binding is only which
   * modifiers turn 1-9 into candidate entry. */
  key: string
  ctrl: boolean
  alt: boolean
  shift: boolean
}

/** Stands for "any of 1-9" in the candidateDigit binding. */
export const DIGITS_KEY = '1-9'

/** null = unbound (the user cleared it). */
export type HotkeyBindings = Record<HotkeyAction, Hotkey | null>

/** Also the order the Settings list shows them in. */
export const HOTKEY_ACTIONS: readonly HotkeyAction[] = [
  'toggleInputMode',
  'candidateDigit',
  'deselect',
  'undo',
  'redo',
  'copyGrid',
  'paste',
]

export const HOTKEY_LABELS: Record<HotkeyAction, string> = {
  toggleInputMode: 'Digits / candidates',
  candidateDigit: 'Enter candidate',
  deselect: 'Deselect cell',
  undo: 'Undo',
  redo: 'Redo',
  copyGrid: 'Copy puzzle as-is',
  paste: 'Paste puzzle',
}

const plain = (key: string): Hotkey => ({ key, ctrl: false, alt: false, shift: false })
const ctrl = (key: string): Hotkey => ({ key, ctrl: true, alt: false, shift: false })

export const DEFAULT_HOTKEYS: HotkeyBindings = {
  toggleInputMode: plain('Space'),
  candidateDigit: ctrl(DIGITS_KEY),
  deselect: plain('Escape'),
  undo: ctrl('Z'),
  redo: ctrl('Y'),
  copyGrid: ctrl('C'),
  paste: ctrl('V'),
}

/** Keys the grid already uses on their own (digit entry, erase, moving the
 * selection) or that keyboard navigation needs - binding one of these with
 * no modifier would take it away, so the recorder refuses them. */
const RESERVED_PLAIN_KEYS = new Set([
  '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
  'Backspace', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'Enter',
])

const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'OS'])

/** The key half of a binding, from a key event. Digits come from `code` so
 * Shift+1 is still "1" (its `key` is "!"); letters are upper-cased so Shift
 * doesn't change them either. */
export function keyNameOf(event: KeyboardEvent | { key: string; code: string }): string {
  const digit = /^(?:Digit|Numpad)([0-9])$/.exec(event.code)
  if (digit) {
    return digit[1]
  }
  if (event.key === ' ' || event.code === 'Space') {
    return 'Space'
  }
  if (event.key.length === 1) {
    return event.key.toUpperCase()
  }
  return event.key
}

type ModifierState = { ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }

function modifiersMatch(hotkey: Hotkey, event: ModifierState): boolean {
  return (
    hotkey.ctrl === (event.ctrlKey || event.metaKey) && hotkey.alt === event.altKey && hotkey.shift === event.shiftKey
  )
}

/** Which action (if any) this key event triggers. For candidateDigit the
 * pressed digit comes back too. */
export function matchHotkey(
  event: ModifierState & { key: string; code: string },
  bindings: HotkeyBindings,
): { action: HotkeyAction; digit?: number } | null {
  const key = keyNameOf(event)
  for (const action of HOTKEY_ACTIONS) {
    const hotkey = bindings[action]
    if (!hotkey || !modifiersMatch(hotkey, event)) {
      continue
    }
    if (action === 'candidateDigit') {
      if (key >= '1' && key <= '9' && key.length === 1) {
        return { action, digit: Number(key) }
      }
    } else if (hotkey.key === key) {
      return { action }
    }
  }
  return null
}

/** What the recorder makes of a key press: a binding, 'pending' while only
 * modifiers are held, or an error to show. */
export function recordHotkey(
  action: HotkeyAction,
  event: ModifierState & { key: string; code: string },
): Hotkey | 'pending' | { error: string } {
  if (MODIFIER_KEYS.has(event.key)) {
    return 'pending'
  }
  const key = keyNameOf(event)
  const hotkey: Hotkey = { key, ctrl: event.ctrlKey || event.metaKey, alt: event.altKey, shift: event.shiftKey }
  const hasModifier = hotkey.ctrl || hotkey.alt || hotkey.shift
  if (action === 'candidateDigit') {
    if (!(key >= '1' && key <= '9' && key.length === 1)) {
      return { error: 'Hold a modifier and press any digit 1-9.' }
    }
    if (!hasModifier) {
      return { error: 'Needs a modifier (Ctrl, Alt or Shift) - plain 1-9 already enters digits.' }
    }
    return { ...hotkey, key: DIGITS_KEY }
  }
  if (!hasModifier && RESERVED_PLAIN_KEYS.has(key)) {
    return { error: `${key} on its own is already used by the grid - add a modifier.` }
  }
  return hotkey
}

/** Whether two bindings would fire on the same key press. */
export function hotkeysOverlap(a: Hotkey, b: Hotkey): boolean {
  if (a.ctrl !== b.ctrl || a.alt !== b.alt || a.shift !== b.shift) {
    return false
  }
  const isDigit = (key: string) => key === DIGITS_KEY || (key.length === 1 && key >= '1' && key <= '9')
  if (a.key === DIGITS_KEY || b.key === DIGITS_KEY) {
    return isDigit(a.key) && isDigit(b.key)
  }
  return a.key === b.key
}

/** The browser's own paste shortcut. A binding equal to it is served from
 * the native `paste` event (which carries the clipboard with no permission
 * prompt); any other binding has to ask navigator.clipboard.read(). */
export function isNativePasteHotkey(hotkey: Hotkey | null): boolean {
  return hotkey !== null && hotkey.ctrl && !hotkey.alt && !hotkey.shift && hotkey.key === 'V'
}

export function formatHotkey(hotkey: Hotkey | null): string {
  if (!hotkey) {
    return 'None'
  }
  return [hotkey.ctrl && 'Ctrl', hotkey.alt && 'Alt', hotkey.shift && 'Shift', hotkey.key].filter(Boolean).join(' + ')
}

function isHotkey(value: unknown): value is Hotkey {
  if (!value || typeof value !== 'object') {
    return false
  }
  const { key, ctrl, alt, shift } = value as Record<string, unknown>
  return typeof key === 'string' && key !== '' && typeof ctrl === 'boolean' && typeof alt === 'boolean' && typeof shift === 'boolean'
}

/** A saved bindings object, validated per action: a missing or malformed
 * entry takes its default, an explicit null stays unbound. */
export function readHotkeyBindings(value: unknown): HotkeyBindings | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }
  const saved = value as Record<string, unknown>
  const result = { ...DEFAULT_HOTKEYS }
  for (const action of HOTKEY_ACTIONS) {
    const entry = saved[action]
    if (entry === null) {
      result[action] = null
    } else if (isHotkey(entry) && (action !== 'candidateDigit' || entry.key === DIGITS_KEY)) {
      result[action] = { key: entry.key, ctrl: entry.ctrl, alt: entry.alt, shift: entry.shift }
    }
  }
  return result
}
