import { markedCandidateDigits } from '../sudoku/boardUtils'
import { SudokuColorFinder } from '../sudoku/SudokuColorFinder'
import { SudokuLockedCandidateFinder } from '../sudoku/SudokuLockedCandidateFinder'
import { SudokuMedusaFinder } from '../sudoku/SudokuMedusaFinder'
import { SudokuPairFinder } from '../sudoku/SudokuPairFinder'
import { findAicChain, findWWing, findYWing } from './lessonBuilders'
import { candKey } from './puzzleState'
import type {
  CandidatesQuestion,
  CellsQuestion,
  ChoiceQuestion,
  ColourQuestion,
  QuizFrame,
  QuizOption,
  QuizQuestion,
} from './quizTypes'
import type {
  CandRef,
  ColouredCand,
  PuzzleState,
  TutorialCell,
  TutorialColor,
  TutorialFrame,
  TutorialLesson,
  TutorialLink,
} from './tutorialTypes'

/**
 * Turns positions into practice questions, the way lessonBuilders.ts turns
 * them into lessons: every answer comes from the app's own finders (or from
 * a lesson's frames, which come from them), so a question can't disagree
 * with the solver, and a tap is judged against *every* right answer, not
 * just the one a lesson happened to show.
 *
 * Two families:
 * - Basics, Simple Colouring and 3D Medusa are asked on fresh positions
 *   (quizExamples.ts), found by dragon-research/quiz/mine.ts.
 * - Everything else is asked on the lesson's own position, from its frames:
 *   the frame that first marks an elimination is the answer to "what can be eliminated?".
 *
 * Like a lesson builder, each of these throws when its position stops
 * matching what it expects; quizExamples.ts drops that one question.
 */

const colorFinder = new SudokuColorFinder()
const medusaFinder = new SudokuMedusaFinder()
const lockedFinder = new SudokuLockedCandidateFinder()
const pairFinder = new SudokuPairFinder()

// ---------------------------------------------------------------- helpers

type UnitKind = 'row' | 'column' | 'box'
interface Unit {
  kind: UnitKind
  index: number
  cells: TutorialCell[]
}

const NINE = [0, 1, 2, 3, 4, 5, 6, 7, 8]
const UNIT_KINDS: UnitKind[] = ['row', 'column', 'box']

function cellName(row: number, col: number): string {
  return `r${row + 1}c${col + 1}`
}

function boxOf(row: number, col: number): number {
  return Math.floor(row / 3) * 3 + Math.floor(col / 3)
}

function unit(kind: UnitKind, index: number): Unit {
  const cells: TutorialCell[] = NINE.map((a) =>
    kind === 'row' ? [index, a] : kind === 'column' ? [a, index] : [Math.floor(index / 3) * 3 + Math.floor(a / 3), (index % 3) * 3 + (a % 3)],
  )
  return { kind, index, cells }
}

function unitPhrase(u: Unit): string {
  return `${u.kind} ${u.index + 1}`
}

function sameCell(a: TutorialCell, b: TutorialCell): boolean {
  return a[0] === b[0] && a[1] === b[1]
}

function sees(a: TutorialCell, b: TutorialCell): boolean {
  return !sameCell(a, b) && (a[0] === b[0] || a[1] === b[1] || boxOf(a[0], a[1]) === boxOf(b[0], b[1]))
}

function sharedUnits(a: TutorialCell, b: TutorialCell): Unit[] {
  const units: Unit[] = []
  if (a[0] === b[0]) units.push(unit('row', a[0]))
  if (a[1] === b[1]) units.push(unit('column', a[1]))
  if (boxOf(a[0], a[1]) === boxOf(b[0], b[1])) units.push(unit('box', boxOf(a[0], a[1])))
  return units
}

function inUnit(u: Unit, cell: TutorialCell): boolean {
  return u.cells.some((c) => sameCell(c, cell))
}

function ref(row: number, col: number, digit: number): CandRef {
  return { row, col, digit }
}

function digitsAt(state: PuzzleState, [row, col]: TutorialCell): number[] {
  return state.board[row][col] === 0 ? markedCandidateDigits(state.candidates[row][col]) : []
}

/** The cells of `u` that can still be `digit`. */
function holders(state: PuzzleState, u: Unit, digit: number): TutorialCell[] {
  return u.cells.filter(([r, c]) => state.board[r][c] === 0 && state.candidates[r][c][digit - 1])
}

/** The unit in which `digit` has exactly these two cells left. */
function strongUnit(state: PuzzleState, digit: number, a: TutorialCell, b: TutorialCell): Unit | null {
  return sharedUnits(a, b).find((u) => holders(state, u, digit).length === 2) ?? null
}

function list(items: Array<string | number>): string {
  if (items.length <= 1) return String(items[0] ?? '')
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

function capital(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function edgeKey(a: CandRef, b: CandRef): string {
  return `${candKey(a)}|${candKey(b)}`
}

function required<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) {
    throw new Error(`Practice question: no ${what} in this position.`)
  }
  return value
}

/** A choice question; its explanation is the right option's own reason. */
function choice(
  id: string,
  badge: string,
  prompt: string,
  state: PuzzleState,
  frame: QuizFrame,
  options: QuizOption[],
  doneFrame: QuizFrame = frame,
): ChoiceQuestion {
  const right = required(options.find((o) => o.correct), 'right option')
  return { kind: 'choice', id, badge, prompt, state, frame, options, explain: right.why, doneFrame }
}

const COLOUR_NAME: Record<TutorialColor, string> = {
  blue: 'light blue',
  yellow: 'yellow',
  darkBlue: 'dark blue',
  orange: 'orange',
  pink: 'pink',
  purple: 'purple',
  limeGreen: 'lime green',
  darkGreen: 'dark green',
}

// ------------------------------------------------------------ basics: singles

export function buildSinglesQuestions(state: PuzzleState): QuizQuestion[] {
  const all: TutorialCell[] = NINE.flatMap((r) => NINE.map((c) => [r, c] as const))
  const naked = all.filter((cell) => digitsAt(state, cell).length === 1)
  if (naked.length === 0) throw new Error('Practice question: no naked single in this position.')
  const describe = (cell: TutorialCell): string => {
    const name = cellName(cell[0], cell[1])
    if (state.board[cell[0]][cell[1]] !== 0) return `${name} is already filled in.`
    const digits = digitsAt(state, cell)
    return `${name} still has ${digits.length} candidates (${digits.join(', ')}). A naked single has just one.`
  }
  const nakedQuestion: CellsQuestion = {
    kind: 'cells',
    id: 'naked-single',
    badge: 'Spot it',
    prompt: 'Find a naked single: tap a cell with only one candidate left.',
    state,
    frame: {},
    answers: naked,
    need: 1,
    wrong: describe,
    explain:
      naked.length === 1
        ? `${cellName(...naked[0])} has only ${digitsAt(state, naked[0])[0]} left, so that is its digit.`
        : 'Each outlined cell has a single candidate left, so that candidate is its digit.',
    doneFrame: { outlineCells: naked, solved: naked.map((cell) => ref(cell[0], cell[1], digitsAt(state, cell)[0])) },
  }

  // A hidden single is only worth asking about where the cell itself still
  // has other candidates - otherwise it is the naked single again.
  const hidden = (kinds: UnitKind[], minCandidates: number, not?: TutorialCell) => {
    for (const kind of kinds) {
      for (const index of NINE) {
        const u = unit(kind, index)
        for (let digit = 1; digit <= 9; digit++) {
          const where = holders(state, u, digit)
          if (where.length === 1 && digitsAt(state, where[0]).length >= minCandidates && !(not && sameCell(not, where[0]))) {
            return { u, digit, cell: where[0] }
          }
        }
      }
    }
    return null
  }
  const inBox = required(hidden(['box'], 3), 'hidden single in a box')
  const boxName = cellName(...inBox.cell)
  const boxQuestion: CellsQuestion = {
    kind: 'cells',
    id: 'hidden-single-box',
    badge: 'Spot it',
    prompt: `In the tinted box, ${inBox.digit} fits in only one cell. Tap it.`,
    state,
    frame: { unitCells: inBox.u.cells, spotlight: { digits: [inBox.digit] } },
    answers: [inBox.cell],
    need: 1,
    wrong: (cell) => {
      const name = cellName(cell[0], cell[1])
      if (!inUnit(inBox.u, cell)) return 'Stay inside the tinted box.'
      if (state.board[cell[0]][cell[1]] !== 0) return `${name} is already filled in.`
      return `${name} can't be ${inBox.digit}: it has no ${inBox.digit} among its candidates.`
    },
    explain: `${boxName} has other candidates too, but it is the only cell of the box that can be ${inBox.digit}. That makes ${inBox.digit} a hidden single: ${boxName} is ${inBox.digit}.`,
    doneFrame: { unitCells: inBox.u.cells, solved: [ref(inBox.cell[0], inBox.cell[1], inBox.digit)], spotlight: { digits: [inBox.digit] } },
  }

  const inLine = required(hidden(['row', 'column'], 2, inBox.cell), 'hidden single in a row or column')
  const lineName = cellName(...inLine.cell)
  const others = digitsAt(state, inLine.cell).filter((d) => d !== inLine.digit).slice(0, 2)
  const lineFrame: QuizFrame = { unitCells: inLine.u.cells, outlineCells: [inLine.cell] }
  const lineQuestion = choice(
    'hidden-single-line',
    'Quick pick',
    `One digit can only go in the outlined cell of the tinted ${inLine.u.kind}. Which one?`,
    state,
    lineFrame,
    [inLine.digit, ...others]
      .sort((a, b) => a - b)
      .map((digit): QuizOption => {
        if (digit === inLine.digit) {
          return {
            label: String(digit),
            correct: true,
            why: `${digit} fits nowhere else in ${unitPhrase(inLine.u)}, so ${lineName} is ${digit}.`,
          }
        }
        const elsewhere = holders(state, inLine.u, digit).length - 1
        return {
          label: String(digit),
          why: `${digit} still fits in ${elsewhere} other cell${elsewhere === 1 ? '' : 's'} of ${unitPhrase(inLine.u)}, so it isn't forced here.`,
        }
      }),
    { ...lineFrame, solved: [ref(inLine.cell[0], inLine.cell[1], inLine.digit)], spotlight: { digits: [inLine.digit] } },
  )
  return [nakedQuestion, boxQuestion, lineQuestion]
}

// --------------------------------------------------- basics: locked candidates

export function buildLockedCandidatesQuestions(state: PuzzleState): QuizQuestion[] {
  const pointing = required(
    lockedFinder.findPointingInstances(state.board, state.candidates).find((i) => i.eliminations.length >= 2),
    'pointing locked candidate',
  )
  const digit = pointing.digit
  const basisCells = pointing.basisCells.map(([r, c]) => [r, c] as const)
  const [first] = basisCells
  const sameRow = basisCells.every(([r]) => r === first[0])
  const line = unit(sameRow ? 'row' : 'column', sameRow ? first[0] : first[1])
  const box = unit('box', boxOf(first[0], first[1]))
  const basis = basisCells.map(([r, c]) => ref(r, c, digit))
  const eliminated = pointing.eliminations.map((e) => ref(e.row, e.col, e.digit))
  const frame: QuizFrame = { unitCells: box.cells, basis, spotlight: { digits: [digit] } }

  // Wrong lines to offer: another line of the box running the same way, and
  // the line crossing the first yellow cell the other way.
  const parallelIndex = required(
    [0, 1, 2].map((k) => Math.floor(line.index / 3) * 3 + k).find((i) => i !== line.index),
    'parallel line',
  )
  const parallel = unit(line.kind, parallelIndex)
  const crossing = unit(sameRow ? 'column' : 'row', sameRow ? first[1] : first[0])
  const whichLine = choice(
    'pointing-line',
    'Quick pick',
    `In the tinted box, every ${digit} (yellow) sits in one line. Which line?`,
    state,
    frame,
    [
      { label: capital(unitPhrase(line)), correct: true, why: `Every ${digit} of box ${box.index + 1} is in ${unitPhrase(line)}, so that is where the box's ${digit} will be.` },
      { label: capital(unitPhrase(parallel)), why: `None of the box's ${digit}s are in ${unitPhrase(parallel)}.` },
      {
        label: capital(unitPhrase(crossing)),
        why: `Only one of the box's ${basisCells.length} ${digit}s is in ${unitPhrase(crossing)}. Look for the line that holds them all.`,
      },
    ],
  )

  const remove: CandidatesQuestion = {
    kind: 'candidates',
    id: 'pointing-remove',
    badge: 'What can be eliminated?',
    prompt: `The box's ${digit} must be one of the yellow ones, so ${unitPhrase(line)} gets its ${digit} inside this box. Tap a ${digit} that can be removed.`,
    state,
    frame,
    answers: eliminated,
    need: 1,
    pickLook: 'eliminated',
    wrong: (pick) => {
      const cell: TutorialCell = [pick.row, pick.col]
      if (pick.digit !== digit) return `Only ${digit}s are affected here.`
      if (basisCells.some((b) => sameCell(b, cell))) return `That one stays: it is one of the box's own ${digit}s.`
      return `That ${digit} isn't in ${unitPhrase(line)}, so this box says nothing about it.`
    },
    explain: `Box ${box.index + 1} puts its ${digit} in ${unitPhrase(line)}, so every other ${digit} in ${unitPhrase(line)} can be eliminated.`,
    doneFrame: { ...frame, eliminated },
  }

  const claiming = required(
    lockedFinder.findClaimingInstances(state.board, state.candidates).find((i) => i.eliminations.length >= 1),
    'claiming locked candidate',
  )
  const cDigit = claiming.digit
  const cCells = claiming.basisCells.map(([r, c]) => [r, c] as const)
  const cSameRow = cCells.every(([r]) => r === cCells[0][0])
  const cLine = unit(cSameRow ? 'row' : 'column', cSameRow ? cCells[0][0] : cCells[0][1])
  const cBox = boxOf(cCells[0][0], cCells[0][1]) + 1
  const cFrame: QuizFrame = { unitCells: cLine.cells, basis: cCells.map(([r, c]) => ref(r, c, cDigit)), spotlight: { digits: [cDigit] } }
  const reverse = choice(
    'claiming',
    'Quick pick',
    `Now the other way round. In the tinted ${cLine.kind}, every ${cDigit} (yellow) sits inside one box. Where can ${cDigit} be removed?`,
    state,
    cFrame,
    [
      {
        label: `From the rest of that box`,
        correct: true,
        why: `${capital(unitPhrase(cLine))} needs a ${cDigit}, and it can only be inside box ${cBox}. So the box's other cells lose ${cDigit}.`,
      },
      { label: `From the rest of the ${cLine.kind}`, why: `The rest of the ${cLine.kind} has no ${cDigit} left to remove - that is the pattern.` },
      { label: 'Nowhere yet', why: `The ${cLine.kind}'s ${cDigit} is locked inside one box, and that does remove something.` },
    ],
    { ...cFrame, eliminated: claiming.eliminations.map((e) => ref(e.row, e.col, e.digit)) },
  )
  return [whichLine, remove, reverse]
}

// --------------------------------------------------------- basics: locked sets

export function buildNakedPairQuestions(state: PuzzleState): QuizQuestion[] {
  const pair = required(
    pairFinder.findNakedPairs(state.board, state.candidates).find((p) => p.eliminations.length >= 2 && p.cells[0][0] === p.cells[1][0]),
    'naked pair in a row',
  )
  const [d1, d2] = pair.digits
  const cells = pair.cells.map(([r, c]) => [r, c] as const)
  const row = unit('row', cells[0][0])
  const names = cells.map((cell) => cellName(cell[0], cell[1]))
  const basis = cells.flatMap(([r, c]) => [ref(r, c, d1), ref(r, c, d2)])
  const eliminated = pair.eliminations.map((e) => ref(e.row, e.col, e.digit))
  const found: QuizFrame = { unitCells: row.cells, outlineCells: cells, basis }

  const spot: CellsQuestion = {
    kind: 'cells',
    id: 'naked-pair-cells',
    badge: 'Spot it',
    prompt: 'Two cells in the tinted row hold exactly the same two candidates and nothing else. Tap both.',
    state,
    frame: { unitCells: row.cells },
    answers: cells,
    need: 2,
    wrong: (cell) => {
      const name = cellName(cell[0], cell[1])
      if (!inUnit(row, cell)) return 'Look inside the tinted row.'
      if (state.board[cell[0]][cell[1]] !== 0) return `${name} is already filled in.`
      const digits = digitsAt(state, cell)
      return digits.length === 2
        ? `${name} has two candidates (${digits.join(', ')}), but no other cell in the row holds exactly those two.`
        : `${name} has ${digits.length} candidates (${digits.join(', ')}). The pair's cells have exactly two each.`
    },
    explain: `${names[0]} and ${names[1]} can each only be ${d1} or ${d2}: a naked pair.`,
    doneFrame: found,
  }

  const meaning = choice(
    'naked-pair-meaning',
    'Quick pick',
    `${names[0]} and ${names[1]} will be ${d1} and ${d2}, in some order. What does that mean for the rest of the row?`,
    state,
    found,
    [
      {
        label: `No other cell in the row can be ${d1} or ${d2}`,
        correct: true,
        why: `The pair uses up both digits, whichever way round they go, so the rest of the row loses ${d1} and ${d2}.`,
      },
      { label: `${names[0]} is ${d1}`, why: `We don't know the order yet - only that these two cells take ${d1} and ${d2} between them.` },
      { label: 'Nothing yet', why: `Both digits are spoken for by these two cells, and that already rules them out elsewhere.` },
    ],
  )

  const need = Math.min(2, eliminated.length)
  const remove: CandidatesQuestion = {
    kind: 'candidates',
    id: 'naked-pair-remove',
    badge: 'What can be eliminated?',
    prompt: `Tap ${need === 1 ? 'a candidate' : 'two candidates'} the pair removes.`,
    state,
    frame: found,
    answers: eliminated,
    need,
    pickLook: 'eliminated',
    wrong: (pick) => {
      const cell: TutorialCell = [pick.row, pick.col]
      if (cells.some((c) => sameCell(c, cell))) return `The pair's own candidates stay.`
      if (pick.digit !== d1 && pick.digit !== d2) return `Only ${d1}s and ${d2}s are affected.`
      return `That cell doesn't share a row, column or box with both cells of the pair.`
    },
    explain: `${d1} and ${d2} belong to the pair, so every other ${d1} and ${d2} that sees both cells can be eliminated.`,
    doneFrame: { ...found, eliminated },
  }
  return [spot, meaning, remove]
}

// ------------------------------------------------- basics: bilocals & bivalues

/** The first unit (rows, then columns, then boxes) where some digit has
 * exactly `count` places left. */
function unitWithHolders(state: PuzzleState, count: number, kinds: UnitKind[] = UNIT_KINDS) {
  for (const kind of kinds) {
    for (const index of NINE) {
      const u = unit(kind, index)
      for (let digit = 1; digit <= 9; digit++) {
        const where = holders(state, u, digit)
        if (where.length === count) return { u, digit, where }
      }
    }
  }
  return null
}

export function buildBilocalQuestions(state: PuzzleState): QuizQuestion[] {
  const two = required(unitWithHolders(state, 2, ['row', 'column']), 'bilocal digit')
  const [a, b] = two.where.map(([r, c]) => ref(r, c, two.digit))
  const nameA = cellName(a.row, a.col)
  const nameB = cellName(b.row, b.col)
  const link: TutorialLink = { from: a, to: b, kind: 'strong' }
  const base: QuizFrame = { unitCells: two.u.cells, spotlight: { digits: [two.digit] } }

  const spot: CandidatesQuestion = {
    kind: 'candidates',
    id: 'bilocal-pair',
    badge: 'Spot it',
    prompt: `${two.digit} has only two places left in the tinted ${two.u.kind}. Tap both ${two.digit}s.`,
    state,
    frame: base,
    answers: [a, b],
    need: 2,
    pickLook: 'basis',
    wrong: (pick) =>
      pick.digit !== two.digit ? `Look for ${two.digit}s.` : `Stay inside the tinted ${two.u.kind}.`,
    explain: `These two ${two.digit}s are bilocal candidates: ${unitPhrase(two.u)} needs a ${two.digit}, so exactly one of them is true.`,
    doneFrame: { ...base, basis: [a, b], links: [link] },
  }

  const three = required(unitWithHolders(state, 3), 'digit with three places')
  const threePips = three.where.map(([r, c]) => ref(r, c, three.digit))
  const trap = choice(
    'bilocal-three',
    'Quick pick',
    `Are the ${three.digit}s in the tinted ${three.u.kind} (yellow) bilocal candidates?`,
    state,
    { unitCells: three.u.cells, basis: threePips, spotlight: { digits: [three.digit] } },
    [
      { label: 'Yes', why: `There are three places for ${three.digit} here. Bilocal means exactly two.` },
      { label: 'No', correct: true, why: `${three.digit} still has three places in ${unitPhrase(three.u)}. Bilocal means exactly two - only then does one being false force the other.` },
    ],
  )

  const either = choice(
    'bilocal-either',
    'Quick pick',
    `Back to the two ${two.digit}s. Suppose the red one (${nameA}) turns out to be false. What about ${nameB}?`,
    state,
    { ...base, eliminated: [a], basis: [b], links: [link] },
    [
      { label: `It must be ${two.digit}`, correct: true, why: `${capital(unitPhrase(two.u))} still needs a ${two.digit}, and ${nameB} is the only place left for it.` },
      { label: 'It is false too', why: `Then ${unitPhrase(two.u)} would have no ${two.digit} at all.` },
      { label: `Can't tell`, why: `With only two places and one of them gone, the other is forced.` },
    ],
    { ...base, eliminated: [a], solved: [b], links: [link] },
  )
  return [spot, trap, either]
}

export function buildBivalueQuestions(state: PuzzleState): QuizQuestion[] {
  const all: TutorialCell[] = NINE.flatMap((r) => NINE.map((c) => [r, c] as const))
  const bivalue = all.filter((cell) => digitsAt(state, cell).length === 2)
  const tri = required(all.find((cell) => digitsAt(state, cell).length === 3), 'cell with three candidates')
  if (bivalue.length === 0) throw new Error('Practice question: no bivalue cell in this position.')

  const spot: CellsQuestion = {
    kind: 'cells',
    id: 'bivalue-cell',
    badge: 'Spot it',
    prompt: 'Tap any bivalue cell: a cell with exactly two candidates.',
    state,
    frame: {},
    answers: bivalue,
    need: 1,
    wrong: (cell) => {
      const name = cellName(cell[0], cell[1])
      if (state.board[cell[0]][cell[1]] !== 0) return `${name} is already filled in.`
      const digits = digitsAt(state, cell)
      return `${name} has ${digits.length} candidate${digits.length === 1 ? '' : 's'} (${digits.join(', ')}). Bivalue means exactly two.`
    },
    explain: `Every outlined cell is bivalue: two candidates, and one of the two is its digit.`,
    doneFrame: { outlineCells: bivalue },
  }

  const triName = cellName(...tri)
  const triDigits = digitsAt(state, tri)
  const trap = choice(
    'bivalue-three',
    'Quick pick',
    `Is ${triName} (outlined) a bivalue cell?`,
    state,
    { outlineCells: [tri], spotlight: { cells: [tri] } },
    [
      { label: 'Yes', why: `${triName} has three candidates (${triDigits.join(', ')}). Bivalue means exactly two.` },
      { label: 'No', correct: true, why: `${triName} has three candidates (${triDigits.join(', ')}). With three, ruling one out still leaves a choice - with two, it leaves the answer.` },
    ],
  )

  const cell = bivalue[0]
  const name = cellName(...cell)
  const [x, y] = digitsAt(state, cell)
  const either = choice(
    'bivalue-either',
    'Quick pick',
    `${name} (outlined) holds only ${x} and ${y}. If it turns out not to be ${x}, then...`,
    state,
    { outlineCells: [cell], eliminated: [ref(cell[0], cell[1], x)], spotlight: { cells: [cell] } },
    [
      { label: `It is ${y}`, correct: true, why: `Every cell needs a digit, and ${y} is the only candidate left in ${name}.` },
      { label: `It is ${x} anyway`, why: `We just supposed it is not ${x}.` },
      { label: 'It could be any digit', why: `Only its two candidates are possible, and one of them is gone.` },
    ],
    { outlineCells: [cell], eliminated: [ref(cell[0], cell[1], x)], solved: [ref(cell[0], cell[1], y)], spotlight: { cells: [cell] } },
  )
  return [spot, trap, either]
}

// --------------------------------------------------------- simple colouring

const opposite = (color: 'blue' | 'yellow'): 'blue' | 'yellow' => (color === 'blue' ? 'yellow' : 'blue')

/** The three questions every colouring quiz opens with: what colour a linked
 * candidate gets, carrying the colouring on, and (asked by the caller) what
 * the finished colouring proves. `order` is the chain in an order where
 * every candidate after the first is linked to an earlier one. */
function colouringQuestions(options: {
  idPrefix: string
  state: PuzzleState
  order: ColouredCand[]
  edges: ReadonlySet<string>
  /** Index in `order` of the candidate the "which colour?" question rings. */
  askIndex: number
  spotlight?: QuizFrame['spotlight']
  /** What links `node` to the already coloured `parent`, as a phrase that
   * completes "It is ..." ("the only other 7 in row 3"). */
  linkPhrase: (node: ColouredCand, parent: ColouredCand) => string
  /** Why a candidate outside the chain can't be coloured. */
  outsideReason: (pick: CandRef) => string
  extendPrompt: string
}): [ChoiceQuestion, ColourQuestion] {
  const { idPrefix, state, order, edges, askIndex, spotlight, linkPhrase, outsideReason, extendPrompt } = options
  const linked = (a: CandRef, b: CandRef) => edges.has(edgeKey(a, b))
  const asked = order[askIndex]
  const before = order.slice(0, askIndex)
  const parent = required(before.find((c) => linked(c, asked)), 'coloured neighbour')
  const other = opposite(parent.color as 'blue' | 'yellow')
  const link: TutorialLink = { from: parent, to: asked, kind: 'strong' }
  const whichColour = choice(
    `${idPrefix}-which-colour`,
    'Quick pick',
    `The circled ${asked.digit} in ${cellName(asked.row, asked.col)} is ${linkPhrase(asked, parent)}, and its partner there is ${COLOUR_NAME[parent.color]}. What colour does it get?`,
    state,
    { coloured: before, fresh: [asked], links: [link], spotlight },
    [
      {
        label: capital(COLOUR_NAME[other]),
        swatch: other,
        correct: true,
        why: `Exactly one of the two linked candidates is true, so they always get opposite colours.`,
      },
      {
        label: capital(COLOUR_NAME[parent.color]),
        swatch: parent.color,
        why: `The same colour would mean both are true or both are false - but exactly one of the two is true.`,
      },
      { label: 'No colour', why: `It is strongly linked to a coloured candidate, so its colour is forced.` },
    ],
    { coloured: order.slice(0, askIndex + 1), links: [link], spotlight },
  )

  const start = order.slice(0, askIndex + 1)
  const remaining = order.length - start.length
  if (remaining < 1) throw new Error('Practice question: the colouring has nothing left to extend.')
  const need = Math.min(3, remaining)
  const colouredNeighbour = (pick: CandRef, colouredKeys: ReadonlySet<string>) =>
    order.find((c) => colouredKeys.has(candKey(c)) && linked(c, pick))
  const extend: ColourQuestion = {
    kind: 'colour',
    id: `${idPrefix}-extend`,
    badge: 'Colour the next one',
    prompt: `${extendPrompt} Colour ${need === 1 ? 'one more' : `${need} more`}.`,
    state,
    frame: { spotlight },
    chain: order,
    start,
    edges,
    need,
    pickNote: (pick, colouredKeys) => {
      const node = order.find((c) => candKey(c) === candKey(pick))!
      const from = colouredNeighbour(pick, colouredKeys)
      return from ? `Yes: it is ${linkPhrase(node, from)}, so it gets the opposite colour - ${COLOUR_NAME[node.color]}.` : 'Yes.'
    },
    wrong: (pick) =>
      order.some((c) => candKey(c) === candKey(pick))
        ? `Not yet: nothing links it to a candidate you have already coloured. Colour the one in between first.`
        : outsideReason(pick),
    explain:
      remaining > need
        ? 'The rest is coloured the same way, one link at a time.'
        : 'That is the whole colouring: every link coloured, colours alternating.',
    doneFrame: { coloured: order, spotlight },
  }
  return [whichColour, extend]
}

function simpleChain(state: PuzzleState, digit: number, outcome: 'eliminate' | 'solve') {
  const chain = required(
    colorFinder
      .findChains(state.board, state.candidates, digit)
      .find((c) => (outcome === 'solve' ? colorFinder.findRule1(c) : !colorFinder.findRule1(c) && colorFinder.findRule2(c, state.board, state.candidates))),
    `simple colouring of ${digit}`,
  )
  const order: ColouredCand[] = chain.cells.map((c) => ({ ...ref(c.row, c.col, digit), color: c.color }))
  const edges = new Set<string>()
  for (const a of order) {
    for (const b of order) {
      if (a !== b && strongUnit(state, digit, [a.row, a.col], [b.row, b.col])) edges.add(edgeKey(a, b))
    }
  }
  return { chain, order, edges }
}

/** `eliminate`: a position where a cell sees both colours. `collide`: one
 * where two cells of one colour see each other. */
export function buildSimpleColouringQuestions(
  eliminate: { state: PuzzleState; digit: number },
  collide: { state: PuzzleState; digit: number },
): QuizQuestion[] {
  const { state, digit } = eliminate
  const { chain, order, edges } = simpleChain(state, digit, 'eliminate')
  const spotlight = { digits: [digit] }
  const unitOf = (a: CandRef, b: CandRef) => {
    const u = strongUnit(state, digit, [a.row, a.col], [b.row, b.col])
    return u ? unitPhrase(u) : 'that unit'
  }
  const [whichColour, extend] = colouringQuestions({
    idPrefix: 'simple',
    state,
    order,
    edges,
    askIndex: 1,
    spotlight,
    linkPhrase: (node, parent) => `the only other ${digit} in ${unitOf(node, parent)}`,
    outsideReason: (pick) =>
      pick.digit !== digit
        ? `Simple Colouring follows one digit: here, only ${digit}s.`
        : `No row, column or box has that ${digit} and a coloured ${digit} as its only two.`,
    extendPrompt: `Keep colouring: tap a ${digit} that is the only other ${digit} in a row, column or box with a coloured one.`,
  })

  const rule2 = required(colorFinder.findRule2(chain, state.board, state.candidates), 'cell that sees both colours')
  const eliminated = rule2.eliminatedCells.map(([r, c]) => ref(r, c, digit))
  const seenColours = (pick: CandRef) =>
    (['blue', 'yellow'] as const).filter((color) => order.some((c) => c.color === color && sees([c.row, c.col], [pick.row, pick.col])))
  const firstHit = eliminated[0]
  const seesBoth: CandidatesQuestion = {
    kind: 'candidates',
    id: 'simple-sees-both',
    badge: 'What can be eliminated?',
    prompt: `Exactly one colour is true. Tap a ${digit} that sees both a light blue ${digit} and a yellow ${digit}.`,
    state,
    frame: { coloured: order, spotlight },
    answers: eliminated,
    need: 1,
    pickLook: 'eliminated',
    wrong: (pick) => {
      if (pick.digit !== digit) return `Only ${digit}s are in play here.`
      if (order.some((c) => candKey(c) === candKey(pick))) return `Coloured candidates stay for now: we don't know yet which colour is true.`
      const seen = seenColours(pick)
      return seen.length === 0
        ? `That ${digit} sees no coloured ${digit} at all.`
        : `That ${digit} only sees ${COLOUR_NAME[seen[0]]}. It needs to see both colours.`
    },
    explain: `${cellName(firstHit.row, firstHit.col)} sees a light blue ${digit} and a yellow ${digit}. Whichever colour is true, it sees a true ${digit}, so it can't be ${digit}.`,
    doneFrame: {
      coloured: order,
      eliminated,
      links: (['blue', 'yellow'] as const).flatMap((color): TutorialLink[] => {
        const seen = order.find((c) => c.color === color && sees([c.row, c.col], [firstHit.row, firstHit.col]))
        return seen ? [{ from: firstHit, to: seen, kind: 'sees' }] : []
      }),
      spotlight,
    },
  }

  return [whichColour, extend, seesBoth, simpleCollideQuestion(collide.state, collide.digit)]
}

function simpleCollideQuestion(state: PuzzleState, digit: number): ChoiceQuestion {
  const { chain, order } = simpleChain(state, digit, 'solve')
  const rule1 = required(colorFinder.findRule1(chain), 'colour clash')
  const falseCells = order.filter((c) => c.color === rule1.falseColor)
  const clash = required(
    falseCells.flatMap((a) => falseCells.filter((b) => a !== b && sees([a.row, a.col], [b.row, b.col])).map((b) => [a, b] as const))[0],
    'two cells of one colour that see each other',
  )
  const where = sharedUnits([clash[0].row, clash[0].col], [clash[1].row, clash[1].col])[0]
  const falseName = COLOUR_NAME[rule1.falseColor]
  const trueName = COLOUR_NAME[rule1.trueColor]
  const spotlight = { digits: [digit] }
  const clashCells: TutorialCell[] = clash.map((c) => [c.row, c.col] as const)
  return choice(
    'simple-collide',
    'Quick pick',
    `A different puzzle, already coloured for ${digit}. Two ${falseName} ${digit}s (outlined) are in the same ${where.kind}. What does that tell you?`,
    state,
    { coloured: order, outlineCells: clashCells, links: [{ from: clash[0], to: clash[1], kind: 'sees' }], spotlight },
    [
      {
        label: `${capital(falseName)} is false, so ${trueName} is true`,
        swatch: rule1.trueColor,
        correct: true,
        why: `A ${where.kind} can't hold two ${digit}s, so ${falseName} can't be the true colour. That leaves ${trueName}: every ${trueName} ${digit} is a solution.`,
      },
      { label: `${capital(falseName)} is true`, swatch: rule1.falseColor, why: `Then ${unitPhrase(where)} would hold two ${digit}s.` },
      { label: 'Nothing yet', why: `All candidates of one colour are true together or false together - and two of them can't both be true.` },
    ],
    {
      coloured: order,
      outlineCells: clashCells,
      solved: order.filter((c) => c.color === rule1.trueColor),
      eliminated: falseCells,
      spotlight,
    },
  )
}

// ------------------------------------------------------------------ medusa

function medusaChain(state: PuzzleState, seed: CandRef) {
  const chain = required(
    medusaFinder.findChains(state.board, state.candidates).find((c) => c.candidates.some((n) => candKey(n) === candKey(seed))),
    '3D Medusa through the seed',
  )
  const graph = medusaFinder.buildStrongLinkGraph(state.board, state.candidates)
  const colourByKey = new Map(chain.candidates.map((n) => [candKey(n), n.color]))
  // Breadth-first from the seed, as the lesson spreads it.
  const start = chain.candidates.find((n) => candKey(n) === candKey(seed))!
  const order: ColouredCand[] = [{ ...ref(start.row, start.col, start.digit), color: start.color }]
  const edges = new Set<string>()
  const seen = new Set([candKey(start)])
  for (let i = 0; i < order.length; i++) {
    for (const neighbourKey of graph.adjacency.get(candKey(order[i])) ?? []) {
      const colour = colourByKey.get(neighbourKey)
      if (!colour) continue
      const node = graph.nodeByKey.get(neighbourKey)!
      edges.add(edgeKey(order[i], node))
      edges.add(edgeKey(node, order[i]))
      if (!seen.has(neighbourKey)) {
        seen.add(neighbourKey)
        order.push({ ...ref(node.row, node.col, node.digit), color: colour })
      }
    }
  }
  return { chain, order, edges }
}

/** `seesBoth`: a Medusa with a candidate that sees both colours (Rule 3) and
 * no clash. `clash`: one whose colours clash (two of a colour in a cell or a
 * unit). */
export function buildMedusaQuestions(
  seesBoth: { state: PuzzleState; seed: CandRef },
  clash: { state: PuzzleState; seed: CandRef },
): QuizQuestion[] {
  const { state } = seesBoth
  const { chain, order, edges } = medusaChain(state, seesBoth.seed)
  const sameCellAs = (a: CandRef, b: CandRef) => a.row === b.row && a.col === b.col
  // Ask about a link through a two-candidate cell: it is what Medusa adds.
  const askIndex = order.findIndex((node, i) => i > 0 && order.slice(0, i).some((p) => sameCellAs(p, node) && edges.has(edgeKey(p, node))))
  if (askIndex < 1) throw new Error('Practice question: this Medusa has no link through a two-candidate cell.')
  const [whichColour, extend] = colouringQuestions({
    idPrefix: 'medusa',
    state,
    order,
    edges,
    askIndex,
    linkPhrase: (node, parent) => {
      if (sameCellAs(node, parent)) return `the only other candidate in its cell`
      const u = strongUnit(state, node.digit, [parent.row, parent.col], [node.row, node.col])
      return `the only other ${node.digit} in ${u ? unitPhrase(u) : 'that unit'}`
    },
    outsideReason: () =>
      `Nothing links that candidate to a coloured one. It must be the only other candidate in a coloured candidate's cell, or the only other place for its digit in a row, column or box.`,
    extendPrompt:
      'Keep colouring. Tap a candidate linked to a coloured one: the only other candidate in its cell, or the only other place for its digit in a row, column or box.',
  })

  const rule3 = medusaFinder.findRule3Eliminations(chain, state.board, state.candidates)
  const hit = required(rule3[0], 'candidate that sees both colours')
  const eliminated = rule3.map((e) => ref(e.row, e.col, e.digit))
  const seesBothQuestion: CandidatesQuestion = {
    kind: 'candidates',
    id: 'medusa-sees-both',
    badge: 'What can be eliminated?',
    prompt: 'Exactly one colour is true. Tap an uncoloured candidate that sees both a light blue and a yellow candidate of its own digit.',
    state,
    frame: { coloured: order },
    answers: eliminated,
    need: 1,
    pickLook: 'eliminated',
    wrong: (pick) => {
      if (order.some((c) => candKey(c) === candKey(pick))) return `Coloured candidates stay for now: we don't know yet which colour is true.`
      const seen = (['blue', 'yellow'] as const).filter((color) =>
        order.some((c) => c.color === color && c.digit === pick.digit && sees([c.row, c.col], [pick.row, pick.col])),
      )
      return seen.length === 0
        ? `That ${pick.digit} sees no coloured ${pick.digit}. Only the same digit counts.`
        : `That ${pick.digit} only sees a ${COLOUR_NAME[seen[0]]} ${pick.digit}. It needs to see both colours.`
    },
    explain: `${cellName(hit.row, hit.col)} sees a light blue ${hit.digit} (${cellName(...hit.blueSeen)}) and a yellow ${hit.digit} (${cellName(...hit.yellowSeen)}). One colour is true, so it can't be ${hit.digit}.`,
    doneFrame: {
      coloured: order,
      eliminated,
      links: [
        { from: ref(hit.row, hit.col, hit.digit), to: ref(hit.blueSeen[0], hit.blueSeen[1], hit.digit), kind: 'sees' },
        { from: ref(hit.row, hit.col, hit.digit), to: ref(hit.yellowSeen[0], hit.yellowSeen[1], hit.digit), kind: 'sees' },
      ],
    },
  }
  return [whichColour, extend, seesBothQuestion, medusaClashQuestion(clash.state, clash.seed)]
}

function medusaClashQuestion(state: PuzzleState, seed: CandRef): ChoiceQuestion {
  const { chain, order } = medusaChain(state, seed)
  const mass = required(medusaFinder.findMassElimination(chain, state.board, state.candidates), 'colour clash')
  const conflict = mass.conflict
  if (conflict.kind === 'emptied') throw new Error('Practice question: this clash is an emptied cell, not two of one colour.')
  const falseName = COLOUR_NAME[mass.falseColor]
  const trueName = COLOUR_NAME[mass.trueColor]
  const pips: [CandRef, CandRef] =
    conflict.kind === 'cell'
      ? [ref(conflict.row, conflict.col, conflict.digitA), ref(conflict.row, conflict.col, conflict.digitB)]
      : [ref(conflict.a[0], conflict.a[1], conflict.digit), ref(conflict.b[0], conflict.b[1], conflict.digit)]
  const cells: TutorialCell[] = conflict.kind === 'cell' ? [[conflict.row, conflict.col]] : [conflict.a, conflict.b].map(([r, c]) => [r, c] as const)
  const where = conflict.kind === 'unit' ? sharedUnits(cells[0], cells[1])[0] : null
  const fact =
    conflict.kind === 'cell'
      ? `${cellName(conflict.row, conflict.col)} (outlined) holds two ${falseName} candidates`
      : `two ${falseName} ${conflict.digit}s (outlined) are in the same ${where?.kind ?? 'unit'}`
  const impossible =
    conflict.kind === 'cell'
      ? `${cellName(conflict.row, conflict.col)} would be two digits at once`
      : `${where ? unitPhrase(where) : 'that unit'} would hold two ${conflict.digit}s`
  return choice(
    'medusa-clash',
    'Quick pick',
    `A different puzzle, already coloured. Here ${fact}. What follows?`,
    state,
    { coloured: order, outlineCells: cells, links: [{ from: pips[0], to: pips[1], kind: 'sees' }] },
    [
      {
        label: `${capital(falseName)} is false, so ${trueName} is true`,
        swatch: mass.trueColor,
        correct: true,
        why: `If ${falseName} were true, ${impossible}. So ${falseName} is false and every ${trueName} candidate is a solution.`,
      },
      { label: `${capital(falseName)} is true`, swatch: mass.falseColor, why: `Then ${impossible}.` },
      {
        label: 'Only those two candidates are eliminated',
        why: `All candidates of one colour are true together or false together, so the whole colour is eliminated - not just the two that clash.`,
      },
    ],
    {
      coloured: order,
      outlineCells: cells,
      solved: mass.solvedCells.map((n) => ref(n.row, n.col, n.digit)),
      eliminated: mass.eliminatedCandidates.map((n) => ref(n.row, n.col, n.digit)),
    },
  )
}

// ------------------------------------------------- from a lesson's own frames

function withoutWords(frame: TutorialFrame): QuizFrame {
  const { caption: _caption, badge: _badge, ...rest } = frame
  return rest
}

/** The first frame that marks an elimination or a placement: the lesson's
 * conclusion, whichever technique it is. */
function conclusionFrame(lesson: TutorialLesson): TutorialFrame {
  return required(
    lesson.frames.find((f) => (f.eliminated?.length ?? 0) > 0 || (f.solved?.length ?? 0) > 0),
    'frame with an elimination',
  )
}

/**
 * "What can be eliminated?" on a lesson's own position: the board as the lesson's
 * conclusion frame draws it, minus the conclusion (red/green marks, the
 * dashed lines pointing at it); the lesson's own captions are the
 * explanation. `hint` is what a wrong tap says - where to look.
 */
export function whatGoesQuestion(
  lesson: TutorialLesson,
  id: string,
  hint: string,
  options: {
    /** "Tap a candidate ... removes." names the thing: 'this pattern'. */
    subject?: string
    /** The reason, where the conclusion frame is only the bare result ("So
     * r5c1 can't be 6.") because the lesson spent several frames on it. */
    why?: string
  } = {},
): CandidatesQuestion {
  const conclusion = conclusionFrame(lesson)
  const index = lesson.frames.indexOf(conclusion)
  // A caption that leans on the one before it ("The other one can't be 9",
  // "Any cell that sees both of them...") is told together with it.
  const leansOnPrevious = index > 0 && ['Why', 'Sees', 'Eliminate'].includes(conclusion.badge ?? '')
  const explain = [leansOnPrevious ? lesson.frames[index - 1].caption : '', conclusion.caption, conclusion.applied ? (options.why ?? '') : '']
    .filter(Boolean)
    .join(' ')
  const removes = (conclusion.eliminated?.length ?? 0) > 0
  const answers = removes ? conclusion.eliminated! : conclusion.solved!
  const shown = withoutWords(conclusion)
  const frame: QuizFrame = {
    ...shown,
    eliminated: undefined,
    solved: undefined,
    fresh: undefined,
    applied: false,
    links: shown.links?.filter((l) => l.kind === 'strong'),
  }
  return {
    kind: 'candidates',
    id,
    badge: 'What can be eliminated?',
    prompt: removes ? `Tap a candidate ${options.subject ?? 'this pattern'} removes.` : 'Tap the candidate that must be true.',
    state: lesson.state,
    frame,
    answers,
    need: 1,
    pickLook: removes ? 'eliminated' : 'solved',
    wrong: () => hint,
    explain,
    doneFrame: { ...shown, applied: false },
  }
}

/** "Tap these cells" on a lesson's own position. `pick` chooses the answers
 * from the lesson's outlined cells (the pattern). */
export function patternCellsQuestion(
  lesson: TutorialLesson,
  id: string,
  options: {
    prompt: (info: { digits: number[]; count: number }) => string
    /** Which of the outlined cells are the answer; all of them if omitted. */
    pick?: (cell: TutorialCell, info: { digits: number[]; state: PuzzleState }) => boolean
    /** Show the pattern's outline while asking (off when finding it is the
     * question). */
    showOutline: boolean
    wrong: (cell: TutorialCell, info: { digits: number[]; outlined: boolean; state: PuzzleState }) => string
    explain: string
  },
): CellsQuestion {
  const first = lesson.frames[0]
  const outlined = first.outlineCells ?? []
  // The pattern's own digits: the ones the first frame marks in yellow.
  const digits = [...new Set((first.basis ?? []).map((b) => b.digit))].sort((a, b) => a - b)
  const state = lesson.state
  const answers = outlined.filter((cell) => !options.pick || options.pick(cell, { digits, state }))
  if (answers.length === 0) throw new Error('Practice question: the lesson outlines no such cell.')
  const base: QuizFrame = { spotlight: first.spotlight, links: options.showOutline ? first.links : undefined }
  return {
    kind: 'cells',
    id,
    badge: 'Spot it',
    prompt: options.prompt({ digits, count: answers.length }),
    state,
    frame: options.showOutline ? { ...base, outlineCells: outlined } : base,
    answers,
    need: answers.length,
    wrong: (cell) => options.wrong(cell, { digits, outlined: outlined.some((o) => sameCell(o, cell)), state }),
    explain: options.explain,
    doneFrame: { ...withoutWords(first), outlineCells: outlined },
  }
}

const DRAGON_COLOUR_OF: Partial<Record<TutorialColor, TutorialColor>> = {
  darkBlue: 'blue',
  orange: 'yellow',
  purple: 'pink',
  darkGreen: 'limeGreen',
}

/**
 * "Which colour?" on a Dragon lesson's own position: the first step that
 * colours a candidate in one of `colours` (dragon colours), shown just before
 * that candidate is coloured (`badge`: only a step with that label, e.g.
 * 'Dynamic'). The step's own caption is the explanation.
 */
export function dragonColourQuestion(lesson: TutorialLesson, id: string, colours: TutorialColor[], badge?: string): ChoiceQuestion {
  for (const step of lesson.frames) {
    const fresh = step.fresh ?? []
    if (fresh.length !== 1 || (badge && step.badge !== badge)) continue
    const key = candKey(fresh[0])
    const added = (step.coloured ?? []).find((c) => candKey(c) === key && colours.includes(c.color))
    const side = added && DRAGON_COLOUR_OF[added.color]
    if (!added || !side) continue
    const wrongDragon = required(colours.find((c) => c !== added.color), 'second dragon colour')
    const wrongSide = DRAGON_COLOUR_OF[wrongDragon]!
    const before = (step.coloured ?? []).filter((c) => !(candKey(c) === key && c.color === added.color))
    const frame: QuizFrame = { ...withoutWords(step), coloured: before, eliminated: undefined, solved: undefined }
    return choice(
      id,
      'Quick pick',
      `The circled ${fresh[0].digit} in ${cellName(fresh[0].row, fresh[0].col)} is forced whenever ${COLOUR_NAME[side]} is true. Which colour does it get?`,
      lesson.state,
      frame,
      [
        {
          label: capital(COLOUR_NAME[added.color]),
          swatch: added.color,
          correct: true,
          why: `${capital(COLOUR_NAME[added.color])} is ${COLOUR_NAME[side]}'s dragon colour: true whenever ${COLOUR_NAME[side]} is true. ${step.caption}`,
        },
        {
          label: capital(COLOUR_NAME[wrongDragon]),
          swatch: wrongDragon,
          why: `${capital(COLOUR_NAME[wrongDragon])} is for what follows from ${COLOUR_NAME[wrongSide]}. This candidate follows from ${COLOUR_NAME[side]}.`,
        },
        {
          label: capital(COLOUR_NAME[side]),
          swatch: side,
          why: `${capital(COLOUR_NAME[side])} is kept for candidates that are true exactly when ${COLOUR_NAME[side]} is. This one is only known to follow from it, so it gets the dragon colour.`,
        },
      ],
      withoutWords(step),
    )
  }
  throw new Error('Practice question: the lesson has no single dragon-coloured step.')
}

/**
 * How a Dragon lesson ends, on its own position. When a whole side turns out
 * false the question is what that means for the four colours; when it ends
 * on single eliminations it is "what can be eliminated?".
 */
export function dragonResultQuestion(lesson: TutorialLesson, id: string): QuizQuestion {
  const conclusion = conclusionFrame(lesson)
  const colourOf = new Map<string, TutorialColor[]>()
  for (const c of conclusion.coloured ?? []) colourOf.set(candKey(c), [...(colourOf.get(candKey(c)) ?? []), c.color])
  const falseColours = new Set((conclusion.eliminated ?? []).flatMap((e) => colourOf.get(candKey(e)) ?? []))
  const secondDragon = [...falseColours].some((c) => c === 'pink' || c === 'purple' || c === 'limeGreen' || c === 'darkGreen')
  const sides: Array<[TutorialColor, TutorialColor]> = secondDragon
    ? [
        ['pink', 'purple'],
        ['limeGreen', 'darkGreen'],
      ]
    : [
        ['blue', 'darkBlue'],
        ['yellow', 'orange'],
      ]
  const falseSide = sides.find(([medusa, dragon]) => falseColours.has(medusa) || falseColours.has(dragon))
  if (!falseSide || (conclusion.solved?.length ?? 0) === 0) {
    return whatGoesQuestion(lesson, id, 'Look for a candidate that loses out whichever side is true: one that sees both sides, or shares a cell with both.', {
      subject: 'the finished colouring',
    })
  }
  const trueSide = sides.find((s) => s !== falseSide)!
  const [f, fDragon] = falseSide.map((c) => COLOUR_NAME[c])
  const [t, tDragon] = trueSide.map((c) => COLOUR_NAME[c])
  const shown = withoutWords(conclusion)
  return choice(
    id,
    'Quick pick',
    `The colouring has run into a contradiction: ${f} can't be true. What follows?`,
    lesson.state,
    { ...shown, eliminated: undefined, solved: undefined, fresh: undefined },
    [
      {
        label: `${capital(t)} and ${tDragon} are true; ${f} is false.`,
        swatch: trueSide[0],
        correct: true,
        why: `Exactly one side is true. ${capital(f)} is false, so ${t} is true - and so is everything that follows from it (${tDragon}). ${conclusion.caption}`,
      },
      {
        label: `Only the ${f} candidates are eliminated`,
        swatch: falseSide[0],
        why: `${capital(fDragon)} only ever followed from ${f}, so it proves nothing now - and with ${f} false, ${t} must be true.`,
      },
      { label: 'Every coloured candidate is eliminated', why: `One of ${f} and ${t} is always true. With ${f} false, the ${t} side is the solution.` },
    ],
    shown,
  )
}

/** Promotion, on a Dragon lesson's own position: the picture just before
 * its first Promote step, with the candidates about to be promoted ringed. */
export function promotionQuestion(lesson: TutorialLesson, id: string): ChoiceQuestion {
  const index = lesson.frames.findIndex((f) => f.badge === 'Promote')
  if (index < 1) throw new Error('Practice question: the lesson has no Promote step.')
  const promote = lesson.frames[index]
  const ringed = promote.fresh ?? []
  if (ringed.length === 0) throw new Error('Practice question: the Promote step recolours nothing.')
  const one = ringed.length === 1
  return choice(
    id,
    'Quick pick',
    one
      ? `The circled dragon-coloured candidate has met the opposite side: it and a candidate of the other side can't both be true. What happens to it?`
      : `Opposite dragon colours have met at the circled candidates: they can't both be true. What happens to them?`,
    lesson.state,
    { ...withoutWords(lesson.frames[index - 1]), fresh: ringed },
    [
      {
        label: `${one ? 'It is' : 'They are'} promoted to Medusa colours`,
        correct: true,
        why: `Exactly one side is true, and these can't both be true - so each is true exactly when its own side is. That is what light blue and yellow mean, so dark blue becomes light blue and orange becomes yellow.`,
      },
      { label: `${one ? 'It is' : 'They are'} removed`, why: `They can't both be true, but one of them is - just like light blue and yellow.` },
      { label: 'Nothing changes', why: `Meeting the opposite side tells us more: each is now tied to its side both ways, not just one.` },
    ],
    withoutWords(promote),
  )
}

/** A hand-written concept question shown over one of a lesson's pictures. */
export function conceptQuestion(
  lesson: TutorialLesson,
  id: string,
  prompt: string,
  options: QuizOption[],
  frame: QuizFrame = { ...withoutWords(lesson.frames[0]) },
): ChoiceQuestion {
  return choice(id, 'Quick pick', prompt, lesson.state, frame, options)
}

// The first Dragon's dragon colours and the Medusa colour each follows from;
// the second Dragon's two Medusa colours and their own dragon colours.
const FIRST_DRAGON_SIDE: Partial<Record<TutorialColor, TutorialColor>> = { darkBlue: 'blue', orange: 'yellow' }
const SECOND_MEDUSA_OTHER: Partial<Record<TutorialColor, TutorialColor>> = { pink: 'limeGreen', limeGreen: 'pink' }
const SECOND_DRAGON_COLOUR: Partial<Record<TutorialColor, TutorialColor>> = { pink: 'purple', limeGreen: 'darkGreen' }

/**
 * Double Dragon Colouring's quiz, by request: nothing but how the two
 * Dragons' colours relate, asked on a candidate that carries a first-Dragon
 * dragon colour D (true whenever its Medusa colour M is) and a second-Medusa
 * colour Y at once. With X the second Medusa's other colour:
 *
 *   D and Y are one candidate, so neither need be true;
 *   that candidate true => Y true => X false;   M true => X false;
 *   X true => M false (the same fact read backwards - the Dragon link);
 *   X false =/=> M true (a true D candidate doesn't prove M).
 *
 * The last two are the pair people mix up, which is why both are asked.
 * `frame` is the lesson picture with both Dragons coloured; a position
 * without such a candidate throws, so it gets no quiz.
 */
export function doubleDragonRelationQuestions(lesson: TutorialLesson, frame: QuizFrame): ChoiceQuestion[] {
  const coloured = frame.coloured ?? []
  const firstOf = (c: ColouredCand) => coloured.find((o) => candKey(o) === candKey(c) && FIRST_DRAGON_SIDE[o.color] !== undefined)
  const second = required(
    coloured.find((c) => SECOND_MEDUSA_OTHER[c.color] !== undefined && firstOf(c) !== undefined),
    'a candidate with a first-Dragon dragon colour and a second-Medusa colour',
  )
  const first = required(firstOf(second), 'its first-Dragon colour')
  const side = required(FIRST_DRAGON_SIDE[first.color], 'the Medusa colour of the dragon colour')
  const other = required(SECOND_MEDUSA_OTHER[second.color], "the second Medusa's other colour")
  const d = COLOUR_NAME[first.color]
  const m = COLOUR_NAME[side]
  const mOther = COLOUR_NAME[side === 'blue' ? 'yellow' : 'blue']
  const mOtherDragon = COLOUR_NAME[side === 'blue' ? 'orange' : 'darkBlue']
  const y = COLOUR_NAME[second.color]
  const x = COLOUR_NAME[other]
  const xDragon = COLOUR_NAME[required(SECOND_DRAGON_COLOUR[other], 'its dragon colour')]
  const where = `${second.digit} in ${cellName(second.row, second.col)}`
  const shown: QuizFrame = { ...frame, fresh: [{ row: second.row, col: second.col, digit: second.digit }] }
  const ask = (id: string, prompt: string, options: QuizOption[]) => choice(id, 'Quick pick', prompt, lesson.state, shown, options)
  return [
    ask(
      'same-candidate',
      `The circled ${where} has two colours: ${d} from the first Dragon set and ${y} from the second Medusa set. Can we assume that one of ${d} and ${y} must always be true?`,
      [
        {
          label: 'No',
          correct: true,
          why: `Both colours are on the same candidate, so here they are true together or false together. If the ${where} is false, ${x} is the true colour of the second Dragon and ${mOther} the true colour of the first.`,
        },
        {
          label: 'Yes',
          why: `That holds for the two colours of one Medusa: ${x} and ${y}, or light blue and yellow. ${capital(d)} and ${y} are on the same candidate here, and that candidate may well be false.`,
        },
      ],
    ),
    ask('dragon-colour-and-other', `${capital(x)} is the second Medusa's other colour. If the ${d} ${where} is true, what does that say about ${x}?`, [
      {
        label: `${capital(x)} is false`,
        swatch: other,
        correct: true,
        why: `That ${second.digit} is ${y} as well, so ${y} is true - and exactly one of ${x} and ${y} is true, so ${x} is false.`,
      },
      { label: `${capital(x)} is true`, swatch: other, why: `That ${second.digit} is ${y} as well, and ${x} and ${y} are never both true.` },
      { label: 'Nothing', why: `That ${second.digit} is ${y} as well, which settles the second Dragon: ${y} is true, so ${x} is not.` },
    ]),
    ask(
      'medusa-colour-and-other',
      `${capital(d)} is ${m}'s dragon colour: every ${d} candidate is true whenever ${m} is true. So if ${m} is true, what does that say about ${x}?`,
      [
        {
          label: `${capital(x)} is false`,
          swatch: other,
          correct: true,
          why: `If ${m} is true, the ${d} ${where} is true. It is ${y} as well, so ${y} is true and ${x} is false.`,
        },
        {
          label: `${capital(x)} is true`,
          swatch: other,
          why: `${capital(m)} makes the ${d} ${where} true, and that ${second.digit} is ${y} - the opposite of ${x}.`,
        },
        {
          label: 'Nothing',
          why: `${capital(m)} makes the ${d} ${where} true, and that ${second.digit} is ${y}, so the second Dragon is settled too.`,
        },
      ],
    ),
    ask('other-true', `Now turn it around. If ${x} is true, can we say that ${m} is false?`, [
      {
        label: 'Yes',
        correct: true,
        why: `It is the same fact read backwards: if ${m} were true, ${x} would be false. So when ${x} is true, ${m} is false and ${mOther} is true - which is why every ${mOther} and ${mOtherDragon} candidate can be coloured ${xDragon} as well.`,
      },
      {
        label: 'No',
        why: `If ${m} were true, the ${where} would be true and ${x} false. So ${x} and ${m} can't both be true: when ${x} is true, ${m} is false.`,
      },
    ]),
    ask('other-false', `And the other way: if ${x} is false, can we say that ${m} is true?`, [
      {
        label: 'No',
        correct: true,
        why: `If ${x} is false, ${y} is true, so the ${where} is true. But ${d} only follows from ${m} - a true ${d} candidate doesn't prove ${m}. ${capital(mOther)} could still be the true colour.`,
      },
      {
        label: 'Yes',
        why: `${capital(x)} being false does make the ${where} true, but that doesn't make ${m} true: a dragon colour's candidate can be true while its Medusa colour is false. All we know is that ${d} is true whenever ${m} is.`,
      },
    ]),
  ]
}

export { cellName as quizCellName, digitsAt as quizDigitsAt, list as quizList }

// ------------------------------------------------- miscellaneous: Y-Wing

/** Every pair of pincers the pivot could command: cells it sees holding only
 * {X,Z} and {Y,Z} for one Z - the answer key of "tap its two pincers", worked
 * out from the grid so a second Y-Wing on the same pivot can't be missed. */
function pincerPairs(state: PuzzleState, pivot: TutorialCell): Array<[TutorialCell, TutorialCell]> {
  // Every pair has one cell holding x and one holding y, so taking `a` as
  // the x side finds each pair once.
  const [x, y] = digitsAt(state, pivot)
  const seen = NINE.flatMap((r) => NINE.map((c) => [r, c] as const)).filter((cell) => sees(pivot, cell) && digitsAt(state, cell).length === 2)
  const pairs: Array<[TutorialCell, TutorialCell]> = []
  for (const a of seen) {
    const da = digitsAt(state, a)
    if (!da.includes(x) || da.includes(y)) continue
    const z = da.find((d) => d !== x)!
    for (const b of seen) {
      const db = digitsAt(state, b)
      if (db.includes(y) && db.includes(z)) pairs.push([a, b])
    }
  }
  return pairs
}

/**
 * Y-Wing's practice, on two fresh positions (quizExamples.ts), told as the
 * lesson tells it - a pivot, two pincers, a bent triple - never as a chain.
 * `first` is asked about step by step; `second` only "what can be eliminated?", with the
 * three cells outlined and the rest left to the reader.
 */
export function buildYWingQuestions(
  first: { state: PuzzleState; pivot: TutorialCell },
  second: { state: PuzzleState; pivot: TutorialCell },
): QuizQuestion[] {
  const { state } = first
  const wing = required(findYWing(state, first.pivot), 'Y-Wing on that pivot')
  const { pivot, pincers, x, y, z, targets } = wing
  const pairs = pincerPairs(state, pivot)
  if (pairs.length !== 1) throw new Error(`Practice question: the pivot commands ${pairs.length} pairs of pincers, not one.`)
  const [p, w1, w2] = [pivot, ...pincers].map(([r, c]) => cellName(r, c))
  const three = [pivot, pincers[0], pincers[1]]
  const pips = (cell: TutorialCell) => digitsAt(state, cell).map((d) => ref(cell[0], cell[1], d))
  const found: QuizFrame = { outlineCells: three, basis: three.flatMap(pips) }
  const orderedOr = (a: number, b: number) => `${Math.min(a, b)} or ${Math.max(a, b)}`

  const spot: CellsQuestion = {
    kind: 'cells',
    id: 'y-wing-pincers',
    badge: 'Spot it',
    prompt: `The outlined ${p} can only be ${orderedOr(x, y)}: it is the pivot. Tap its two pincers - cells it sees holding only ${x} and one other digit, and only ${y} and that same digit.`,
    state,
    frame: { outlineCells: [pivot], basis: pips(pivot) },
    answers: [...pincers],
    need: 2,
    wrong: (cell) => {
      const name = cellName(cell[0], cell[1])
      if (sameCell(cell, pivot)) return `${name} is the pivot itself.`
      if (state.board[cell[0]][cell[1]] !== 0) return `${name} is already filled in.`
      if (!sees(pivot, cell)) return `${name} doesn't share a row, column or box with the pivot, so the pivot can't command it.`
      const digits = digitsAt(state, cell)
      if (digits.length !== 2) return `${name} has ${digits.length} candidates (${digits.join(', ')}). A pincer has exactly two.`
      if (digits.includes(x) && digits.includes(y)) return `${name} holds the pivot's own two digits. A pincer shares only one of them.`
      if (!digits.includes(x) && !digits.includes(y)) return `${name} (${digits.join(', ')}) shares no digit with the pivot.`
      return `${name} (${digits.join(', ')}) shares a digit with the pivot, but no cell on the other side shares its second digit.`
    },
    explain: `${w1} (${orderedOr(x, z)}) and ${w2} (${orderedOr(y, z)}): each shares one of the pivot's digits, and both share ${z}. Three cells, three digits - a bent triple.`,
    doneFrame: found,
  }

  const suppose = choice(
    'y-wing-if',
    'Quick pick',
    `Suppose the pivot ${p} is ${x}. What does the pincer ${w1} have to be?`,
    state,
    { ...found, solved: [ref(pivot[0], pivot[1], x)], eliminated: [ref(pivot[0], pivot[1], y)] },
    [
      { label: String(z), correct: true, why: `${w1} sees the pivot, so it can't be ${x} as well - only ${z} is left.` },
      { label: String(x), why: `${w1} sees the pivot, so the two of them can't both be ${x}.` },
      { label: "Can't tell yet", why: `${w1} holds only ${x} and ${z}, and the pivot has taken ${x}.` },
    ],
    {
      ...found,
      solved: [ref(pivot[0], pivot[1], x), ref(pincers[0][0], pincers[0][1], z)],
      eliminated: [ref(pivot[0], pivot[1], y), ref(pincers[0][0], pincers[0][1], x)],
    },
  )

  const attack: QuizFrame = { outlineCells: three, basis: pincers.map(([r, c]) => ref(r, c, z)), unitCells: targets, spotlight: { digits: [z] } }
  const why = choice(
    'y-wing-why',
    'Quick pick',
    `The tinted cells see both pincers. Why can none of them be ${z}?`,
    state,
    attack,
    [
      {
        label: `Whichever digit the pivot is, one of the pincers is ${z}`,
        correct: true,
        why: `If the pivot is ${x}, ${w1} is ${z}; if it is ${y}, ${w2} is ${z}. Either way a cell that sees both pincers sees a ${z}.`,
      },
      { label: `Both pincers are ${z}`, why: `Only one of them has to be - and one is enough, because these cells see both.` },
      { label: `The pivot is ${z}`, why: `The pivot can only be ${x} or ${y}. It is the pincers that carry ${z}.` },
    ],
    { ...attack, eliminated: wing.eliminated },
  )

  const other = required(findYWing(second.state, second.pivot), 'Y-Wing on that pivot')
  const otherThree = [other.pivot, other.pincers[0], other.pincers[1]]
  const [p2, v1, v2] = otherThree.map(([r, c]) => cellName(r, c))
  const need = Math.min(2, other.eliminated.length)
  const struck = list(other.eliminated.map((e) => cellName(e.row, e.col)))
  const remove: CandidatesQuestion = {
    kind: 'candidates',
    id: 'y-wing-remove',
    badge: 'What can be eliminated?',
    prompt: `The three outlined cells are a Y-Wing. Tap ${need === 1 ? 'a candidate' : 'two candidates'} it removes.`,
    state: second.state,
    frame: { outlineCells: otherThree },
    answers: other.eliminated,
    need,
    pickLook: 'eliminated',
    wrong: (pick) => {
      const cell: TutorialCell = [pick.row, pick.col]
      if (otherThree.some((c) => sameCell(c, cell))) return "The Y-Wing's own cells keep their candidates."
      if (pick.digit !== other.z) return 'Only the digit both pincers share is attacked. Find the pivot first: the cell that sees the other two.'
      return "That cell doesn't see both pincers."
    },
    explain: `${p2} is the pivot (${other.x} or ${other.y}); ${v1} and ${v2} are its pincers, sharing ${other.z}. So ${other.z} can be eliminated from every cell that sees both pincers: ${struck}.`,
    doneFrame: { outlineCells: otherThree, unitCells: other.targets, eliminated: other.eliminated },
  }
  return [spot, suppose, why, remove]
}

// ------------------------------------------------- miscellaneous: W-Wing

/**
 * W-Wing's practice, on two fresh positions (quizExamples.ts), told as the
 * lesson tells it - a remote pair that a unit won't let be the same digit -
 * never as a chain. `first` is asked about step by step; `second` only "what can
 * be eliminated?", with the pair outlined and the unit tinted.
 */
export function buildWWingQuestions(
  first: { state: PuzzleState; pair: readonly [TutorialCell, TutorialCell] },
  second: { state: PuzzleState; pair: readonly [TutorialCell, TutorialCell] },
): QuizQuestion[] {
  const { state } = first
  const wing = required(findWWing(state, first.pair), 'W-Wing on that pair')
  const { pair, link, other, unit: u, linkPlaces, eliminated } = wing
  const [anchor, partner] = pair
  const [a, b] = pair.map(([r, c]) => cellName(r, c))
  const where = unitPhrase(u)
  const pairDigits = [link, other].sort((p, q) => p - q)
  const pairText = `${pairDigits[0]} or ${pairDigits[1]}`
  const pips = pair.flatMap(([r, c]) => [ref(r, c, link), ref(r, c, other)])
  const linkPips = linkPlaces.map(([r, c]) => ref(r, c, link))
  const found: QuizFrame = { outlineCells: [...pair], basis: pips }

  // Every cell the anchor can't see holding exactly its two digits is a
  // remote partner, W-Wing or not - which is all the prompt asks for.
  const sameTwo = (cell: TutorialCell) => {
    const digits = digitsAt(state, cell)
    return digits.length === 2 && digits[0] === pairDigits[0] && digits[1] === pairDigits[1]
  }
  const partners = NINE.flatMap((r) => NINE.map((c) => [r, c] as const)).filter(
    (cell) => !sameCell(cell, anchor) && !sees(anchor, cell) && sameTwo(cell),
  )
  const anchorName = cellName(anchor[0], anchor[1])
  const spot: CellsQuestion = {
    kind: 'cells',
    id: 'w-wing-partner',
    badge: 'Spot it',
    prompt: `The outlined ${anchorName} can only be ${pairText}. Tap a cell with exactly the same two candidates that ${anchorName} can't see - a remote partner.`,
    state,
    frame: { outlineCells: [anchor], basis: pips.filter((p) => sameCell([p.row, p.col], anchor)) },
    answers: partners,
    need: 1,
    wrong: (cell) => {
      const name = cellName(cell[0], cell[1])
      if (sameCell(cell, anchor)) return `${name} is the outlined cell itself.`
      if (state.board[cell[0]][cell[1]] !== 0) return `${name} is already filled in.`
      if (!sameTwo(cell)) return `${name} holds ${digitsAt(state, cell).join(', ')} - not exactly ${pairText}.`
      return `${name} sees ${anchorName}: together they are an ordinary naked pair, not a remote one.`
    },
    explain:
      partners.length === 1
        ? `${cellName(...partners[0])} can only be ${pairText} too, and can't see ${anchorName}: a remote pair. Nothing stops the two from being the same digit.`
        : `${list(partners.map((c) => cellName(c[0], c[1])))} can each only be ${pairText} too, and can't see ${anchorName}: each makes a remote pair with it. The next questions follow ${cellName(partner[0], partner[1])}.`,
    doneFrame: { outlineCells: [anchor, ...partners], basis: [anchor, ...partners].flatMap(([r, c]) => [ref(r, c, link), ref(r, c, other)]) },
  }

  const unitFrame: QuizFrame = { ...found, unitCells: u.cells, basis: [...pips, ...linkPips], spotlight: { digits: [link] } }
  const section = choice(
    'w-wing-unit',
    'Quick pick',
    `Every ${link} left in the tinted ${where} sees ${a} or ${b}. Could ${a} and ${b} both be ${link}?`,
    state,
    unitFrame,
    [
      {
        label: `No - ${where} would have nowhere left for ${link}`,
        correct: true,
        why: `Both being ${link} would rule out every ${link} in ${where}, and a ${u.kind} must hold every digit once.`,
      },
      {
        label: "Yes - they can't see each other",
        why: `No rule stops them directly, but ${where} would lose every place for ${link}. That is what makes this pair special.`,
      },
      { label: `They must both be ${link}`, why: `Nothing forces that - and it would leave ${where} with no ${link} at all.` },
    ],
    { ...unitFrame, eliminated: linkPips },
  )

  const t = eliminated[0]
  const tName = cellName(t.row, t.col)
  const supposeFrame: QuizFrame = { ...found, unitCells: u.cells, fresh: [t], spotlight: { digits: [link, other] } }
  const suppose = choice(
    'w-wing-suppose',
    'Quick pick',
    `${tName} sees both ${a} and ${b}. Suppose the circled ${other} in ${tName} were true. What would happen?`,
    state,
    supposeFrame,
    [
      {
        label: `${a} and ${b} would both be ${link}, so ${where} would have no ${link}`,
        correct: true,
        why: `Both cells lose ${other} and are left with ${link} - which breaks ${where}. So ${tName} can't be ${other}.`,
      },
      { label: `Only ${a} would change`, why: `${tName} sees both cells of the pair, so both lose ${other}.` },
      {
        label: "Nothing - the pair can't see each other",
        why: `They don't need to see each other: each of them sees ${tName}, and that is enough to force both to be ${link}.`,
      },
    ],
    {
      ...supposeFrame,
      fresh: undefined,
      solved: [t, ...pair.map(([r, c]) => ref(r, c, link))],
      eliminated: [...pair.map(([r, c]) => ref(r, c, other)), ...linkPips],
    },
  )

  const next = required(findWWing(second.state, second.pair), 'W-Wing on that pair')
  const [c1, c2] = next.pair.map(([r, c]) => cellName(r, c))
  const nextWhere = unitPhrase(next.unit)
  const need = Math.min(2, next.eliminated.length)
  const struck = list(next.eliminated.map((e) => cellName(e.row, e.col)))
  const remove: CandidatesQuestion = {
    kind: 'candidates',
    id: 'w-wing-remove',
    badge: 'What can be eliminated?',
    prompt: `The outlined cells are a remote pair, and every ${next.link} in the tinted ${nextWhere} sees one of them. Tap ${need === 1 ? 'a candidate' : 'two candidates'} this W-Wing removes.`,
    state: second.state,
    frame: { outlineCells: [...next.pair], unitCells: next.unit.cells },
    answers: next.eliminated,
    need,
    pickLook: 'eliminated',
    wrong: (pick) => {
      const cell: TutorialCell = [pick.row, pick.col]
      if (next.pair.some((c) => sameCell(c, cell))) return "The pair's own candidates stay."
      if (pick.digit !== next.other) return `Look for the pair's other digit, ${next.other}: being ${next.other} would force both cells to be ${next.link}.`
      return "That cell doesn't see both cells of the pair."
    },
    explain: `A cell that sees ${c1} and ${c2} can't be ${next.other}: it would force both to be ${next.link}, leaving ${nextWhere} without one. So ${next.other} can be eliminated from ${struck}.`,
    doneFrame: { outlineCells: [...next.pair], unitCells: next.targets, eliminated: next.eliminated },
  }
  return [spot, section, suppose, remove]
}

// ------------------------------------------------- miscellaneous: AIC

/**
 * AIC's practice, on two fresh positions (quizExamples.ts): what a strong
 * link and a weak link each say, what the whole chain proves, then "what can
 * be eliminated?" on a second chain. Chains are drawn, as in the lesson.
 */
export function buildAicQuestions(
  first: { state: PuzzleState; pattern: 'Skyscraper' | 'Two-String Kite'; start: CandRef },
  second: { state: PuzzleState; pattern: 'Skyscraper' | 'Two-String Kite'; start: CandRef },
): QuizQuestion[] {
  const { state } = first
  const chain = required(findAicChain(state, first.pattern, first.start), `${first.pattern} from that candidate`)
  const [n0, n1, n2, n3] = chain.nodes
  if (!n3 || chain.nodes.length !== 4) throw new Error('Practice question: expected a four-candidate chain.')
  const name = (c: CandRef) => `${c.digit} in ${cellName(c.row, c.col)}`
  const links: TutorialLink[] = [
    { from: n0, to: n1, kind: 'strong' },
    { from: n1, to: n2, kind: 'weak' },
    { from: n2, to: n3, kind: 'strong' },
  ]
  const spotlight = { digits: [n0.digit] }
  if (sees([n0.row, n0.col], [n3.row, n3.col])) throw new Error("Practice question: the chain's ends see each other, so exactly one is true.")
  const strong = required(strongUnit(state, n0.digit, [n0.row, n0.col], [n1.row, n1.col]), 'strong link unit')
  const weakUnits = sharedUnits([n1.row, n1.col], [n2.row, n2.col])
  const weak = required(weakUnits[weakUnits.length - 1], 'weak link unit')

  const strongFrame: QuizFrame = { links: links.slice(0, 1), basis: [n0, n1], spotlight }
  const strongQuestion = choice(
    'aic-strong',
    'Quick pick',
    `The red line is a strong link: ${name(n0)} and ${name(n1)} are the only places for ${n0.digit} in ${unitPhrase(strong)}. If ${name(n0)} is false, what is ${name(n1)}?`,
    state,
    strongFrame,
    [
      { label: 'True', correct: true, why: `${capital(unitPhrase(strong))} needs a ${n0.digit} somewhere, and ${cellName(n1.row, n1.col)} is the only other place left.` },
      { label: 'False', why: `Then ${unitPhrase(strong)} would have no ${n0.digit} at all. A strong link means the two can't both be false.` },
      { label: "Can't tell", why: `With only two places for ${n0.digit} in ${unitPhrase(strong)}, ruling one out decides the other.` },
    ],
    { ...strongFrame, basis: undefined, eliminated: [n0], solved: [n1] },
  )

  const weakFrame: QuizFrame = { links: links.slice(0, 2), basis: [n0, n1, n2], spotlight }
  const weakQuestion = choice(
    'aic-weak',
    'Quick pick',
    `The dashed blue line is a weak link: ${name(n1)} and ${name(n2)} share ${unitPhrase(weak)}. If ${name(n1)} is true, what is ${name(n2)}?`,
    state,
    weakFrame,
    [
      { label: 'False', correct: true, why: `${capital(unitPhrase(weak))} can't hold two ${n1.digit}s. A weak link means the two can't both be true.` },
      { label: 'True', why: `That would put ${n1.digit} twice in ${unitPhrase(weak)}.` },
      {
        label: "Can't tell",
        why: `A weak link does decide this case: if one end is true, the other is false. (If one were false, that is when it couldn't tell.)`,
      },
    ],
    { ...weakFrame, basis: [n0], solved: [n1], eliminated: [n2] },
  )

  const chainFrame: QuizFrame = { links, basis: chain.nodes, spotlight }
  const endsQuestion = choice(
    'aic-ends',
    'Quick pick',
    `The whole chain runs strong, weak, strong, from ${name(n0)} to ${name(n3)}. What does it prove about those two ends?`,
    state,
    chainFrame,
    [
      {
        label: 'At least one of them is true',
        correct: true,
        why: `If ${name(n0)} is false, the strong link makes ${name(n1)} true, the weak link makes ${name(n2)} false, and the last strong link makes ${name(n3)} true.`,
      },
      { label: 'Exactly one of them is true', why: 'Nothing stops both ends from being true - the chain only rules out both being false.' },
      { label: 'Both of them are true', why: 'Only one end has to be. The chain proves they are never both false.' },
    ],
    { ...chainFrame, basis: [n0, n3], eliminated: chain.eliminated },
  )

  const next = required(findAicChain(second.state, second.pattern, second.start), `${second.pattern} from that candidate`)
  const ends = [next.nodes[0], next.nodes[next.nodes.length - 1]]
  const nextLinks: TutorialLink[] = next.nodes.slice(1).map((to, i) => ({ from: next.nodes[i], to, kind: i % 2 === 0 ? 'strong' : 'weak' }))
  const need = Math.min(2, next.eliminated.length)
  const remove: CandidatesQuestion = {
    kind: 'candidates',
    id: 'aic-remove',
    badge: 'What can be eliminated?',
    prompt: `This chain runs strong, weak, strong from ${name(ends[0])} to ${name(ends[1])}. Tap ${need === 1 ? 'a candidate' : 'two candidates'} it eliminates.`,
    state: second.state,
    frame: { links: nextLinks, basis: next.nodes, spotlight: { digits: [ends[0].digit] } },
    answers: next.eliminated,
    need,
    pickLook: 'eliminated',
    wrong: (pick) => {
      if (next.nodes.some((n) => n.row === pick.row && n.col === pick.col && n.digit === pick.digit)) return "The chain's own candidates stay."
      if (pick.digit !== ends[0].digit) return `Both ends are ${ends[0].digit}s, so look for ${ends[0].digit === 8 ? 'an' : 'a'} ${ends[0].digit}.`
      return "That one doesn't see both ends of the chain."
    },
    explain: `One end of the chain is always true, so ${ends[0].digit === 8 ? 'an' : 'a'} ${ends[0].digit} that sees both ends can be eliminated: ${list(next.eliminated.map((e) => cellName(e.row, e.col)))}.`,
    doneFrame: { links: nextLinks, basis: ends, eliminated: next.eliminated, spotlight: { digits: [ends[0].digit] } },
  }
  return [strongQuestion, weakQuestion, endsQuestion, remove]
}
