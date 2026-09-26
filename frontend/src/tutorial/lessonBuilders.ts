import { markedCandidateDigits } from '../sudoku/boardUtils'
import { foldDragonMoves } from '../sudoku/dragonReplay'
import { SudokuBivalueOddagonFinder } from '../sudoku/SudokuBivalueOddagonFinder'
import { SudokuBugPlusOneFinder } from '../sudoku/SudokuBugPlusOneFinder'
import { SudokuColorFinder } from '../sudoku/SudokuColorFinder'
import {
  SudokuDragonFinder,
  type DragonMove,
  type Rule3Technique,
} from '../sudoku/SudokuDragonFinder'
import { SudokuLockedCandidateFinder } from '../sudoku/SudokuLockedCandidateFinder'
import { SudokuMedusaFinder, type ColoredCandidate, type MedusaChain } from '../sudoku/SudokuMedusaFinder'
import { SudokuPairFinder } from '../sudoku/SudokuPairFinder'
import { BOARD_SIZE, BOX_SIZE } from '../sudoku/SudokuRules'
import { SudokuUniqueRectangleFinder, type UniqueRectangleTypeName } from '../sudoku/SudokuUniqueRectangleFinder'
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
 * Turns a real puzzle position plus the app's own finders into a lesson: a
 * short list of frames, each one adding a single thing to the picture. The
 * colouring lessons are built from the same strong-link graph, chains and
 * Dragon move logs the Techniques panel uses, so what the tutorial shows is
 * what the solver actually does - nothing here is hand-drawn.
 *
 * Captions are deliberately one short sentence each.
 */

const colorFinder = new SudokuColorFinder()
const medusaFinder = new SudokuMedusaFinder()
const dragonFinder = new SudokuDragonFinder()
const lockedFinder = new SudokuLockedCandidateFinder()
const pairFinder = new SudokuPairFinder()
const urFinder = new SudokuUniqueRectangleFinder()
const bugFinder = new SudokuBugPlusOneFinder()
const oddagonFinder = new SudokuBivalueOddagonFinder()

// ---------------------------------------------------------------- helpers

type UnitKind = 'row' | 'column' | 'box'
interface Unit {
  kind: UnitKind
  index: number
  cells: TutorialCell[]
}

function cellName(row: number, col: number): string {
  return `r${row + 1}c${col + 1}`
}

function boxOf(row: number, col: number): number {
  return Math.floor(row / BOX_SIZE) * BOX_SIZE + Math.floor(col / BOX_SIZE)
}

function unitCells(kind: UnitKind, index: number): TutorialCell[] {
  const cells: TutorialCell[] = []
  for (let a = 0; a < BOARD_SIZE; a++) {
    if (kind === 'row') cells.push([index, a])
    else if (kind === 'column') cells.push([a, index])
    else cells.push([Math.floor(index / 3) * 3 + Math.floor(a / 3), (index % 3) * 3 + (a % 3)])
  }
  return cells
}

/** Every row/column/box that contains both cells, in row, column, box order. */
function sharedUnits(a: TutorialCell, b: TutorialCell): Unit[] {
  const units: Unit[] = []
  if (a[0] === b[0]) units.push({ kind: 'row', index: a[0], cells: unitCells('row', a[0]) })
  if (a[1] === b[1]) units.push({ kind: 'column', index: a[1], cells: unitCells('column', a[1]) })
  if (boxOf(a[0], a[1]) === boxOf(b[0], b[1])) {
    const index = boxOf(a[0], a[1])
    units.push({ kind: 'box', index, cells: unitCells('box', index) })
  }
  return units
}

function unitPhrase(unit: Unit): string {
  return `${unit.kind} ${unit.index + 1}`
}

/** The unit in which `digit` has exactly these two cells left - i.e. the
 * strong link between them - or null if there isn't one. */
function strongUnit(state: PuzzleState, digit: number, a: TutorialCell, b: TutorialCell): Unit | null {
  for (const unit of sharedUnits(a, b)) {
    const holders = unit.cells.filter(([r, c]) => state.board[r][c] === 0 && state.candidates[r][c][digit - 1])
    if (holders.length === 2) {
      return unit
    }
  }
  return null
}

function sees(a: TutorialCell, b: TutorialCell): boolean {
  return a[0] === b[0] || a[1] === b[1] || boxOf(a[0], a[1]) === boxOf(b[0], b[1])
}

function ref(row: number, col: number, digit: number): CandRef {
  return { row, col, digit }
}

const COLOUR_LONG: Record<TutorialColor, string> = {
  blue: 'light blue',
  yellow: 'yellow',
  darkBlue: 'dark blue',
  orange: 'orange',
}

/** Which of the two Medusa sides a colour belongs to (dark blue is light
 * blue's dragon colour, orange is yellow's). */
function primaryOf(color: TutorialColor): 'blue' | 'yellow' {
  return color === 'blue' || color === 'darkBlue' ? 'blue' : 'yellow'
}

// ------------------------------------------------------------ basics: singles

export function buildNakedSingleLesson(id: string, state: PuzzleState, cell: TutorialCell): TutorialLesson {
  const [row, col] = cell
  const digits = markedCandidateDigits(state.candidates[row][col])
  if (state.board[row][col] !== 0 || digits.length !== 1) {
    throw new Error(`${cellName(row, col)} is not a naked single in this example.`)
  }
  const digit = digits[0]
  const pip = ref(row, col, digit)
  return {
    id,
    title: 'Naked single',
    hint: 'A cell with one candidate left.',
    state,
    frames: [
      {
        badge: 'Spot it',
        caption: `${cellName(row, col)} has only one candidate left: ${digit}.`,
        outlineCells: [cell],
        solved: [pip],
        spotlight: { cells: [cell] },
      },
      {
        badge: 'Result',
        caption: `So ${cellName(row, col)} is ${digit}, and ${digit} leaves its row, column and box.`,
        solved: [pip],
        spotlight: { digits: [digit] },
        applied: true,
      },
    ],
  }
}

export function buildHiddenSingleLesson(
  id: string,
  state: PuzzleState,
  digit: number,
  unitKind: UnitKind,
  unitIndex: number,
): TutorialLesson {
  const unit: Unit = { kind: unitKind, index: unitIndex, cells: unitCells(unitKind, unitIndex) }
  const holders = unit.cells.filter(([r, c]) => state.board[r][c] === 0 && state.candidates[r][c][digit - 1])
  if (holders.length !== 1) {
    throw new Error(`${digit} is not a hidden single in ${unitPhrase(unit)} of this example.`)
  }
  const [row, col] = holders[0]
  const pip = ref(row, col, digit)
  return {
    id,
    title: 'Hidden single',
    hint: 'A digit with only one place left in a row, column or box.',
    state,
    frames: [
      {
        badge: 'Spot it',
        caption: `In ${unitPhrase(unit)}, ${digit} fits in only one cell.`,
        unitCells: unit.cells,
        solved: [pip],
        spotlight: { digits: [digit] },
      },
      {
        badge: 'Result',
        caption: `So ${cellName(row, col)} is ${digit}.`,
        unitCells: unit.cells,
        solved: [pip],
        spotlight: { digits: [digit] },
        applied: true,
      },
    ],
  }
}

// --------------------------------------------------- basics: locked candidates

export function buildLockedCandidatesLesson(id: string, state: PuzzleState, digit: number): TutorialLesson {
  const instance = [
    ...lockedFinder.findPointingInstances(state.board, state.candidates),
    ...lockedFinder.findClaimingInstances(state.board, state.candidates),
  ].find((candidate) => candidate.digit === digit)
  if (!instance) {
    throw new Error(`No locked ${digit} in this example.`)
  }

  const basis = instance.basisCells.map(([r, c]) => ref(r, c, digit))
  const eliminated = instance.eliminations.map((e) => ref(e.row, e.col, e.digit))
  const pointing = instance.type === 'pointing'
  const [first] = instance.basisCells
  const sameRow = instance.basisCells.every(([r]) => r === first[0])
  const lineKind: UnitKind = sameRow ? 'row' : 'column'
  const line: Unit = {
    kind: lineKind,
    index: sameRow ? first[0] : first[1],
    cells: unitCells(lineKind, sameRow ? first[0] : first[1]),
  }
  const box: Unit = { kind: 'box', index: boxOf(first[0], first[1]), cells: unitCells('box', boxOf(first[0], first[1])) }

  // Pointing: the digit is trapped in one line *of a box*, so it clears the
  // rest of that line. Claiming: trapped in one box *of a line*, so it
  // clears the rest of that box.
  const tint = pointing ? box.cells : line.cells
  const pattern = pointing
    ? `In ${unitPhrase(box)}, every ${digit} is in ${unitPhrase(line)}.`
    : `In ${unitPhrase(line)}, every ${digit} is in ${unitPhrase(box)}.`
  const result = pointing
    ? `The ${digit} of ${unitPhrase(box)} must be in ${unitPhrase(line)}, so the rest of it loses ${digit}.`
    : `The ${digit} of ${unitPhrase(line)} must be in ${unitPhrase(box)}, so the rest of it loses ${digit}.`

  return {
    id,
    title: 'Locked candidates',
    hint: 'A digit trapped in the overlap of a box and a line.',
    state,
    frames: [
      {
        badge: 'Spot it',
        caption: pattern,
        unitCells: tint,
        basis,
        eliminated,
        spotlight: { digits: [digit] },
      },
      {
        badge: 'Result',
        caption: result,
        unitCells: tint,
        basis,
        eliminated,
        spotlight: { digits: [digit] },
        applied: true,
      },
    ],
  }
}

// --------------------------------------------------------- basics: locked sets

export function buildNakedPairLesson(id: string, state: PuzzleState, a: TutorialCell, b: TutorialCell): TutorialLesson {
  const instance = pairFinder
    .findNakedPairs(state.board, state.candidates)
    .find(
      (pair) =>
        (pair.cells[0][0] === a[0] && pair.cells[0][1] === a[1] && pair.cells[1][0] === b[0] && pair.cells[1][1] === b[1]) ||
        (pair.cells[0][0] === b[0] && pair.cells[0][1] === b[1] && pair.cells[1][0] === a[0] && pair.cells[1][1] === a[1]),
    )
  if (!instance) {
    throw new Error(`No naked pair at ${cellName(a[0], a[1])}/${cellName(b[0], b[1])} in this example.`)
  }
  const [d1, d2] = instance.digits
  const basis = instance.cells.flatMap(([r, c]) => [ref(r, c, d1), ref(r, c, d2)])
  const eliminated = instance.eliminations.map((e) => ref(e.row, e.col, e.digit))
  const tint = sharedUnits(instance.cells[0], instance.cells[1]).flatMap((unit) => unit.cells)
  const shared = sharedUnits(instance.cells[0], instance.cells[1])
  const where = shared.length > 0 ? unitPhrase(shared[shared.length - 1]) : 'that unit'

  return {
    id,
    title: 'Locked set: naked pair',
    hint: 'Two cells that can only hold the same two digits.',
    state,
    frames: [
      {
        badge: 'Spot it',
        caption: `${cellName(...instance.cells[0])} and ${cellName(...instance.cells[1])} can only be ${d1} or ${d2}.`,
        outlineCells: [...instance.cells],
        unitCells: tint,
        basis,
        eliminated,
        spotlight: { digits: [d1, d2] },
      },
      {
        badge: 'Result',
        caption: `${d1} and ${d2} are used up by this pair, so the rest of ${where} loses them.`,
        outlineCells: [...instance.cells],
        unitCells: tint,
        basis,
        eliminated,
        spotlight: { digits: [d1, d2] },
        applied: true,
      },
    ],
  }
}

// --------------------------------------------------------- simple colouring

interface SimpleColouringOptions {
  id: string
  title: string
  hint?: string
  state: PuzzleState
  digit: number
  /** 'eliminate': a cell that sees both colours. 'solve': two cells of one
   * colour that see each other. */
  outcome: 'eliminate' | 'solve'
}

export function buildSimpleColouringLesson(options: SimpleColouringOptions): TutorialLesson {
  const { id, title, hint, state, digit, outcome } = options
  const { board, candidates } = state
  const chain = colorFinder
    .findChains(board, candidates, digit)
    .find((c) => (outcome === 'solve' ? colorFinder.findRule1(c) : colorFinder.findRule2(c, board, candidates)))
  if (!chain) {
    throw new Error(`No simple colouring of ${digit} with that outcome in this example.`)
  }

  const cells = chain.cells // already in the order the colouring spreads
  const at = (i: number): TutorialCell => [cells[i].row, cells[i].col]
  const pipOf = (i: number) => ref(cells[i].row, cells[i].col, digit)

  // Which earlier cell each cell was coloured from, and through which unit.
  const parent: number[] = cells.map((_, i) => {
    for (let j = 0; j < i; j++) {
      if (strongUnit(state, digit, at(j), at(i))) return j
    }
    return -1
  })

  const allPairs: TutorialLink[] = []
  for (let i = 0; i < cells.length; i++) {
    for (let j = i + 1; j < cells.length; j++) {
      if (strongUnit(state, digit, at(i), at(j))) {
        allPairs.push({ from: pipOf(i), to: pipOf(j), kind: 'strong' })
      }
    }
  }

  const frames: TutorialFrame[] = []
  frames.push({
    badge: 'Look',
    caption: `Each red line connects the only two cells left for ${digit} in a row, column or box: this means, for each line, one of its 7's must be true.`,
    links: allPairs,
    spotlight: { digits: [digit] },
  })

  const colouredUpTo = (n: number): ColouredCand[] =>
    cells.slice(0, n + 1).map((c) => ({ ...ref(c.row, c.col, digit), color: c.color }))
  const arrowsUpTo = (n: number): TutorialLink[] => {
    const links: TutorialLink[] = []
    for (let i = 1; i <= n; i++) {
      if (parent[i] >= 0) links.push({ from: pipOf(parent[i]), to: pipOf(i), kind: 'strong', arrow: true })
    }
    return links
  }

  cells.forEach((cell, i) => {
    let caption: string
    if (i === 0) {
      caption = `Pick one and colour it ${cell.color}. Exactly one colour is true.`
    } else {
      const unit = strongUnit(state, digit, at(parent[i]), at(i))!
      caption = `It's the only other ${digit} in ${unitPhrase(unit)}, so ${cellName(cell.row, cell.col)} gets the opposite colour: ${cell.color}.`
    }
    frames.push({
      badge: 'Colour',
      caption,
      coloured: colouredUpTo(i),
      fresh: [pipOf(i)],
      links: arrowsUpTo(i),
      spotlight: { digits: [digit] },
    })
  })

  const coloured = colouredUpTo(cells.length - 1)
  const arrows = arrowsUpTo(cells.length - 1)

  if (outcome === 'eliminate') {
    const rule2 = colorFinder.findRule2(chain, board, candidates)!
    const eliminated = rule2.eliminatedCells.map(([r, c]) => ref(r, c, digit))
    const [er, ec] = rule2.eliminatedCells[0]
    const blue = cells.findIndex((c) => c.color === 'blue' && sees([er, ec], [c.row, c.col]))
    const yellow = cells.findIndex((c) => c.color === 'yellow' && sees([er, ec], [c.row, c.col]))
    frames.push({
      badge: 'Result',
      caption: `${cellName(er, ec)} sees a blue ${digit} and a yellow ${digit}. One of them is true, so ${cellName(er, ec)} can't be ${digit}.`,
      coloured,
      links: [
        ...arrows,
        { from: ref(er, ec, digit), to: pipOf(blue), kind: 'sees' },
        { from: ref(er, ec, digit), to: pipOf(yellow), kind: 'sees' },
      ],
      eliminated,
      spotlight: { digits: [digit] },
    })
  } else {
    const rule1 = colorFinder.findRule1(chain)!
    const falseCells = cells.map((c, i) => ({ c, i })).filter(({ c }) => c.color === rule1.falseColor)
    let clash: [number, number] = [falseCells[0].i, falseCells[1].i]
    for (const x of falseCells) {
      for (const y of falseCells) {
        if (x.i < y.i && sees(at(x.i), at(y.i))) clash = [x.i, y.i]
      }
    }
    frames.push({
      badge: 'Clash',
      caption: `Two ${rule1.falseColor} ${digit}s see each other. They can't both be true, so ${rule1.falseColor} is false.`,
      coloured,
      links: [...arrows, { from: pipOf(clash[0]), to: pipOf(clash[1]), kind: 'sees' }],
      spotlight: { digits: [digit] },
    })
    frames.push({
      badge: 'Result',
      caption: `So ${rule1.trueColor} is true: every ${rule1.trueColor} ${digit} is a solution.`,
      coloured,
      links: arrows,
      solved: cells.filter((c) => c.color === rule1.trueColor).map((c) => ref(c.row, c.col, digit)),
      eliminated: cells.filter((c) => c.color === rule1.falseColor).map((c) => ref(c.row, c.col, digit)),
      spotlight: { digits: [digit] },
    })
  }

  return { id, title, hint, state, frames }
}

// ------------------------------------------------------------------ medusa

interface MedusaOptions {
  id: string
  title: string
  hint?: string
  state: PuzzleState
  /** Any candidate of the chain to build; the colouring is grown from it. */
  seed: CandRef
}

function candidateKey(ref: CandRef): string {
  return `${ref.row},${ref.col},${ref.digit}`
}

export function buildMedusaLesson(options: MedusaOptions): TutorialLesson {
  const { id, title, hint, state, seed } = options
  const { board, candidates } = state
  const chain = medusaFinder
    .findChains(board, candidates)
    .find((c) => c.candidates.some((n) => candidateKey(n) === candidateKey(seed)))
  if (!chain) {
    throw new Error('The seed candidate is not part of a 3D Medusa in this example.')
  }

  const colourByKey = new Map<string, 'blue' | 'yellow'>(chain.candidates.map((n) => [candidateKey(n), n.color]))
  const graph = medusaFinder.buildStrongLinkGraph(board, candidates)

  // Spread out from the seed, one candidate at a time, remembering which
  // already-coloured candidate each new one was reached from.
  interface Step {
    node: ColoredCandidate
    parent: ColoredCandidate | null
    bivalue: boolean
  }
  const steps: Step[] = []
  const start = chain.candidates.find((n) => candidateKey(n) === candidateKey(seed))!
  const seen = new Set<string>([candidateKey(start)])
  const queue: ColoredCandidate[] = [start]
  steps.push({ node: start, parent: null, bivalue: false })
  while (queue.length > 0) {
    const current = queue.shift()!
    const currentKey = candidateKey(current)
    for (const neighbourKey of graph.adjacency.get(currentKey) ?? []) {
      if (seen.has(neighbourKey) || !colourByKey.has(neighbourKey)) continue
      seen.add(neighbourKey)
      const found = graph.nodeByKey.get(neighbourKey)!
      const node: ColoredCandidate = { ...found, color: colourByKey.get(neighbourKey)! }
      const edgeKey = currentKey < neighbourKey ? `${currentKey}|${neighbourKey}` : `${neighbourKey}|${currentKey}`
      steps.push({ node, parent: current, bivalue: graph.bivalueEdgeKeys.has(edgeKey) })
      queue.push(node)
    }
  }

  const frames: TutorialFrame[] = []
  frames.push({
    badge: 'Look',
    caption: 'Medusa colours across every digit: two candidates in a cell are linked, and so are two spots for a digit.',
    ...bivalueAndPairHints(chain),
  })

  const colouredUpTo = (n: number): ColouredCand[] =>
    steps.slice(0, n + 1).map(({ node }) => ({ row: node.row, col: node.col, digit: node.digit, color: node.color }))
  const arrowsUpTo = (n: number): TutorialLink[] =>
    steps
      .slice(1, n + 1)
      .map(({ node, parent }) => ({ from: ref(parent!.row, parent!.col, parent!.digit), to: ref(node.row, node.col, node.digit), kind: 'strong' as const, arrow: true }))

  steps.forEach(({ node, parent, bivalue }, i) => {
    let caption: string
    if (!parent) {
      caption = `Start with ${node.digit} in ${cellName(node.row, node.col)}: colour it ${node.color}.`
    } else if (bivalue) {
      caption = `${cellName(node.row, node.col)} has just two candidates: ${parent.digit} is ${parent.color}, so ${node.digit} is ${node.color}.`
    } else {
      const unit = strongUnit(state, node.digit, [parent.row, parent.col], [node.row, node.col])
      caption = `The only other ${node.digit} in ${unit ? unitPhrase(unit) : 'that unit'} is ${cellName(node.row, node.col)}: ${node.color}.`
    }
    frames.push({
      badge: bivalue ? 'Cell link' : 'Digit link',
      caption,
      coloured: colouredUpTo(i),
      fresh: [ref(node.row, node.col, node.digit)],
      links: arrowsUpTo(i),
    })
  })

  frames.push(...medusaConclusionFrames(chain, state, colouredUpTo(steps.length - 1), arrowsUpTo(steps.length - 1)))
  return { id, title, hint, state, frames }
}

/** Nothing to draw before the colouring starts except which cells the
 * colouring will use - kept as a hook so the first frame can show them. */
function bivalueAndPairHints(chain: MedusaChain): Partial<TutorialFrame> {
  return { outlineCells: [], spotlight: { cells: dedupeCells(chain.candidates.map((n) => [n.row, n.col] as const)) } }
}

function dedupeCells(cells: TutorialCell[]): TutorialCell[] {
  const seen = new Set<string>()
  return cells.filter(([r, c]) => (seen.has(`${r},${c}`) ? false : (seen.add(`${r},${c}`), true)))
}

function medusaConclusionFrames(
  chain: MedusaChain,
  state: PuzzleState,
  coloured: ColouredCand[],
  arrows: TutorialLink[],
): TutorialFrame[] {
  const { board, candidates } = state
  const nodeOf = (r: number, c: number, d: number) => ref(r, c, d)
  const mass = medusaFinder.findMassElimination(chain, board, candidates)

  if (mass) {
    const falseColor = mass.falseColor
    const trueColor = mass.trueColor
    let clashLink: TutorialLink[] = []
    let caption: string
    const conflict = mass.conflict
    if (conflict.kind === 'cell') {
      caption = `${cellName(conflict.row, conflict.col)} would hold both ${conflict.digitA} and ${conflict.digitB}, both ${conflict.color}. ${conflict.color} can't be true.`
      clashLink = [{ from: nodeOf(conflict.row, conflict.col, conflict.digitA), to: nodeOf(conflict.row, conflict.col, conflict.digitB), kind: 'sees' }]
    } else if (conflict.kind === 'unit') {
      caption = `Two ${conflict.color} ${conflict.digit}s see each other. ${conflict.color} can't be true.`
      clashLink = [{ from: nodeOf(conflict.a[0], conflict.a[1], conflict.digit), to: nodeOf(conflict.b[0], conflict.b[1], conflict.digit), kind: 'sees' }]
    } else {
      caption = `${cellName(conflict.row, conflict.col)} is uncoloured, but all its candidates see ${conflict.color}. If ${conflict.color} were true it would be empty.`
      clashLink = conflict.digits.flatMap((digit) => {
        const other = chain.candidates.find(
          (n) => n.color === conflict.color && n.digit === digit && sees([n.row, n.col], [conflict.row, conflict.col]),
        )
        return other ? [{ from: nodeOf(conflict.row, conflict.col, digit), to: nodeOf(other.row, other.col, digit), kind: 'sees' as const }] : []
      })
    }
    return [
      { badge: 'Clash', caption, coloured, links: [...arrows, ...clashLink] },
      {
        badge: 'Result',
        caption: `So ${trueColor} is true: it solves its cells, and every ${falseColor} candidate goes.`,
        coloured,
        links: arrows,
        solved: mass.solvedCells.map((n) => ref(n.row, n.col, n.digit)),
        eliminated: mass.eliminatedCandidates.map((n) => ref(n.row, n.col, n.digit)),
      },
    ]
  }

  const rule3 = medusaFinder.findRule3Eliminations(chain, board, candidates)[0]
  if (rule3) {
    return [
      {
        badge: 'Result',
        caption: `${cellName(rule3.row, rule3.col)} sees a blue ${rule3.digit} and a yellow ${rule3.digit}, so it can't be ${rule3.digit}.`,
        coloured,
        links: [
          ...arrows,
          { from: ref(rule3.row, rule3.col, rule3.digit), to: ref(rule3.blueSeen[0], rule3.blueSeen[1], rule3.digit), kind: 'sees' },
          { from: ref(rule3.row, rule3.col, rule3.digit), to: ref(rule3.yellowSeen[0], rule3.yellowSeen[1], rule3.digit), kind: 'sees' },
        ],
        eliminated: [ref(rule3.row, rule3.col, rule3.digit)],
      },
    ]
  }
  const rule4 = medusaFinder.findRule4Eliminations(chain, candidates)[0]
  if (rule4) {
    return [
      {
        badge: 'Result',
        caption: `${cellName(rule4.row, rule4.col)} holds both colours, so one of them must be true, so the uncoloured candidates are eliminated.`,
        coloured,
        links: arrows,
        outlineCells: [[rule4.row, rule4.col]],
        eliminated: rule4.eliminatedDigits.map((d) => ref(rule4.row, rule4.col, d)),
      },
    ]
  }
  const rule5 = medusaFinder.findRule5Eliminations(chain, candidates)[0]
  if (rule5) {
    return [
      {
        badge: 'Result',
        caption: `${cellName(rule5.row, rule5.col)} holds a ${rule5.coloredColor} candidate, and its ${rule5.eliminatedDigit} sees an opposite-colour ${rule5.eliminatedDigit}: it can't be ${rule5.eliminatedDigit}.`,
        coloured,
        links: [
          ...arrows,
          { from: ref(rule5.row, rule5.col, rule5.eliminatedDigit), to: ref(rule5.opponent[0], rule5.opponent[1], rule5.eliminatedDigit), kind: 'sees' },
        ],
        eliminated: [ref(rule5.row, rule5.col, rule5.eliminatedDigit)],
      },
    ]
  }
  throw new Error('This 3D Medusa has no elimination to show.')
}

// ------------------------------------------------------------------ dragon

interface DragonOptions {
  id: string
  title: string
  hint?: string
  state: PuzzleState
  /** Any candidate of the Medusa the Dragon starts from. */
  seed: CandRef
  dynamic?: boolean
  exhaustive?: boolean
  allowedTechniques?: ReadonlySet<Rule3Technique>
}

const TECHNIQUE_PHRASE: Record<string, string> = {
  'locked candidate': 'a locked candidate',
  'naked pair': 'a naked pair',
  'naked triple': 'a naked triple',
  'naked quad': 'a naked quad',
  'hidden pair': 'a hidden pair',
  'x-wing': 'an X-Wing',
  'finned x-wing': 'a Finned X-Wing',
  swordfish: 'a Swordfish',
  'finned swordfish': 'a Finned Swordfish',
  UR: 'a Unique Rectangle',
  'bivalue oddagon': 'a Bivalue Oddagon',
  'BUG+1': 'a BUG+1',
  'short single-digit aic': 'a single-digit AIC',
  'short aic': 'a short AIC',
  'generic aic': 'a generic AIC',
  'als-xz': 'an ALS-xz',
}

function joinPhrases(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/** The finder's sentences are precise but wordy. Each of these keeps every
 * fact in one and says it in fewer words; anything that doesn't match falls
 * back to the finder's own text, so a reworded finder degrades gracefully. */
function shortenExtension(text: string): string {
  let m = /^Assuming (.+) is true: (r\dc\d) would be the only remaining (\d) in its (row|column|box), so colour it (.+)\.$/.exec(text)
  if (m) return `If ${m[1]} is true, ${m[2]} is the last place for ${m[3]} in its ${m[4]}: ${m[5]}.`
  m = /^Assuming (.+) is true eliminates every other candidate from (r\dc\d), leaving only (\d) - colour it (.+)\.$/.exec(text)
  if (m) return `If ${m[1]} is true, ${m[2]} has only ${m[3]} left: ${m[4]}.`
  m = /^Assuming (.+) is true, then we have a hidden single at (r\dc\d), since (\d) has nowhere else to go in its (row|column|box), so colour it (.+)\.$/.exec(text)
  if (m) return `If ${m[1]} is true, ${m[2]} is the only place left for ${m[3]} in its ${m[4]}: ${m[5]}.`
  return text.replace(/^Assuming /, 'If ')
}

/** Which Medusa colour a dragon or medusa colour name belongs to. */
function sideNamed(label: string): string {
  return label === 'light blue' || label === 'dark blue' ? 'light blue' : 'yellow'
}

function shortenMassReason(description: string): string {
  let m = /^In (r\dc\d), (\d) \(([a-z ]+)\) and (\d) \(([a-z ]+)\) are colours belonging to the same Medusa color/.exec(description)
  if (m) return `If ${sideNamed(m[3])} were true, ${m[1]} would be both ${m[2]} and ${m[4]}: impossible, so ${sideNamed(m[3])} is false.`
  m = /^(\d) in (r\dc\d) \(([a-z ]+)\) and (r\dc\d) \(([a-z ]+)\) are colours belonging to the same Medusa color/.exec(description)
  if (m) return `If ${sideNamed(m[3])} were true, ${m[2]} and ${m[4]} would both be ${m[1]}: impossible, so ${sideNamed(m[3])} is false.`
  m = /^(r\dc\d) has no coloured candidates, but .* all see the (light blue|yellow) side/.exec(description)
  if (m) {
    const side = m[2]
    return `If ${side} were true, ${m[1]} would have no candidates left: impossible, so ${side} is false.`
  }
  return description
}

function dragonCaption(move: DragonMove): { badge: string; caption: string } {
  const first = move.colored[0]
  switch (move.kind) {
    case 'medusa':
      return { badge: 'Medusa', caption: 'First, colour the 3D Medusa. It is stuck: nothing can be eliminated yet.' }
    case 'extension-rule1':
    case 'extension-rule2':
    case 'extension-hidden-single':
      return { badge: 'Extend', caption: shortenExtension(move.description) }
    case 'extension-rule3': {
      const techniques = joinPhrases((move.dynamicTechniques ?? []).map((t) => TECHNIQUE_PHRASE[t] ?? t))
      const side = first ? COLOUR_LONG[primaryOf(first.color)] : ''
      return techniques && first
        ? {
            badge: 'Dynamic',
            caption: `If ${side} is true, ${techniques} appears and forces ${first.digit} in ${cellName(first.row, first.col)}: ${COLOUR_LONG[first.color]}.`,
          }
        : { badge: 'Dynamic', caption: shortenExtension(move.description) }
    }
    case 'promotion':
      return {
        badge: 'Promote',
        caption: 'Opposite colours meet, so both are now certain: they become full Medusa colours.',
      }
    case 'medusa-growth':
      return { badge: 'Grow', caption: 'The promoted colours are certain, so their strong links add more Medusa colours.' }
    case 'rule3': {
      const e = move.eliminated[0]
      return { badge: 'Result', caption: `${cellName(e.row, e.col)} sees ${e.digit} in both colours, so it can't be ${e.digit}.` }
    }
    case 'rule4': {
      const e = move.eliminated[0]
      return { badge: 'Result', caption: `${cellName(e.row, e.col)} holds both colours, so the uncoloured candidates are eliminated..` }
    }
    case 'rule5': {
      const e = move.eliminated[0]
      return { badge: 'Result', caption: `${cellName(e.row, e.col)} can't be ${e.digit}: it sees an opposite-colour ${e.digit}.` }
    }
    case 'mass-elimination':
      return { badge: 'Result', caption: shortenMassReason(move.description) }
    case 'solution':
      return { badge: 'Solved', caption: 'The colouring covers every empty cell: it is the solution.' }
  }
}

export function buildDragonLesson(options: DragonOptions): TutorialLesson {
  const { id, title, hint, state, seed, dynamic = false, exhaustive = false, allowedTechniques } = options
  const { board, candidates } = state
  const chain = medusaFinder
    .findChains(board, candidates)
    .find((c) => c.candidates.some((n) => candidateKey(n) === candidateKey(seed)))
  if (!chain) {
    throw new Error('The seed candidate is not part of a 3D Medusa in this example.')
  }
  const result = dragonFinder.extend(chain, board, candidates, { dynamic, exhaustive, allowedRule3Techniques: allowedTechniques })
  if (!result) {
    throw new Error('Dragon Colouring finds nothing for this Medusa in this example.')
  }

  const isEliminationRule = (move: DragonMove) => move.kind === 'rule3' || move.kind === 'rule4' || move.kind === 'rule5'

  // The finder reports a closing run of eliminations (Rules 3, 4 and 5) as
  // one move each, all found from the same finished colouring. Shown one by
  // one that's several identical-looking steps, so the run is folded into a
  // single "Result" frame: the first elimination explained, plus the total.
  const frames: TutorialFrame[] = []
  for (let index = 0; index < result.moves.length; index++) {
    const move = result.moves[index]
    let last = index
    if (isEliminationRule(move)) {
      while (last + 1 < result.moves.length && isEliminationRule(result.moves[last + 1])) last++
    }
    frames.push(dragonFrame(result.moves, index, last))
    index = last
  }

  return { id, title, hint, state, frames }
}

/** The picture after `moves[..lastIndex]`; `index..lastIndex` is the run of
 * moves this one frame stands for (usually just one). */
function dragonFrame(moves: DragonMove[], index: number, lastIndex: number): TutorialFrame {
  const move = moves[index]
  const fold = foldDragonMoves(moves, lastIndex)
  const coloured: ColouredCand[] = [
    ...fold.blueCandidates.map((c) => ({ ...c, color: 'blue' as const })),
    ...fold.yellowCandidates.map((c) => ({ ...c, color: 'yellow' as const })),
    ...fold.darkBlueCandidates.map((c) => ({ ...c, color: 'darkBlue' as const })),
    ...fold.orangeCandidates.map((c) => ({ ...c, color: 'orange' as const })),
  ]
  const { badge, caption: firstCaption } = dragonCaption(move)
  const isResult = move.eliminated.length > 0 || move.solved.length > 0
  const total = new Set(fold.eliminatedCandidates.map((c) => `${c.row},${c.col},${c.digit}`)).size
  const caption =
    lastIndex > index && total > move.eliminated.length
      ? `${firstCaption} ${total} candidates go in all.`
      : firstCaption
  return {
    badge,
    caption,
    coloured,
    // The seed Medusa appears all at once; every later step adds candidates
    // one at a time, and those are the ones worth ringing.
    fresh: index === 0 ? [] : move.colored.map((c) => ref(c.row, c.col, c.digit)),
    eliminated: isResult ? fold.eliminatedCandidates : undefined,
    solved: isResult ? fold.solvedCandidates : undefined,
    greenCells: move.dynamicTechniqueCells ? [...move.dynamicTechniqueCells] : undefined,
    links: move.aicChains?.flatMap((aic) => aic.links.map((link) => ({ from: link.from, to: link.to, kind: 'strong' as const }))),
  }
}

// ------------------------------------------------------- abusing uniqueness

function sameCell(a: TutorialCell, b: TutorialCell): boolean {
  return a[0] === b[0] && a[1] === b[1]
}

function cellList(cells: readonly TutorialCell[]): string {
  return joinPhrases(cells.map(([r, c]) => cellName(r, c)))
}

/** The row/column/box a solved-digit count or strong link lives in, named
 * the way every other lesson names units. */
function unitContaining(kind: UnitKind, cell: TutorialCell): Unit {
  const index = kind === 'row' ? cell[0] : kind === 'column' ? cell[1] : boxOf(cell[0], cell[1])
  return { kind, index, cells: unitCells(kind, index) }
}

interface UniqueRectangleOptions {
  id: string
  title: string
  hint?: string
  state: PuzzleState
  type: UniqueRectangleTypeName
  /** Any corner of the rectangle to teach, in case the position has more. */
  corner: TutorialCell
}

/** One "digit is locked to these two cells" fact a UR type rests on. */
interface UrLink {
  digit: number
  from: TutorialCell
  to: TutorialCell
}

/** "Suppose the eliminated candidate were true" and what that forces, one
 * corner at a time, until all four corners are the pair (the deadly pattern). */
interface UrStep {
  cell: TutorialCell
  digit: number
  because: string
}

/**
 * Every Unique Rectangle type told the same way: the rectangle, why "all four
 * corners are just the pair" can't happen (it would have two solutions), then
 * the type's own reason. Types 7a-7d are shown as "suppose the eliminated
 * candidate were true": each forced corner follows, one frame at a time, until
 * the rectangle is the deadly pattern - which is why that candidate goes.
 *
 * The facts come from the finder's own instance (cells, reason cells, the
 * elimination); only the order they're told in is worked out here.
 */
export function buildUniqueRectangleLesson(options: UniqueRectangleOptions): TutorialLesson {
  const { id, title, hint, state, type, corner } = options
  const { board, candidates } = state
  const instance = urFinder
    .find(board, candidates, { mergeTypes: false })
    .find(
      (candidate) =>
        candidate.type.replace(' aka Hidden Rectangle', '') === type && candidate.cells.some((cell) => sameCell(cell, corner)),
    )
  if (!instance) {
    throw new Error(`No Unique Rectangle ${type} at ${cellName(corner[0], corner[1])} in this example.`)
  }

  const [a, b] = instance.urDigits
  const cells = instance.cells.map(([r, c]) => [r, c] as const)
  const digitsOf = ([r, c]: TutorialCell) => markedCandidateDigits(candidates[r][c])
  const bivalue = cells.filter((cell) => digitsOf(cell).length === 2)
  const pairPips = cells.flatMap(([r, c]) => [ref(r, c, a), ref(r, c, b)])
  // a on one diagonal, b on the other - the order `cells` comes in is
  // (r1,c1), (r1,c2), (r2,c1), (r2,c2), so 0/3 and 1/2 are the diagonals.
  const colourOf = (digit: number): TutorialColor => (digit === a ? 'blue' : 'yellow')
  const deadly: ColouredCand[] = cells.map(([r, c], i) => {
    const digit = i === 0 || i === 3 ? a : b
    return { ...ref(r, c, digit), color: colourOf(digit) }
  })
  const extraDigits = [...new Set(cells.flatMap((cell) => digitsOf(cell).filter((d) => d !== a && d !== b)))]
  const spotlight = { digits: [a, b, ...extraDigits] }

  const frames: TutorialFrame[] = [
    {
      badge: 'Look',
      caption:
        `${cellList(cells)} span 2 rows, 2 columns and 2 boxes, and all four can be ${a} or ${b}` +
        (bivalue.length > 0 && bivalue.length < 4 ? `; ${cellList(bivalue)} ${bivalue.length === 1 ? 'holds' : 'hold'} nothing else.` : '.'),
      outlineCells: cells,
      basis: pairPips,
      spotlight,
    },
    {
      badge: 'Deadly',
      caption: `If all four ended up as just ${a} and ${b}, the two could swap diagonally: two solutions. A proper puzzle has exactly one, so this can never happen.`,
      outlineCells: cells,
      coloured: deadly,
      spotlight,
    },
  ]

  const eliminated = instance.eliminatedCandidates.map((e) => ref(e.row, e.col, e.digit))
  const solved = instance.solvedCandidates.map((s) => ref(s.row, s.col, s.digit))

  if (type === 'Type 1') {
    const [extraCell] = instance.reasonCells
    const extras = digitsOf(extraCell).filter((d) => d !== a && d !== b)
    const name = cellName(extraCell[0], extraCell[1])
    const pairAtExtra = [ref(extraCell[0], extraCell[1], a), ref(extraCell[0], extraCell[1], b)]
    frames.push(
      {
        badge: 'Spot it',
        caption: `${name} is the only corner with anything else (${joinPhrases(extras.map(String))}). If it were ${a} or ${b}, all four corners would be just ${a} and ${b}.`,
        outlineCells: cells,
        basis: pairPips,
        eliminated: pairAtExtra,
        spotlight,
      },
      solved.length > 0
        ? { badge: 'Result', caption: `So ${name} must be ${solved[0].digit}.`, outlineCells: cells, solved, spotlight, applied: true }
        : { badge: 'Result', caption: `So ${name} can't be ${a} or ${b}.`, outlineCells: cells, eliminated, spotlight, applied: true },
    )
    return { id, title, hint, state, frames }
  }

  if (type === 'Type 2' || type === 'Type 5') {
    const extraCells = instance.reasonCells
    const z = instance.eliminatedCandidates[0].digit
    const zPips = extraCells.map(([r, c]) => ref(r, c, z))
    const targets = [...new Map(instance.eliminatedCandidates.map((e) => [`${e.row}.${e.col}`, [e.row, e.col] as TutorialCell])).values()]
    const seeLinks: TutorialLink[] = eliminated.flatMap((from) => zPips.map((to) => ({ from, to, kind: 'sees' as const })))
    const all = extraCells.length === 2 ? 'both' : 'all three'
    frames.push(
      {
        badge: 'Spot it',
        caption: `Only ${cellList(extraCells)} hold anything besides ${a} and ${b}, and in each it's just ${z}. If none of them were ${z}, all four corners would be just ${a} and ${b}, so at least one of them is ${z}.`,
        outlineCells: cells,
        basis: zPips,
        spotlight,
      },
      {
        badge: 'Sees',
        caption: `${cellList(targets)} ${targets.length === 1 ? 'sees' : 'see'} ${all}, so wherever that ${z} lands, ${targets.length === 1 ? 'it' : 'they'} can't be ${z}.`,
        outlineCells: cells,
        basis: zPips,
        links: seeLinks,
        eliminated,
        spotlight,
      },
      {
        badge: 'Result',
        caption: `So ${cellList(targets)} can't be ${z}.`,
        outlineCells: cells,
        eliminated,
        spotlight,
        applied: true,
      },
    )
    return { id, title, hint, state, frames }
  }

  if (type === 'Type 3') {
    const [x, y] = instance.reasonCells
    const subsetCells = (instance.subsetCells ?? []).map(([r, c]) => [r, c] as const)
    const extras = [...new Set([x, y].flatMap((cell) => digitsOf(cell).filter((d) => d !== a && d !== b)))].sort((p, q) => p - q)
    const subsetDigits = [...new Set([...extras, ...subsetCells.flatMap(digitsOf)])].sort((p, q) => p - q)
    const extraPips = [x, y].flatMap(([r, c]) => extras.filter((d) => candidates[r][c][d - 1]).map((d) => ref(r, c, d)))
    const subsetPips = subsetCells.flatMap(([r, c]) => digitsOf([r, c]).map((d) => ref(r, c, d)))
    // Every house the whole subset lies in (a row subset may sit in one box too).
    const houses = sharedUnits(x, y).filter((unit) => subsetCells.every((cell) => unit.cells.some((u) => sameCell(u, cell))))
    const housePhrase = joinPhrases(houses.map(unitPhrase))
    const pairNames = `${cellName(x[0], x[1])} and ${cellName(y[0], y[1])}`
    const subsetSpotlight = { digits: [a, b, ...subsetDigits] }
    frames.push(
      {
        badge: 'Merge',
        caption: `Only ${pairNames} hold anything besides ${a} and ${b}. They can't both be ${a} or ${b} (that's the deadly pattern), so one of them is ${extras.slice(0, -1).join(', ')} or ${extras[extras.length - 1]}: treat the two as one cell holding just {${extras.join(',')}}.`,
        outlineCells: cells,
        basis: extraPips,
        spotlight: subsetSpotlight,
      },
      {
        badge: 'Subset',
        caption: `In ${housePhrase}, that merged cell plus ${cellList(subsetCells)} make ${subsetCells.length + 1} cells holding only the ${subsetDigits.length} digits ${subsetDigits.join(', ')}: a naked subset, so those digits all go in these cells.`,
        outlineCells: cells,
        greenCells: [x, y, ...subsetCells],
        unitCells: houses.flatMap((unit) => unit.cells),
        basis: [...extraPips, ...subsetPips],
        spotlight: subsetSpotlight,
      },
      {
        badge: 'Why',
        caption: `So none of ${subsetDigits.join(', ')} can go anywhere else in ${housePhrase}.`,
        outlineCells: cells,
        greenCells: [x, y, ...subsetCells],
        unitCells: houses.flatMap((unit) => unit.cells),
        basis: [...extraPips, ...subsetPips],
        eliminated,
        spotlight: subsetSpotlight,
      },
      {
        badge: 'Result',
        caption: `So ${joinPhrases(instance.eliminatedCandidates.map((e) => `${cellName(e.row, e.col)} can't be ${e.digit}`))}.`,
        outlineCells: cells,
        eliminated,
        spotlight: subsetSpotlight,
        applied: true,
      },
    )
    return { id, title, hint, state, frames }
  }

  if (type === 'Type 4') {
    const [x, y] = instance.reasonCells
    const e = instance.eliminatedCandidates[0].digit
    const d = e === a ? b : a
    const unit = strongUnit(state, d, x, y)
    const link: TutorialLink = { from: ref(x[0], x[1], d), to: ref(y[0], y[1], d), kind: 'strong' }
    const names = `${cellName(x[0], x[1])} and ${cellName(y[0], y[1])}`
    frames.push(
      {
        badge: 'Link',
        caption: `In ${unit ? unitPhrase(unit) : 'their shared unit'}, ${d} fits only in ${names}, so one of them is ${d}.`,
        outlineCells: cells,
        unitCells: unit?.cells,
        links: [link],
        spotlight,
      },
      {
        badge: 'Why',
        caption: `The other one can't be ${e}: that would leave all four corners as just ${a} and ${b}.`,
        outlineCells: cells,
        links: [link],
        eliminated,
        spotlight,
      },
      {
        badge: 'Result',
        caption: `So neither ${cellName(x[0], x[1])} nor ${cellName(y[0], y[1])} can be ${e}.`,
        outlineCells: cells,
        eliminated,
        spotlight,
        applied: true,
      },
    )
    return { id, title, hint, state, frames }
  }

  // Types 7a-7d: the links, then "suppose the eliminated candidate were true".
  const target = instance.eliminatedCandidates[0]
  const targetCell: TutorialCell = [target.row, target.col]
  const x = target.digit
  const y = x === a ? b : a
  const name = (cell: TutorialCell) => cellName(cell[0], cell[1])
  const others = (...exclude: TutorialCell[]) => cells.filter((cell) => !exclude.some((e) => sameCell(e, cell)))
  let links: UrLink[]
  let steps: UrStep[]

  if (type === 'Type 7a') {
    // Bivalue A is linked to N on x; N' (the target) is A's other neighbour;
    // B, the other bivalue corner, sees both N and N'.
    const [A, N] = instance.reasonCells
    const [B] = others(A, N, targetCell)
    links = [{ digit: x, from: A, to: N }]
    steps = [
      { cell: A, digit: y, because: `${name(A)} sees ${name(targetCell)}, so it isn't ${x}: it's ${y}` },
      { cell: N, digit: x, because: `the ${x} link puts ${x} in ${name(N)}` },
      { cell: B, digit: y, because: `${name(B)} sees both ${x}s, so it's ${y}` },
    ]
  } else if (type === 'Type 7b') {
    // Bivalue A links to B on x, B links on to C on y; the target is the
    // fourth corner, which sees A and C.
    const [A, B, C] = instance.reasonCells
    links = [
      { digit: x, from: A, to: B },
      { digit: y, from: B, to: C },
    ]
    steps = [
      { cell: A, digit: y, because: `${name(A)} sees ${name(targetCell)}, so it isn't ${x}: it's ${y}` },
      { cell: B, digit: x, because: `the ${x} link puts ${x} in ${name(B)}` },
      { cell: C, digit: y, because: `${name(B)} isn't ${y}, so the ${y} link puts ${y} in ${name(C)}` },
    ]
  } else if (type === 'Type 7c') {
    // Bivalue A links to P on x; the target and the last corner Q share the
    // other row (or column), linked on y.
    const [A, P] = instance.reasonCells
    const [Q] = others(A, P, targetCell)
    links = [
      { digit: x, from: A, to: P },
      { digit: y, from: targetCell, to: Q },
    ]
    steps = [
      { cell: A, digit: y, because: `${name(A)} sees ${name(targetCell)}, so it isn't ${x}: it's ${y}` },
      { cell: P, digit: x, because: `the ${x} link puts ${x} in ${name(P)}` },
      { cell: Q, digit: y, because: `${name(targetCell)} isn't ${y}, so the ${y} link puts ${y} in ${name(Q)}` },
    ]
  } else {
    // Type 7d: the target corner Z is linked on y to both of its
    // neighbours; A, the bivalue opposite corner, sees both of them.
    const [A] = instance.reasonCells
    const [R, C] = others(A, targetCell)
    links = [
      { digit: y, from: targetCell, to: R },
      { digit: y, from: targetCell, to: C },
    ]
    steps = [
      { cell: R, digit: y, because: `${name(targetCell)} isn't ${y}, so the ${y} link puts ${y} in ${name(R)}` },
      { cell: C, digit: y, because: `the other ${y} link puts ${y} in ${name(C)} too` },
      { cell: A, digit: x, because: `${name(A)} sees both ${y}s, so it's ${x}` },
    ]
  }

  const linkLines: TutorialLink[] = links.map((l) => ({ from: ref(l.from[0], l.from[1], l.digit), to: ref(l.to[0], l.to[1], l.digit), kind: 'strong' }))
  const linkUnits = links.map((l) => strongUnit(state, l.digit, l.from, l.to))
  frames.push({
    badge: 'Links',
    caption: links
      .map((l, i) => `In ${linkUnits[i] ? unitPhrase(linkUnits[i]!) : 'their shared unit'}, ${l.digit} fits only in ${name(l.from)} and ${name(l.to)}.`)
      .join(' '),
    outlineCells: cells,
    unitCells: linkUnits.flatMap((unit) => unit?.cells ?? []),
    links: linkLines,
    spotlight,
  })

  const targetPip = ref(target.row, target.col, x)
  const suppose: ColouredCand[] = [{ ...targetPip, color: colourOf(x) }]
  frames.push({
    badge: 'Suppose',
    caption: `Suppose ${name(targetCell)} were ${x}.`,
    outlineCells: cells,
    links: linkLines,
    coloured: suppose,
    fresh: [targetPip],
    spotlight,
  })
  steps.forEach((step, i) => {
    const pip = ref(step.cell[0], step.cell[1], step.digit)
    frames.push({
      badge: 'Follow',
      caption: `Then ${step.because}.`,
      outlineCells: cells,
      links: linkLines,
      coloured: [
        ...suppose,
        ...steps.slice(0, i + 1).map((s) => ({ ...ref(s.cell[0], s.cell[1], s.digit), color: colourOf(s.digit) })),
      ],
      fresh: [pip],
      spotlight,
    })
  })
  const allColoured: ColouredCand[] = [
    ...suppose,
    ...steps.map((s) => ({ ...ref(s.cell[0], s.cell[1], s.digit), color: colourOf(s.digit) })),
  ]
  frames.push(
    {
      badge: 'Deadly',
      caption: `Now all four corners are just ${a} and ${b}: the deadly pattern. So the supposition was wrong.`,
      outlineCells: cells,
      links: linkLines,
      coloured: allColoured,
      spotlight,
    },
    {
      badge: 'Result',
      caption: `So ${name(targetCell)} can't be ${x}.`,
      outlineCells: cells,
      links: linkLines,
      eliminated,
      spotlight,
      applied: true,
    },
  )
  return { id, title, hint, state, frames }
}

export function buildBugPlusOneLesson(id: string, title: string, hint: string, state: PuzzleState): TutorialLesson {
  const instance = bugFinder.find(state.board, state.candidates)
  if (!instance) {
    throw new Error('No BUG+1 in this example.')
  }
  const cell: TutorialCell = [instance.cell[0], instance.cell[1]]
  const name = cellName(cell[0], cell[1])
  const digit = instance.solvedDigit
  const unit = unitContaining(instance.unitKind, cell)
  const inUnit = unit.cells
    .filter(([r, c]) => state.board[r][c] === 0 && state.candidates[r][c][digit - 1])
    .map(([r, c]) => ref(r, c, digit))
  const solved = [ref(cell[0], cell[1], digit)]

  return {
    id,
    title,
    hint,
    state,
    frames: [
      {
        badge: 'Look',
        caption: `Every unsolved cell has exactly two candidates, except ${name}, which has three (${joinPhrases(instance.candidates.map(String))}).`,
        outlineCells: [cell],
      },
      {
        badge: 'Deadly',
        caption: `With only two candidates in every cell, each digit left in a row, column or box would appear there exactly twice: a pattern that always has two solutions. So ${name} must be the digit that breaks it.`,
        outlineCells: [cell],
      },
      {
        badge: 'Count',
        caption: `In ${unitPhrase(unit)}, ${digit} appears three times, while every other digit pairs up. The odd one out is ${digit}.`,
        outlineCells: [cell],
        unitCells: unit.cells,
        basis: inUnit,
        spotlight: { digits: [digit] },
      },
      {
        badge: 'Result',
        caption: `So ${name} is ${digit}.`,
        outlineCells: [cell],
        solved,
        spotlight: { digits: [digit] },
        applied: true,
      },
    ],
  }
}

interface OddagonOptions {
  id: string
  title: string
  hint?: string
  state: PuzzleState
  type: 1 | 2
  /** Any loop cell, in case the position has more than one loop. */
  cell: TutorialCell
}

export function buildBivalueOddagonLesson(options: OddagonOptions): TutorialLesson {
  const { id, title, hint, state, type, cell } = options
  const instance = oddagonFinder
    .find(state.board, state.candidates)
    .find((candidate) => candidate.type === type && candidate.cells.some((c) => sameCell(c, cell)))
  if (!instance) {
    throw new Error(`No Bivalue Oddagon Type ${type} through ${cellName(cell[0], cell[1])} in this example.`)
  }
  const [a, b] = instance.loopDigits
  const x = instance.guardianDigit
  const loop = instance.cells.map(([r, c]) => [r, c] as const)
  const n = loop.length
  const guardians = instance.guardianCells.map(([r, c]) => [r, c] as const)
  const spotlight = { digits: [a, b, x] }
  // Each cell to the next, closing the loop.
  const ring: TutorialLink[] = loop.map(([r, c], i) => {
    const [nr, nc] = loop[(i + 1) % n]
    return { from: ref(r, c, a), to: ref(nr, nc, a), kind: 'sees' }
  })
  // Try alternating a/b round the loop: the last cell (an even index, as n
  // is odd) gets a again, next to the first cell's a.
  const alternating: ColouredCand[] = loop.map(([r, c], i) => {
    const digit = i % 2 === 0 ? a : b
    return { ...ref(r, c, digit), color: digit === a ? 'blue' : 'yellow' }
  })
  const [lr, lc] = loop[n - 1]
  const [fr, fc] = loop[0]

  const frames: TutorialFrame[] = [
    {
      badge: 'Look',
      caption:
        `These ${n} cells can each be ${a} or ${b}` +
        ` (${cellList(guardians)} can also be ${x}), and each one sees the next, making a loop of ${n}.`,
      outlineCells: loop,
      links: ring,
      spotlight,
    },
    {
      badge: 'Why',
      caption: `Neighbours in the loop can't match, so a loop of just ${a} and ${b} must alternate. With an odd number of cells, the last one meets the first with the same digit: impossible.`,
      outlineCells: loop,
      coloured: alternating,
      links: [{ from: ref(lr, lc, a), to: ref(fr, fc, a), kind: 'sees' }],
      spotlight,
    },
  ]

  if (type === 1) {
    const [g] = guardians
    const solved = [ref(g[0], g[1], x)]
    frames.push(
      {
        badge: 'Spot it',
        caption: `So some loop cell must be something else, and only ${cellName(g[0], g[1])} has another option: ${x}.`,
        outlineCells: loop,
        solved,
        spotlight,
      },
      { badge: 'Result', caption: `So ${cellName(g[0], g[1])} is ${x}.`, outlineCells: loop, solved, spotlight, applied: true },
    )
  } else {
    const eliminated = instance.eliminations.map((e) => ref(e.row, e.col, e.digit))
    const guardianPips = guardians.map(([r, c]) => ref(r, c, x))
    frames.push(
      {
        badge: 'Spot it',
        caption: `So some loop cell must be something else. Only ${cellList(guardians)} have another option, ${x}, so one of them is ${x}.`,
        outlineCells: loop,
        basis: guardianPips,
        spotlight,
      },
      {
        badge: 'Eliminate',
        caption: `Any other cell that sees all of them can't be ${x}.`,
        outlineCells: loop,
        basis: guardianPips,
        eliminated,
        links: eliminated.flatMap((e) => guardianPips.map((g) => ({ from: e, to: g, kind: 'sees' as const }))),
        spotlight,
      },
      { badge: 'Result', caption: `${x} is removed from ${cellList(eliminated.map((e) => [e.row, e.col] as const))}.`, outlineCells: loop, eliminated, spotlight, applied: true },
    )
  }
  return { id, title, hint, state, frames }
}
