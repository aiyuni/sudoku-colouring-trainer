import { DEFAULT_RULE3_TECHNIQUES, type Rule3Technique } from './sudoku/SudokuDragonFinder'

/** Every user-adjustable setting, with its default. This is the single
 * source of truth for three things at once: what App's `useState` calls start
 * from, what "Reset to defaults" restores, and the "Default: ..." shown next
 * to each setting in the help page (see helpContent.ts). Change a default
 * here and all three follow.
 *
 * Not in here: the nine candidate paint colours (they're a Record of hex
 * values, kept in App.tsx next to the palette and saved to localStorage) -
 * "Reset to defaults" restores those separately. */
export interface AppSettings {
  keyboardMode: 'solution' | 'candidate'
  showStrongLinks: boolean
  showBivalueCells: boolean
  gridWhiteMode: boolean
  minBaseMedusaFilter: boolean
  shortSingleDigitAicEnabled: boolean
  shortAicEnabled: boolean
  allowedRule3Techniques: readonly Rule3Technique[]
  exhaustiveDragonColouring: boolean
  aicLimitPerDragonStep: boolean
  dynamicDragonAutoSolveIncludesAics: boolean
  dragonGenerationDisregardsSingleDigitAic: boolean
  dragonGenerationDisregardsAic: boolean
  dragonGenerationTimeoutMs: number
}

export const DEFAULT_SETTINGS: AppSettings = {
  keyboardMode: 'solution',
  showStrongLinks: false,
  showBivalueCells: false,
  gridWhiteMode: true,
  minBaseMedusaFilter: false,
  shortSingleDigitAicEnabled: false,
  shortAicEnabled: false,
  allowedRule3Techniques: DEFAULT_RULE3_TECHNIQUES,
  exhaustiveDragonColouring: true,
  aicLimitPerDragonStep: true,
  dynamicDragonAutoSolveIncludesAics: false,
  dragonGenerationDisregardsSingleDigitAic: true,
  dragonGenerationDisregardsAic: true,
  dragonGenerationTimeoutMs: 30_000,
}

/** Threshold for the "Require a bigger base Medusa" toggle - the minimum
 * number of coloured candidates the *starting*, stuck Medusa chain (before
 * any Dragon Colouring extension) must have for a Dragon Colouring or
 * Dynamic Dragon Colouring instance to be shown. */
export const MIN_BASE_MEDUSA_CANDIDATES = 3

/** Options for the "Dragon puzzle generation timeout" setting - how long
 * SudokuDragonPuzzleGenerator.generate() keeps retrying fresh random grids
 * before giving up. A Dynamic-Dragon-only checkpoint especially can be
 * rare, so this is mostly a "how long am I willing to wait" dial rather
 * than a safety cap. */
export const DRAGON_GENERATION_TIMEOUT_OPTIONS: Array<{ label: string; ms: number }> = [
  { label: '15 seconds', ms: 15_000 },
  { label: '30 seconds', ms: 30_000 },
  { label: '1 minute', ms: 60_000 },
  { label: '2 minutes', ms: 120_000 },
  { label: '5 minutes', ms: 300_000 },
]

/** Display labels for the Dynamic Dragon Colouring settings checkboxes -
 * one per Rule3Technique, in the same order findExtensionRule3Move checks
 * them in. */
export const RULE3_TECHNIQUE_LABELS: Record<Rule3Technique, string> = {
  'hidden single': 'Hidden Single',
  'locked candidate': 'Locked Candidates',
  'naked pair': 'Naked Pair',
  'naked triple': 'Naked Triple',
  'naked quad': 'Naked Quad',
  'hidden pair': 'Hidden Pair',
  UR: 'Unique Rectangle',
  'short single-digit aic': 'Short Single-Digit AIC',
  'short aic': 'Short AIC (links <= 5)',
}

/** A setting's default as a human-readable string, for the help page:
 * on/off for checkboxes, the option's own label for choices, the technique
 * names for the Dynamic Dragon technique set. */
export function describeDefault(key: keyof AppSettings): string {
  const value = DEFAULT_SETTINGS[key]
  if (typeof value === 'boolean') {
    return value ? 'On' : 'Off'
  }
  if (key === 'keyboardMode') {
    return value === 'solution' ? 'Solution' : 'Candidates'
  }
  if (key === 'dragonGenerationTimeoutMs') {
    return DRAGON_GENERATION_TIMEOUT_OPTIONS.find((option) => option.ms === value)?.label ?? `${Number(value) / 1000} seconds`
  }
  if (Array.isArray(value)) {
    return value.map((technique) => RULE3_TECHNIQUE_LABELS[technique as Rule3Technique]).join(', ')
  }
  return String(value)
}
