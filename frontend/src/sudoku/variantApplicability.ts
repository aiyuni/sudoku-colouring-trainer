import type { SudokuConstraints } from './SudokuConstraints'

/**
 * Which of the solver's techniques hold on a Killer and on a Jigsaw, and why
 * - the one place that reasoning is written down. Every Classic technique was
 * looked at for what its logic actually rests on:
 *
 *  1. "A row, column and box each hold 1-9 once." Every unit-based technique
 *     (singles, subsets, locked candidates, fish, colouring, chains, ALS).
 *     A Killer keeps all of that and only adds cages, so these stay sound
 *     there untouched (they just don't use the cages - the Killer techniques
 *     do). A Jigsaw swaps the 3x3 boxes for regions, so the finders read
 *     "which cells share a box" from SudokuConstraints instead of working it
 *     out from row/3 and col/3 - the logic is the same.
 *  2. The boxes being aligned 3x3 blocks (bands and stacks, a box meeting a
 *     line in exactly three cells). True on a Killer; false on a Jigsaw, so
 *     the few techniques written around that shape are off there.
 *  3. Uniqueness: "this pattern could be filled two ways, so the puzzle
 *     would have two solutions". The two fillings swap digits inside rows,
 *     columns and boxes - fine on a Jigsaw, once the pattern is checked
 *     against the regions - but a Killer cage's sum tells the two apart, so
 *     the pattern isn't deadly there (see uniquenessHolds).
 *
 * The finders enforce this themselves (each returns nothing where its logic
 * doesn't hold), so the Techniques list, Dynamic Dragon's helpers, the Solve
 * Path, auto-solve and hints all follow without knowing about variants. This
 * table is what the UI shows: the Technique Selections menu greys out what
 * can't be used on the puzzle on the grid, with `note` as the reason, and
 * the Variant help tab lists it all. Keep the two in step: a change to a
 * finder's guard is a change here.
 *
 * X-Sudoku and Anti-Knight (added after Killer and Jigsaw) need far less:
 *  - X-Sudoku's two diagonals are simply two more units, so everything under
 *    1. uses them as it is. Under 3. the swap must not touch a diagonal, so
 *    the rectangle techniques skip any rectangle with a corner on one
 *    (spansTwoBoxes), BUG+N holds unchanged (it already asks "every digit
 *    twice in every unit", diagonals included), and Extended UR - whose
 *    precomputed shapes know nothing of diagonals - is off (`xSudoku: false`).
 *  - Anti-Knight adds no unit, only pairs of cells that can't hold the same
 *    digit. Everything under 1. stays sound and gets the knight's move as
 *    one more way two cells "see" each other (sharesHouseOrLink). Everything
 *    under 3. is off (`antiKnight: false`): a swapped digit can land a
 *    knight's move from another copy of itself.
 * Their one technique of their own, Locked Candidate (Diagonal / Knight's
 * Move), is SudokuVariantLockedFinder.
 *
 * `variantOnly` rows are the Killer techniques, which exist only because of
 * a cage (a Classic grid has none).
 */
export type TechniqueKey =
  | 'singles'
  | 'locked candidates'
  | 'naked subsets'
  | 'hidden pairs'
  | 'unique rectangle'
  | 'bug+n'
  | 'avoidable rectangle'
  | 'bivalue oddagon'
  | 'simple colouring'
  | 'x-wing'
  | 'finned x-wing'
  | 'swordfish'
  | 'finned swordfish'
  | 'short single-digit aic'
  | 'empty rectangle'
  | 'extended ur'
  | 'medusa'
  | 'short aic'
  | 'sue de coq'
  | 'generic aic'
  | 'dragon'
  | 'double dragon'
  | 'grouped aic'
  | 'als-xz'
  | 'ur-aic'
  | 'als-aic'
  | 'dynamic dragon'
  | 'double dynamic dragon'
  | 'cage sum'
  | 'cage combinations'
  | 'cage locked candidate'
  | 'rule of 45'

export interface TechniqueApplicability {
  key: TechniqueKey
  name: string
  killer: boolean
  jigsaw: boolean
  /** Why it applies (as it is, or adapted) or doesn't - one or two sentences
   * a solver can follow. */
  note: string
  /** A Killer technique: needs cages, so it never applies to a Classic grid. */
  variantOnly?: true
  /** `false` = not on an X-Sudoku / an Anti-Knight puzzle (left out = it
   * applies, as nearly everything does). */
  xSudoku?: false
  antiKnight?: false
}

/** Every technique that rests on a deadly pattern - off on an Entropy puzzle
 * (and, each by its own `killer` / `antiKnight` entry, on those). */
const UNIQUENESS_KEYS: ReadonlySet<string> = new Set(['unique rectangle', 'bug+n', 'avoidable rectangle', 'extended ur', 'ur-aic'])

export const NOT_ON_ENTROPY =
  "Not on an Entropy puzzle: swapping the pattern's digits changes which groups (low, middle, high) the 2x2 squares over it hold, so the second filling isn't a solution and the pattern isn't deadly."


export const NOT_ON_ANTI_KNIGHT =
  "Not on an Anti-Knight puzzle: swapping the pattern's digits can put one a knight's move from another copy of itself, so the second filling isn't a solution and the pattern isn't deadly."
export const NOT_ON_X_SUDOKU = "Not on an X-Sudoku: its 6-cell shapes are built without the diagonals, which the pattern's two fillings would also have to leave unchanged."

const UNITS = 'Rests only on each row, column and box holding every digit once'
const UNIQUENESS_KILLER =
  "Not on a Killer: a cage's sum tells the pattern's two fillings apart, so it isn't a deadly pattern. On a Jigsaw the pattern is checked against the regions"

export const TECHNIQUE_APPLICABILITY: readonly TechniqueApplicability[] = [
  { key: 'singles', name: 'Naked / Hidden Singles', killer: true, jigsaw: true, note: `${UNITS}; a Jigsaw's regions are its boxes.` },
  {
    key: 'locked candidates',
    name: 'Locked Candidates',
    killer: true,
    jigsaw: true,
    note: "A box and a line are two units that overlap - on a Jigsaw the box is a region, however many of a line's cells it holds.",
  },
  { key: 'naked subsets', name: 'Naked Pairs / Triples / Quads', killer: true, jigsaw: true, note: `${UNITS}.` },
  { key: 'hidden pairs', name: 'Hidden Pairs', killer: true, jigsaw: true, note: `${UNITS}.` },
  {
    key: 'unique rectangle', antiKnight: false,
    name: 'Unique Rectangle (all types)',
    killer: false,
    jigsaw: true,
    note: `${UNIQUENESS_KILLER}: the four cells must lie in exactly two regions, two aligned corners in each.`,
  },
  { key: 'bug+n', antiKnight: false, name: 'BUG+1 / BUG+2 / BUG+3', killer: false, jigsaw: true, note: `${UNIQUENESS_KILLER} (every digit twice in every row, column and region).` },
  { key: 'avoidable rectangle', antiKnight: false, name: 'Avoidable Rectangle', killer: false, jigsaw: true, note: `${UNIQUENESS_KILLER}, like a Unique Rectangle.` },
  {
    key: 'bivalue oddagon',
    name: 'Bivalue Oddagon',
    killer: true,
    jigsaw: true,
    note: 'An odd loop of cells holding one pair is a plain contradiction (neighbours must differ), not a uniqueness argument - so it holds on a Killer too.',
  },
  { key: 'simple colouring', name: 'Simple Colouring', killer: true, jigsaw: true, note: 'Conjugate pairs in rows, columns and boxes/regions; the two colours are opposites whatever else the puzzle has.' },
  { key: 'x-wing', name: 'X-Wing', killer: true, jigsaw: true, note: 'Rows against columns only - no box involved.' },
  {
    key: 'finned x-wing',
    name: 'Finned X-Wing',
    killer: true,
    jigsaw: true,
    note: 'The eliminations must see every fin. On a Jigsaw that is asked of the regions themselves instead of "the fins share a band".',
  },
  { key: 'swordfish', name: 'Swordfish', killer: true, jigsaw: true, note: 'Rows against columns only - no box involved.' },
  { key: 'finned swordfish', name: 'Finned Swordfish', killer: true, jigsaw: true, note: 'As Finned X-Wing: "sees every fin" is asked of the regions.' },
  {
    key: 'short single-digit aic',
    name: 'Short Single-Digit AIC (Skyscraper, Two-String Kite, Crane)',
    killer: true,
    jigsaw: true,
    note: 'Chains of conjugate pairs and "these two see each other"; both come from the units, and a region is one.',
  },
  {
    key: 'empty rectangle',
    name: 'Empty Rectangle',
    killer: true,
    jigsaw: false,
    note: "Described on a 3x3 box (its rows, its columns, the band it sits in). Not found on a Jigsaw - a region version would be a new technique.",
  },
  {
    key: 'extended ur', antiKnight: false, xSudoku: false,
    name: 'Extended UR',
    killer: false,
    jigsaw: false,
    note: 'A deadly pattern (so not on a Killer) whose 6-cell shapes are built for the 3x3 boxes (so not on a Jigsaw).',
  },
  { key: 'medusa', name: '3D Medusa', killer: true, jigsaw: true, note: 'Bivalue cells and conjugate pairs; every rule is "two of one colour clash in a cell or a unit".' },
  { key: 'short aic', name: 'Short AIC (W-Wing, Y-Wing)', killer: true, jigsaw: true, note: 'Strong links from bivalue cells and conjugate pairs, weak links from sharing a unit.' },
  {
    key: 'sue de coq',
    name: 'Sue-de-Coq',
    killer: true,
    jigsaw: false,
    note: 'Written for a line crossing a 3x3 box in three cells; a region can meet a line in one to nine.',
  },
  { key: 'generic aic', name: 'Generic AIC', killer: true, jigsaw: true, note: 'The same links as Short AIC, longer.' },
  {
    key: 'dragon',
    name: 'Dragon Colouring',
    killer: true,
    jigsaw: true,
    note: 'Extends a Medusa with the same unit logic. "One colour fills every empty cell, so it is the solution" also checks every cage\'s sum on a Killer.',
  },
  { key: 'double dragon', name: 'Double Dragon Colouring', killer: true, jigsaw: true, note: 'Two Dragons joined by a weak link - nothing a variant changes.' },
  {
    key: 'grouped aic',
    name: 'Grouped AIC',
    killer: true,
    jigsaw: true,
    note: "A group is a digit's candidates in one box and one line; on a Jigsaw that is a region and a line.",
  },
  { key: 'als-xz', name: 'ALS-xz', killer: true, jigsaw: true, note: 'An Almost Locked Set lives in one unit; a region is one.' },
  { key: 'ur-aic', antiKnight: false, name: 'UR-AIC', killer: false, jigsaw: true, note: `${UNIQUENESS_KILLER}: it links through a Unique Rectangle.` },
  { key: 'als-aic', name: 'ALS-AIC', killer: true, jigsaw: true, note: 'Chains through Almost Locked Sets and box/line groups, both read from the units.' },
  {
    key: 'dynamic dragon',
    name: 'Dynamic Dragon Colouring',
    killer: true,
    jigsaw: true,
    note: "Dragon Colouring that may use other techniques under a colour's assumption - only the ones that hold on the puzzle (no Unique Rectangle or BUG on a Killer).",
  },
  { key: 'double dynamic dragon', name: 'Double Dynamic Dragon Colouring', killer: true, jigsaw: true, note: 'As Dynamic and Double Dragon.' },
  {
    key: 'cage sum',
    name: 'Cage Sum',
    killer: true,
    jigsaw: false,
    variantOnly: true,
    note: 'A cage with one empty cell left: that cell is the sum minus the rest.',
  },
  {
    key: 'cage combinations',
    name: 'Cage Combinations',
    killer: true,
    jigsaw: false,
    variantOnly: true,
    note: 'A candidate that fits no way of filling its cage - different digits, each from its own cell, adding up to the sum - goes.',
  },
  {
    key: 'cage locked candidate',
    name: 'Cage Locked Candidate',
    killer: true,
    jigsaw: false,
    variantOnly: true,
    note: 'A digit every way of filling a cage uses must be in the cage, so cells seeing all its places there lose it.',
  },
  {
    key: 'rule of 45',
    name: 'Rule of 45 (Innies / Outies)',
    killer: true,
    jigsaw: false,
    variantOnly: true,
    note: 'Rows, columns and boxes/regions each add up to 45; the cages inside (or covering) them leave a sum for the few cells that stick in or out.',
  },
]

const BY_KEY = new Map(TECHNIQUE_APPLICABILITY.map((entry) => [entry.key, entry]))

/** Why a technique can't be used under `constraints`, or null when it can. */
export function techniqueUnavailableReason(key: TechniqueKey, constraints: SudokuConstraints): string | null {
  const entry = BY_KEY.get(key)!
  const killer = constraints.cages.length > 0
  const jigsaw = constraints.regions !== null
  if (entry.variantOnly) {
    return killer ? null : 'Needs Killer cages.'
  }
  if ((killer && !entry.killer) || (jigsaw && !entry.jigsaw)) {
    return entry.note
  }
  if (constraints.antiKnight && entry.antiKnight === false) {
    return NOT_ON_ANTI_KNIGHT
  }
  if (constraints.entropy && UNIQUENESS_KEYS.has(key)) {
    return NOT_ON_ENTROPY
  }
  if (constraints.diagonals && entry.xSudoku === false) {
    return NOT_ON_X_SUDOKU
  }
  return null
}
