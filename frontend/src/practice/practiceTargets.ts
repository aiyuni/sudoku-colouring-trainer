import { FISH_TECHNIQUE_NAMES, type FishTechnique } from '../sudoku/SudokuFishFinder'
import type { Rule3Technique } from '../sudoku/SudokuDragonFinder'
import { RULE3_TECHNIQUE_GROUPS } from '../settingsDefaults'
import {
  RANK_ALS_AIC,
  RANK_ALS_XZ,
  RANK_AVOIDABLE_RECTANGLE,
  RANK_BIVALUE_ODDAGON,
  RANK_BUG_PLUS_N,
  RANK_EXTENDED_UR,
  RANK_FINNED_SWORDFISH,
  RANK_FINNED_X_WING,
  RANK_GENERIC_AIC,
  RANK_GROUPED_AIC,
  RANK_LOCKED_CANDIDATE,
  RANK_SHORT_AIC,
  RANK_SHORT_SINGLE_DIGIT_AIC,
  RANK_SINGLE,
  RANK_SUBSET,
  RANK_SUE_DE_COQ,
  RANK_SWORDFISH,
  RANK_UR,
  RANK_UR_AIC,
  RANK_X_WING,
  type ExoticTechnique,
  type TechniqueInstance,
} from '../techniqueEngine'

/** The technique switches that decide what "an easier technique" is for a
 * practice puzzle: the user's own Technique Selections, so the generated
 * state's Techniques list shows the chosen technique as its easiest row.
 * Plain data (it crosses to the generator's Web Workers). Dynamic and Double
 * Dynamic Dragon are not here: they rank above every technique this targets. */
export interface PracticeSolverSettings {
  shortSingleDigitAicEnabled: boolean
  shortAicEnabled: boolean
  genericAicEnabled: boolean
  enabledFish: FishTechnique[]
  alsXzEnabled: boolean
  urAicEnabled: boolean
  alsAicEnabled: boolean
  groupedAicEnabled: boolean
  enabledExotic: ExoticTechnique[]
  doubleDragonEnabled: boolean
}

/** The dialog's four sections, in the order (and with the membership) of
 * Dragon Configuration's technique list - RULE3_TECHNIQUE_GROUPS - whose
 * first section, "Defaults", is called "Normal" here (by request: this dialog
 * only). */
export const PRACTICE_CATEGORY_TITLES = ['Normal', 'Advanced', 'Brutal', 'Unfair'] as const
export type PracticeCategory = 0 | 1 | 2 | 3

/** One thing a puzzle can be generated for: a technique, or one named
 * pattern / type of it. `matches` reads a Techniques-list row and says
 * whether it is this - the list's own rows are the only detection there is,
 * so a target can never disagree with what the panel shows. */
export interface PracticeTarget {
  /** Permanent: test fixtures, the stock and analytics are keyed by it. */
  id: string
  /** The pattern's name inside its technique ("Type 4", "Skyscraper"), or
   * "Any" for the whole technique. */
  label: string
  /** The full name, for status lines: "Unique Rectangle (Type 4)". */
  name: string
  matches: (instance: TechniqueInstance) => boolean
}

export interface PracticeTechnique {
  id: string
  name: string
  category: PracticeCategory
  /** At least one. With more than one the first is the whole technique
   * ("Any") and the rest its patterns. */
  targets: PracticeTarget[]
  /** Null when the technique is switched on (or can't be switched off);
   * otherwise what to tell the user. */
  disabledReason: (settings: PracticeSolverSettings) => string | null
}

const idStarts = (prefix: string) => (instance: TechniqueInstance) => instance.id.startsWith(prefix)
const alwaysOn = () => null
const needs = (on: (settings: PracticeSolverSettings) => boolean, where: string) => (settings: PracticeSolverSettings) =>
  on(settings) ? null : `Turn it on in ${where} first.`

/** The section a Rule3Technique is listed in under Dragon Configuration. */
function categoryOfRule3(technique: Rule3Technique): PracticeCategory {
  const index = RULE3_TECHNIQUE_GROUPS.findIndex((group) => group.techniques.includes(technique))
  if (index < 0 || index > 3) {
    throw new Error(`No Dragon Configuration group for ${technique}`)
  }
  return index as PracticeCategory
}

/** A technique with no patterns of its own. */
function single(
  id: string,
  name: string,
  category: PracticeCategory,
  matches: (instance: TechniqueInstance) => boolean,
  disabledReason: (settings: PracticeSolverSettings) => string | null = alwaysOn,
): PracticeTechnique {
  return { id, name, category, targets: [{ id, label: name, name, matches }], disabledReason }
}

/** A technique whose rows are one of several named patterns: "Any" first,
 * then each pattern. */
function family(
  id: string,
  name: string,
  category: PracticeCategory,
  any: (instance: TechniqueInstance) => boolean,
  patterns: readonly { id: string; label: string; name?: string; matches: (instance: TechniqueInstance) => boolean }[],
  disabledReason: (settings: PracticeSolverSettings) => string | null = alwaysOn,
): PracticeTechnique {
  return {
    id,
    name,
    category,
    targets: [
      { id, label: 'Any', name, matches: any },
      ...patterns.map((pattern) => ({
        id: `${id}/${pattern.id}`,
        label: pattern.label,
        // A pattern with a name of its own goes by it, as everywhere in the app.
        name: pattern.name ?? `${name} (${pattern.label})`,
        matches: pattern.matches,
      })),
    ],
    disabledReason,
  }
}

const fish = (technique: FishTechnique): PracticeTechnique =>
  single(
    technique.replace(/ /g, '-'),
    FISH_TECHNIQUE_NAMES[technique],
    categoryOfRule3(technique),
    (instance) => instance.id.startsWith('fish-') && instance.name === FISH_TECHNIQUE_NAMES[technique],
    needs((settings) => settings.enabledFish.includes(technique), 'Technique Selections → Techniques'),
  )

const SINGLE_DIGIT = 'short-single-digit-aic-'
const SHORT = 'short-aic-'
const UR_TYPES = ['1', '2', '3', '4', '5', '7a', '7b', '7c', '7d'] as const

/** Every technique the "More..." dialog offers, in difficulty order within
 * its section. The colouring techniques (Simple Colouring, 3D Medusa, the
 * Dragons) are deliberately not here, by request: the Generate Puzzle menu
 * has their own buttons. A technique ranked between them still has them as
 * "easier techniques" - they are always on. */
export const PRACTICE_TECHNIQUES: readonly PracticeTechnique[] = [
  single('naked-single', 'Naked Single', 0, idStarts('naked-single-')),
  single('hidden-single', 'Hidden Single', 0, idStarts('hidden-single-')),
  family('locked-candidate', 'Locked Candidate', categoryOfRule3('locked candidate'), idStarts('locked-candidate-'), [
    { id: 'pointing', label: 'Pointing', matches: idStarts('locked-candidate-pointing-') },
    { id: 'claiming', label: 'Claiming', matches: idStarts('locked-candidate-claiming-') },
  ]),
  single('naked-pair', 'Naked Pair', categoryOfRule3('naked pair'), idStarts('naked-pair-')),
  single('naked-triple', 'Naked Triple', categoryOfRule3('naked triple'), idStarts('naked-triple-')),
  single('naked-quad', 'Naked Quad', categoryOfRule3('naked quad'), idStarts('naked-quad-')),
  single('hidden-pair', 'Hidden Pair', categoryOfRule3('hidden pair'), idStarts('hidden-pair-')),
  family(
    'unique-rectangle',
    'Unique Rectangle',
    categoryOfRule3('UR'),
    idStarts('ur-'),
    // A row that merges several types ("Types 4 & 7b") is none of these:
    // its id is `ur-types4&7b-...`.
    UR_TYPES.map((type) => ({
      id: `type-${type}`,
      label: type === '7d' ? 'Type 7d, Hidden Rectangle' : `Type ${type}`,
      matches: idStarts(`ur-type${type}-`),
    })),
  ),
  family('bug-plus-n', 'BUG+N', categoryOfRule3('BUG+N'), idStarts('bug-plus-n-'), [
    { id: '1', label: 'BUG+1', name: 'BUG+1', matches: idStarts('bug-plus-n-1-') },
    { id: '2', label: 'BUG+2', name: 'BUG+2', matches: idStarts('bug-plus-n-2-') },
    { id: '3', label: 'BUG+3', name: 'BUG+3', matches: idStarts('bug-plus-n-3-') },
  ]),
  family('avoidable-rectangle', 'Avoidable Rectangle', categoryOfRule3('avoidable rectangle'), idStarts('avoidable-rectangle-'), [
    { id: 'type-1', label: 'Type 1', matches: idStarts('avoidable-rectangle-1-') },
    { id: 'type-2', label: 'Type 2', matches: idStarts('avoidable-rectangle-2-') },
  ]),
  family('bivalue-oddagon', 'Bivalue Oddagon', categoryOfRule3('bivalue oddagon'), idStarts('bivalue-oddagon-'), [
    { id: 'type-1', label: 'Type 1', matches: idStarts('bivalue-oddagon-1-') },
    { id: 'type-2', label: 'Type 2', matches: idStarts('bivalue-oddagon-2-') },
  ]),

  fish('x-wing'),
  family(
    'short-single-digit-aic',
    'Short Single-Digit AIC',
    categoryOfRule3('short single-digit aic'),
    idStarts(SINGLE_DIGIT),
    // The four names are every short single-digit chain there is: 17k random
    // puzzles walked for an unnamed one (2026-10-09) turned up none, so
    // there is no "unnamed chain" to offer here, unlike Short AIC below.
    (['Skyscraper', 'Two-String Kite', 'Crane', 'Empty Rectangle'] as const).map((pattern) => ({
      id: pattern.toLowerCase().replace(/ /g, '-'),
      label: pattern,
      name: pattern,
      matches: (instance: TechniqueInstance) => instance.id.startsWith(SINGLE_DIGIT) && instance.aicPattern === pattern,
    })),
    needs((settings) => settings.shortSingleDigitAicEnabled, 'Technique Selections → Techniques'),
  ),
  fish('finned x-wing'),
  family(
    'short-aic',
    'Short AIC',
    categoryOfRule3('short aic'),
    idStarts(SHORT),
    [
      ...(['W-Wing', 'Y-Wing'] as const).map((pattern) => ({
        id: pattern.toLowerCase(),
        label: pattern,
        name: pattern,
        matches: (instance: TechniqueInstance) => instance.id.startsWith(SHORT) && instance.aicPattern === pattern,
      })),
      {
        id: 'unnamed',
        label: 'Unnamed chain',
        matches: (instance: TechniqueInstance) => instance.id.startsWith(SHORT) && !instance.aicPattern,
      },
    ],
    needs((settings) => settings.shortAicEnabled, 'Technique Selections → Techniques'),
  ),

  fish('swordfish'),
  fish('finned swordfish'),
  single(
    'generic-aic',
    'Generic AIC',
    categoryOfRule3('generic aic'),
    idStarts('generic-aic-'),
    needs((settings) => settings.genericAicEnabled, 'Technique Selections → Techniques'),
  ),

  single(
    'extended-ur',
    'Extended UR (Type 1)',
    categoryOfRule3('extended ur'),
    idStarts('extended-ur-'),
    needs((settings) => settings.enabledExotic.includes('extended ur'), 'Technique Selections → Extreme Techniques'),
  ),
  // Not a Dynamic Dragon technique, so in no Dragon Configuration group:
  // listed with the Unfair ones, by request.
  single(
    'sue-de-coq',
    'Sue-de-Coq',
    3,
    idStarts('sue-de-coq-'),
    needs((settings) => settings.enabledExotic.includes('sue de coq'), 'Technique Selections → Extreme Techniques'),
  ),
  single(
    'grouped-aic',
    'Grouped AIC',
    categoryOfRule3('grouped aic'),
    idStarts('grouped-aic-'),
    needs((settings) => settings.groupedAicEnabled, 'Technique Selections → Extreme Techniques'),
  ),
  single(
    'als-xz',
    'ALS-xz',
    categoryOfRule3('als-xz'),
    idStarts('als-xz-'),
    needs((settings) => settings.alsXzEnabled, 'Technique Selections → Extreme Techniques'),
  ),
  single(
    'ur-aic',
    'UR-AIC',
    categoryOfRule3('ur-aic'),
    idStarts('uraic-'),
    needs((settings) => settings.urAicEnabled, 'Technique Selections → Extreme Techniques'),
  ),
  single(
    'als-aic',
    'ALS-AIC',
    categoryOfRule3('als-aic'),
    idStarts('alsaic-'),
    needs((settings) => settings.alsAicEnabled, 'Technique Selections → Extreme Techniques'),
  ),
]

export const PRACTICE_TARGETS: readonly PracticeTarget[] = PRACTICE_TECHNIQUES.flatMap((technique) => technique.targets)

/** Each technique's difficulty tier - the `techniqueRank` its rows carry.
 * Only "Start from beginning" needs it ahead of seeing a row: a puzzle that
 * needs something *harder* than the pick before it ever needs the pick is no
 * use there. The tests check it against real rows. */
const PRACTICE_TECHNIQUE_RANKS: Readonly<Record<string, number>> = {
  'naked-single': RANK_SINGLE,
  'hidden-single': RANK_SINGLE,
  'locked-candidate': RANK_LOCKED_CANDIDATE,
  'naked-pair': RANK_SUBSET,
  'naked-triple': RANK_SUBSET,
  'naked-quad': RANK_SUBSET,
  'hidden-pair': RANK_SUBSET,
  'unique-rectangle': RANK_UR,
  'bug-plus-n': RANK_BUG_PLUS_N,
  'avoidable-rectangle': RANK_AVOIDABLE_RECTANGLE,
  'bivalue-oddagon': RANK_BIVALUE_ODDAGON,
  'x-wing': RANK_X_WING,
  'short-single-digit-aic': RANK_SHORT_SINGLE_DIGIT_AIC,
  'finned-x-wing': RANK_FINNED_X_WING,
  'short-aic': RANK_SHORT_AIC,
  swordfish: RANK_SWORDFISH,
  'finned-swordfish': RANK_FINNED_SWORDFISH,
  'generic-aic': RANK_GENERIC_AIC,
  'extended-ur': RANK_EXTENDED_UR,
  'sue-de-coq': RANK_SUE_DE_COQ,
  'grouped-aic': RANK_GROUPED_AIC,
  'als-xz': RANK_ALS_XZ,
  'ur-aic': RANK_UR_AIC,
  'als-aic': RANK_ALS_AIC,
}

/** The difficulty tier of a target's technique. */
export function practiceTargetRank(targetId: string): number {
  const technique = PRACTICE_TECHNIQUES.find((entry) => entry.targets.some((target) => target.id === targetId))
  const rank = technique ? PRACTICE_TECHNIQUE_RANKS[technique.id] : undefined
  if (rank === undefined) {
    throw new Error(`No rank for practice target ${targetId}`)
  }
  return rank
}

export function practiceTargetById(id: string): PracticeTarget | null {
  return PRACTICE_TARGETS.find((target) => target.id === id) ?? null
}

export function practiceTechniqueOfTarget(targetId: string): PracticeTechnique | null {
  return PRACTICE_TECHNIQUES.find((technique) => technique.targets.some((target) => target.id === targetId)) ?? null
}

/** `settings` with every optional technique switched on: the strictest
 * hierarchy there is (benchmarks, tests, the stock). */
export const ALL_PRACTICE_TECHNIQUES_ON: PracticeSolverSettings = {
  shortSingleDigitAicEnabled: true,
  shortAicEnabled: true,
  genericAicEnabled: true,
  enabledFish: ['x-wing', 'finned x-wing', 'swordfish', 'finned swordfish'],
  alsXzEnabled: true,
  urAicEnabled: true,
  alsAicEnabled: true,
  groupedAicEnabled: true,
  enabledExotic: ['sue de coq', 'extended ur'],
  doubleDragonEnabled: false,
}
