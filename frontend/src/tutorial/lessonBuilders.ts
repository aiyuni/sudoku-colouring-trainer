import { markedCandidateDigits } from '../sudoku/boardUtils'
import { foldDragonMoves } from '../sudoku/dragonReplay'
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
  UR: 'a Unique Rectangle',
  'bivalue oddagon': 'a Bivalue Oddagon',
  'bug plus one': 'a BUG+1',
  'short single-digit aic': 'a single-digit AIC',
  'short aic': 'a short AIC',
  'generic aic': 'a generic AIC',
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
