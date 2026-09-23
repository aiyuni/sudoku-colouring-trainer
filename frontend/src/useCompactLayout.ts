import { useSyncExternalStore } from 'react'

/** When the app switches from the desktop three-column layout to the
 * touch layout (grid pinned, every control group behind a tab in a dock
 * that scrolls on its own - see the `compact-*` rules in App.css).
 *
 * Gated on `pointer: coarse` on purpose: the desktop/laptop layout must stay
 * exactly as it is, including in a narrowed browser window, so width alone
 * never triggers it. Phones and tablets all report a coarse pointer (as does
 * Chrome DevTools' device mode, which emulates touch). The height clause
 * catches tablets in landscape (iPad mini/Air/11" Pro, Galaxy Tab) that are
 * wide enough for the desktop columns but too short for them: the page
 * would need scrolling past the grid to reach what's under it. The 13"
 * iPad Pro in landscape (~950px tall once Safari's bars are counted) is the
 * one tablet the desktop layout already fits, so it keeps that. */
const COMPACT_LAYOUT_QUERY = '(pointer: coarse) and (max-width: 1099px), (pointer: coarse) and (max-height: 900px)'

/** Within the compact layout: a phone in either orientation (its short side
 * is under 600px). Phones get the one-row toolbar with an overflow menu
 * instead of the full toolbar plus title, since every pixel of height above
 * the grid comes out of the dock below it. */
const PHONE_LAYOUT_QUERY = '(max-width: 599px), (max-height: 599px)'

const LANDSCAPE_QUERY = '(orientation: landscape)'

function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mediaQueryList = window.matchMedia(query)
      mediaQueryList.addEventListener('change', onChange)
      return () => mediaQueryList.removeEventListener('change', onChange)
    },
    () => window.matchMedia(query).matches,
    () => false,
  )
}

export interface CompactLayout {
  /** Touch layout on (see COMPACT_LAYOUT_QUERY); the other two are only
   * meaningful while this is true. */
  compact: boolean
  phone: boolean
  landscape: boolean
}

export function useCompactLayout(): CompactLayout {
  const compact = useMediaQuery(COMPACT_LAYOUT_QUERY)
  const phone = useMediaQuery(PHONE_LAYOUT_QUERY)
  const landscape = useMediaQuery(LANDSCAPE_QUERY)
  return { compact, phone: compact && phone, landscape: compact && landscape }
}
