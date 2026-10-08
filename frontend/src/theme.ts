/** Colour themes (Settings -> Theme). A theme is one of two schemes - light
 * or dark, which is what every `[data-scheme="dark"]` rule in the
 * stylesheets keys on - plus, for the named ones, its own palette
 * (themes.css, keyed on data-theme). 'system' follows the device's
 * light/dark setting, as the app always did before there was a choice. */
export const THEME_OPTIONS = [
  { id: 'system', label: 'System default', scheme: null },
  { id: 'light', label: 'Light', scheme: 'light' },
  { id: 'dark', label: 'Dark', scheme: 'dark' },
  { id: 'sepia', label: 'Sepia', scheme: 'light' },
  { id: 'solarized-light', label: 'Solarized Light', scheme: 'light' },
  { id: 'solarized-dark', label: 'Solarized Dark', scheme: 'dark' },
  { id: 'nord', label: 'Nord', scheme: 'dark' },
  { id: 'dracula', label: 'Dracula', scheme: 'dark' },
  { id: 'midnight', label: 'Midnight (black)', scheme: 'dark' },
  { id: 'dragon', label: 'Dragon', scheme: 'dark' },
  { id: 'medusa', label: 'Medusa', scheme: 'dark' },
  { id: 'rainbow', label: 'Rainbow', scheme: 'light' },
] as const

export type ThemeId = (typeof THEME_OPTIONS)[number]['id']

export function isThemeId(value: unknown): value is ThemeId {
  return THEME_OPTIONS.some((option) => option.id === value)
}

const SYSTEM_DARK_QUERY = '(prefers-color-scheme: dark)'

/** Puts the theme on <html> and, for 'system', keeps it in step with the
 * device setting. Returns the clean-up that stops following it. */
export function applyTheme(theme: ThemeId): () => void {
  const root = document.documentElement
  const fixed = THEME_OPTIONS.find((option) => option.id === theme)?.scheme ?? null
  root.dataset.theme = theme
  if (fixed) {
    root.dataset.scheme = fixed
    return () => {}
  }
  const query = window.matchMedia(SYSTEM_DARK_QUERY)
  const follow = () => {
    root.dataset.scheme = query.matches ? 'dark' : 'light'
  }
  follow()
  query.addEventListener('change', follow)
  return () => query.removeEventListener('change', follow)
}
