import { useEffect, useState } from 'react'

const STORAGE_KEY = 'sudoku-solver-hardware-keyboard-seen'

/** A mouse or trackpad is attached (a laptop, or a tablet with a keyboard
 * cover that has a trackpad) - a good sign a hardware keyboard is too. */
const FINE_POINTER_QUERY = '(any-pointer: fine)'

function readSeen(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }
  return target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT'
}

/**
 * Whether this touch device (the compact layout) can type on the grid: the
 * Keyboard Input switches and keyboard-shortcut settings are pointless on a
 * phone with only an on-screen keyboard, which never even opens for the grid.
 *
 * No browser API says "a hardware keyboard is attached", so this guesses:
 * yes when a fine pointer is present, or once a key press is seen outside a
 * text field (an on-screen keyboard only types into text fields, and
 * Android's reports "Unidentified" keys anyway). A seen keyboard is
 * remembered, so an iPad with a keyboard case keeps the controls after a
 * reload. Always true outside the compact layout - the desktop page is
 * never changed by this.
 */
export function useHasKeyboard(compact: boolean): boolean {
  const [seen, setSeen] = useState(() => readSeen() || window.matchMedia(FINE_POINTER_QUERY).matches)

  useEffect(() => {
    if (seen || !compact) {
      return
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Unidentified' || event.key === 'Process' || isEditable(event.target)) {
        return
      }
      try {
        window.localStorage.setItem(STORAGE_KEY, '1')
      } catch {
        // Private mode / blocked storage: just not remembered.
      }
      setSeen(true)
    }
    const pointerQuery = window.matchMedia(FINE_POINTER_QUERY)
    const onPointerChange = () => {
      if (pointerQuery.matches) {
        setSeen(true)
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    pointerQuery.addEventListener('change', onPointerChange)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      pointerQuery.removeEventListener('change', onPointerChange)
    }
  }, [compact, seen])

  return !compact || seen
}
