import { buildMedusaChainInstance, cellRef, medusaFinder, type TechniqueCandidateRef, type TechniqueInstance } from './techniqueEngine'
import type { DragonMove } from './sudoku/SudokuDragonFinder'
import type { ChainColor } from './sudoku/SudokuMedusaFinder'
import { autocompleteMedusa, type MedusaSeed } from './sudoku/SudokuMedusaAutocompleter'
import { formatCandidate } from './sudoku/SudokuDragonTargetFinder'
import { sudokuUnits, type Cell } from './sudoku/SudokuUnits'
import type { Board, CandidateGrid } from './sudoku/types'

/** One hint the popup reveals ("Next hint" shows the next one). `lines` are
 * listed under `text` (an invalid colouring's problems, say). */
export interface HintStep {
  text: string
  lines?: string[]
  /** This step already states the whole conclusion (in the user's own
   * colours), so no separate answer step follows it. */
  final?: boolean
}

/** Everything the Hint popup can reveal about the easiest technique on the
 * grid, least-revealing first: which technique it is, then (technique by
 * technique) where to look, then the full answer. */
export interface TechniqueHint {
  instanceId: string
  /** The technique's name without the details a row name gives away (which
   * Medusa rules, which Dynamic Dragon techniques, which digit...). */
  label: string
  steps: HintStep[]
}

/** Which techniques get a hint that reads the user's own colouring on the
 * grid (the "Find by colours" checks) instead of fixed advice. */
export type ColouringHintKind = 'medusa' | 'dragon' | 'dynamic-dragon'

export function colouringHintKind(instance: TechniqueInstance): ColouringHintKind | null {
  if (instance.id.startsWith('medusa-')) return 'medusa'
  if (instance.id.startsWith('dragon-')) return 'dragon'
  if (instance.id.startsWith('dynamic-dragon-')) return 'dynamic-dragon'
  return null
}

// ---- Wording helpers ----------------------------------------------------

/** sudokuUnits() order: rows 0-8, columns 9-17, boxes 18-26. */
function unitName(index: number): string {
  return index < 9 ? `row ${index + 1}` : index < 18 ? `column ${index - 8}` : `box ${index - 17}`
}

function boxName(row: number, col: number): string {
  return `box ${Math.floor(row / 3) * 3 + Math.floor(col / 3) + 1}`
}

/** Indexes (into sudokuUnits()) of every unit holding all of `cells`. */
function commonUnits(cells: readonly Cell[]): number[] {
  return sudokuUnits().flatMap((unit, index) =>
    cells.every(([row, col]) => unit.some(([r, c]) => r === row && c === col)) ? [index] : [],
  )
}

function listAnd(items: readonly (string | number)[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

function listOr(items: readonly (string | number)[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`
}

function uniqueSorted(values: Iterable<number>): number[] {
  return [...new Set(values)].sort((a, b) => a - b)
}

function cellsText(cells: readonly Cell[]): string {
  return listAnd(cells.map(([row, col]) => cellRef(row, col)))
}

function uniqueCells(refs: readonly TechniqueCandidateRef[]): Cell[] {
  const seen = new Map<string, Cell>()
  for (const { row, col } of refs) seen.set(`${row},${col}`, [row, col])
  return [...seen.values()]
}

/** How many unsolved cells of unit `index` still have `digit` marked. */
function digitCountInUnit(board: Board, candidates: CandidateGrid, index: number, digit: number): number {
  return sudokuUnits()[index].filter(([r, c]) => board[r][c] === 0 && candidates[r][c][digit - 1]).length
}

/** The technique's name, minus what a Techniques row name would give away. */
export function techniqueHintLabel(instance: TechniqueInstance): string {
  const id = instance.id
  if (id.startsWith('medusa-')) return '3D Medusa'
  if (id.startsWith('dragon-')) return 'Dragon Colouring'
  if (id.startsWith('double-dragon-')) return 'Double Dragon Colouring'
  if (id.startsWith('dynamic-dragon-')) return 'Dynamic Dragon Colouring'
  if (id.startsWith('double-dynamic-dragon-')) return 'Double Dynamic Dragon Colouring'
  if (id.startsWith('simple-color-')) return 'Simple Colouring'
  if (id.startsWith('ur-')) return 'Unique Rectangle'
  if (id.startsWith('bivalue-oddagon-')) return 'Bivalue Oddagon'
  if (id.startsWith('short-aic-')) return 'Short AIC'
  if (id.startsWith('generic-aic-')) return 'AIC (a long chain)'
  return instance.name
}

/** One line on what the technique is, shown with its name. */
function techniqueBlurb(instance: TechniqueInstance): string {
  const id = instance.id
  if (id.startsWith('naked-single')) return 'Some cell has only one candidate left.'
  if (id.startsWith('hidden-single')) return 'Some digit has only one place left in a row, column or box.'
  if (id.startsWith('locked-candidate-pointing'))
    return "A digit's candidates inside one box all lie in the same row or column."
  if (id.startsWith('locked-candidate-claiming'))
    return "A digit's candidates inside one row or column all lie in the same box."
  if (id.startsWith('naked-')) return 'Some cells of one row, column or box hold only as many digits as there are cells.'
  if (id.startsWith('hidden-pair')) return 'Two digits can only go in the same two cells of a row, column or box.'
  if (id.startsWith('ur-')) return 'Four cells in a rectangle over two boxes would give the puzzle two solutions.'
  if (id.startsWith('bug-plus-one'))
    return 'Every unsolved cell has two candidates except one - the puzzle would have two solutions without it.'
  if (id.startsWith('bivalue-oddagon-')) return 'An odd loop of cells sharing the same two candidates can\'t be all those two digits.'
  if (id.startsWith('simple-color-')) return 'Colour the conjugate pairs of one digit in two alternating colours.'
  if (id.startsWith('fish-')) return 'A digit confined to the same columns in several rows (or the same rows in several columns).'
  if (id.startsWith('short-single-digit-aic')) return 'A short chain of strong and weak links on a single digit.'
  if (id.startsWith('short-aic-') || id.startsWith('generic-aic-'))
    return 'A chain of alternating strong and weak links whose two ends can\'t both be false.'
  if (id.startsWith('als-xz-')) return 'Two almost locked sets linked by a restricted common digit.'
  if (id.startsWith('medusa-')) return 'Colour a network of strong links across digits in two colours until something contradicts or sees both colours.'
  if (id.startsWith('double-dynamic-dragon-') || id.startsWith('double-dragon-'))
    return 'Two stuck Dragons, linked to each other.'
  if (id.startsWith('dynamic-dragon-'))
    return 'A stuck 3D Medusa extended with dragon colours, using other techniques under each colour\'s assumption.'
  if (id.startsWith('dragon-')) return 'A stuck 3D Medusa extended with dragon colours.'
  return ''
}

/** A candidate of the chain to start colouring from: one in the cell the
 * conclusion rests on when there is one, else the first. */
export function medusaStartCandidate(
  chain: readonly TechniqueCandidateRef[],
  focusCells: readonly (readonly [number, number])[] = [],
): TechniqueCandidateRef {
  for (const [row, col] of focusCells) {
    const inCell = chain.find((c) => c.row === row && c.col === col)
    if (inCell) return inCell
  }
  for (const [row, col] of focusCells) {
    const seen = chain.find((c) => commonUnits([[row, col], [c.row, c.col]]).length > 0)
    if (seen) return seen
  }
  return chain[0]
}

// ---- Fixed advice, technique by technique -----------------------------

function detailSteps(instance: TechniqueInstance, board: Board, candidates: CandidateGrid): HintStep[] {
  const id = instance.id
  const usedCells = instance.usedCells as Cell[]
  const usedDigits = uniqueSorted(instance.usedCandidates.map((c) => c.digit))
  const eliminatedText = listAnd(instance.eliminatedCandidates.map(formatCandidate))

  if (id.startsWith('naked-single') || id.startsWith('hidden-single')) {
    const { row, col, digit } = instance.solvedCandidates[0]
    if (id.startsWith('naked-single')) {
      return [{ text: `Look in ${boxName(row, col)}.` }, { text: `${cellRef(row, col)} has only one candidate left.` }]
    }
    // The unit the digit is hidden in - box first, the way people scan.
    const units = commonUnits([[row, col]]).sort((a, b) => b - a)
    const hiddenIn = units.find((u) => digitCountInUnit(board, candidates, u, digit) === 1) ?? units[0]
    return [
      { text: `Look at where ${digit} can go in ${unitName(hiddenIn)}.` },
      { text: `${digit} fits in only one place in ${unitName(hiddenIn)}: ${cellRef(row, col)}.` },
    ]
  }

  if (id.startsWith('locked-candidate-')) {
    const digit = instance.usedCandidates[0].digit
    const [row, col] = usedCells[0]
    const line = usedCells.every(([r]) => r === row) ? `row ${row + 1}` : `column ${col + 1}`
    const box = boxName(row, col)
    return id.startsWith('locked-candidate-pointing')
      ? [
          { text: `Look at ${digit} in ${box}.` },
          { text: `Every ${digit} in ${box} lies in ${line}, so the rest of ${line} can't be ${digit}.` },
        ]
      : [
          { text: `Look at ${digit} in ${line}.` },
          { text: `Every ${digit} in ${line} lies in ${box}, so the rest of ${box} can't be ${digit}.` },
        ]
  }

  if (id.startsWith('naked-pair') || id.startsWith('naked-triple') || id.startsWith('naked-quad')) {
    const eliminationCells = uniqueCells(instance.eliminatedCandidates)
    const units = commonUnits(usedCells)
    const unit =
      units.find((u) => eliminationCells.some(([r, c]) => sudokuUnits()[u].some(([ur, uc]) => ur === r && uc === c))) ??
      units[0]
    return [
      { text: `Look in ${unitName(unit)} for ${usedCells.length} cells that hold only ${usedCells.length} digits between them.` },
      {
        text: `${cellsText(usedCells)} hold only ${listAnd(usedDigits)}, so no other cell in ${unitName(unit)} can be ${listOr(usedDigits)}.`,
      },
    ]
  }

  if (id.startsWith('hidden-pair')) {
    const units = commonUnits(usedCells)
    const unit = units.find((u) => usedDigits.every((d) => digitCountInUnit(board, candidates, u, d) === 2)) ?? units[0]
    return [
      { text: `Look in ${unitName(unit)} for two digits that can only go in the same two cells.` },
      {
        text: `In ${unitName(unit)}, ${listAnd(usedDigits)} can only go in ${cellsText(usedCells)}, so those two cells can't hold anything else.`,
      },
    ]
  }

  if (id.startsWith('ur-')) {
    const rectangle = usedCells.slice(0, 4)
    const inRectangle = new Set(rectangle.map(([r, c]) => `${r},${c}`))
    const digits = uniqueSorted(
      instance.usedCandidates.filter((c) => inRectangle.has(`${c.row},${c.col}`)).map((c) => c.digit),
    )
    return [
      { text: `Look for four cells in a rectangle, spanning two boxes, that all hold the candidates ${listAnd(digits)}.` },
      {
        text: `The rectangle is ${cellsText(rectangle)}. If those four cells held only ${listAnd(digits)}, the puzzle would have two solutions - so something else must be true.`,
      },
    ]
  }

  if (id.startsWith('bug-plus-one')) {
    const { row, col } = instance.solvedCandidates[0]
    return [
      { text: 'Find the one unsolved cell that has three candidates.' },
      { text: `It's ${cellRef(row, col)}. Which of its candidates appears three times in its row, column or box?` },
    ]
  }

  if (id.startsWith('bivalue-oddagon-')) {
    const byCell = usedCells.map(([r, c]) =>
      new Set(instance.usedCandidates.filter((u) => u.row === r && u.col === c).map((u) => u.digit)),
    )
    const pair = usedDigits.filter((d) => byCell.every((digits) => digits.has(d)))
    return [
      { text: `Look for a loop of an odd number of cells, each linked to the next, all holding the candidates ${listAnd(pair)}.` },
      { text: `The loop is ${cellsText(usedCells)}. The cells with an extra candidate are what stop it being a deadly pattern.` },
    ]
  }

  if (id.startsWith('simple-color-')) {
    const digit = instance.blueCandidates?.[0]?.digit ?? instance.yellowCandidates?.[0]?.digit
    const start = instance.blueCandidates?.[0]
    return [
      { text: `Colour the conjugate pairs of digit ${digit}.` },
      ...(start ? [{ text: `Start the colouring from ${formatCandidate(start)}.` }] : []),
    ]
  }

  if (id.startsWith('fish-')) {
    const reason = instance.notation.split(', thus ')[0]
    return [{ text: `Look at digit ${usedDigits[0]}.` }, { text: `${reason}.` }]
  }

  if (id.includes('aic-')) {
    const nodes = instance.aicCandidates ?? []
    const digits = uniqueSorted(nodes.map((n) => n.digit))
    const first = nodes[0]
    const last = nodes[nodes.length - 1]
    return [
      {
        text: `The chain has ${nodes.length - 1} links and uses the ${digits.length === 1 ? 'digit' : 'digits'} ${listAnd(digits)}. It eliminates ${eliminatedText}.`,
      },
      ...(first && last
        ? [{ text: `The chain starts at ${formatCandidate(first)} and ends at ${formatCandidate(last)} - one of those two must be true.` }]
        : []),
    ]
  }

  if (id.startsWith('als-xz-')) {
    const rcc = instance.blueCandidates?.[0]?.digit
    const z = uniqueSorted((instance.yellowCandidates ?? []).map((c) => c.digit))
    return [
      { text: `The two sets are linked by ${rcc}, and ${listAnd(z)} ${z.length === 1 ? 'is the digit' : 'are the digits'} that get${z.length === 1 ? 's' : ''} eliminated.` },
      { text: `It eliminates ${eliminatedText}.` },
    ]
  }

  // Double Dragon / Double Dynamic Dragon (and a Dragon whose colouring
  // hint wasn't worked out): where the first Medusa starts.
  if (instance.moves && instance.moves.length > 0) {
    const medusa = instance.moves[0].colored
    if (medusa.length > 0) {
      return [{ text: `Start with the 3D Medusa that includes ${formatCandidate(medusaStartCandidate(medusa))}, and colour it until it gets stuck.` }]
    }
  }
  return []
}

/** The hint for `instance`: its name, then `colouringSteps` when given (a
 * colouring technique, worked out from the user's paint - see
 * medusaColouringSteps / dragonMoveSteps) or the fixed advice above, then
 * the full answer. */
export function buildTechniqueHint(
  instance: TechniqueInstance,
  board: Board,
  candidates: CandidateGrid,
  colouringSteps?: HintStep[],
): TechniqueHint {
  const label = techniqueHintLabel(instance)
  const blurb = techniqueBlurb(instance)
  const intro: HintStep = {
    text: `The easiest technique available is ${/^([AEIO]|X-)/.test(label) ? 'an' : 'a'} ${label}.${blurb ? ` ${blurb}` : ''}`,
  }
  const answer: HintStep = {
    // Some notations already start with the name ("Locked Candidate (Pointing) - ...").
    text: instance.notation.startsWith(instance.name) ? instance.notation : `${instance.name}: ${instance.notation}`,
    lines: instance.moves ? ['Reveal the Techniques list and select it to step through it on the grid.'] : undefined,
  }
  const details = colouringSteps ?? detailSteps(instance, board, candidates)
  return {
    instanceId: instance.id,
    label,
    steps: [intro, ...details, ...(details[details.length - 1]?.final ? [] : [answer])],
  }
}

// ---- Colouring hints: reading the user's own paint -------------------------

/** Why two strongly linked candidates must take opposite colours. */
function strongLinkReason(board: Board, candidates: CandidateGrid, a: TechniqueCandidateRef, b: TechniqueCandidateRef): string {
  if (a.row === b.row && a.col === b.col) {
    return `${cellRef(a.row, a.col)} has only the two candidates ${a.digit} and ${b.digit}`
  }
  const unit = commonUnits([
    [a.row, a.col],
    [b.row, b.col],
  ]).find((u) => digitCountInUnit(board, candidates, u, a.digit) === 2)
  return unit === undefined
    ? `${formatCandidate(a)} and ${formatCandidate(b)} are strongly linked`
    : `${a.digit} appears only twice in ${unitName(unit)} (${cellRef(a.row, a.col)} and ${cellRef(b.row, b.col)})`
}

/** Which Medusa colours the popup names, and the starting point to suggest
 * when the user's own paint doesn't give one. */
export interface MedusaHintContext {
  seeds: MedusaSeed[]
  colorNames: Record<ChainColor, string>
  /** The Medusa of the technique the hint is about, and the cells its
   * conclusion rests on (to pick a starting candidate near them). */
  targetChain: TechniqueCandidateRef[]
  focusCells?: readonly (readonly [number, number])[]
}

export type MedusaPaintCheck =
  | { kind: 'steps'; steps: HintStep[] }
  /** The painted Medusa is complete, and it's valid: what a Dragon hint does next. */
  | { kind: 'complete'; stuck: boolean; builtNotation: string | null; focusCells: readonly (readonly [number, number])[] }

function startSteps(context: MedusaHintContext, prefix = ''): HintStep[] {
  const start = medusaStartCandidate(context.targetChain, context.focusCells)
  return [
    {
      text: `${prefix}Start a 3D Medusa from ${formatCandidate(start)}: paint it ${context.colorNames.blue} (Candidate Colours pad), then keep colouring every candidate strongly linked to a coloured one in the opposite colour, ${context.colorNames.yellow}.`,
    },
  ]
}

/** Checks the user's Medusa paint (the same check Find by colours' Autocomplete
 * medusa does) and says what to colour next - a candidate strongly linked to
 * one they've already coloured, and why - or hands back the complete chain.
 * `allowOutside`: for a Dragon, where Medusa colours can also sit outside
 * the chain (promotions). */
export function checkMedusaPaint(
  board: Board,
  candidates: CandidateGrid,
  context: MedusaHintContext,
  allowOutside = false,
): MedusaPaintCheck {
  const { seeds, colorNames } = context
  if (seeds.length === 0) {
    return { kind: 'steps', steps: startSteps(context) }
  }
  const outcome = autocompleteMedusa(medusaFinder, board, candidates, seeds, colorNames, { allowOutside })
  if (outcome.kind === 'invalid') {
    return { kind: 'steps', steps: [{ text: 'Your Medusa colouring has a problem:', lines: outcome.problems }] }
  }
  const chain = outcome.chain
  const built = buildMedusaChainInstance(chain, board, candidates, colorNames)
  const stuck = built === null
  if (outcome.added.length === 0) {
    return {
      kind: 'complete',
      stuck,
      builtNotation: built?.instance.notation ?? null,
      focusCells: built?.instance.medusaHighlightCells ?? [],
    }
  }

  // A Medusa-only hint: a chain that can't prove anything even once
  // finished isn't worth finishing.
  if (!allowOutside && stuck) {
    return {
      kind: 'steps',
      steps: startSteps(
        context,
        `The Medusa you've started doesn't lead anywhere, even once it's fully coloured. `,
      ),
    }
  }

  // Next: an uncoloured chain candidate strongly linked to a coloured one.
  const graph = medusaFinder.buildStrongLinkGraph(board, candidates)
  const key = (c: TechniqueCandidateRef) => `${c.row},${c.col},${c.digit}`
  const colourOf = new Map(chain.candidates.map((c) => [key(c), c.color]))
  const painted = new Set(chain.candidates.map(key))
  for (const c of outcome.added) painted.delete(key(c))
  // Prefer a candidate in a cell the conclusion rests on, then any.
  const focus = new Set((built?.instance.medusaHighlightCells ?? []).map(([r, c]) => `${r},${c}`))
  const options = outcome.added.flatMap((target) => {
    const from = (graph.adjacency.get(key(target)) ?? []).find((k) => painted.has(k))
    return from ? [{ target, from: graph.nodeByKey.get(from)! }] : []
  })
  const next = options.find((o) => focus.has(`${o.target.row},${o.target.col}`)) ?? options[0]
  if (!next) {
    return { kind: 'steps', steps: startSteps(context) }
  }
  const targetColour = colorNames[colourOf.get(key(next.target))!]
  const fromColour = colorNames[colourOf.get(key(next.from))!]
  return {
    kind: 'steps',
    steps: [
      {
        text: `Your colouring is right so far (${outcome.added.length} more candidate${outcome.added.length === 1 ? '' : 's'} to colour). Next, look at ${formatCandidate(next.target)}.`,
      },
      {
        text: `${strongLinkReason(board, candidates, next.target, next.from)}, so ${formatCandidate(next.target)} takes the opposite colour to ${formatCandidate(next.from)} (${fromColour}): colour it ${targetColour}.`,
      },
    ],
  }
}

/** The whole colouring hint for a 3D Medusa row. */
export function medusaColouringSteps(board: Board, candidates: CandidateGrid, context: MedusaHintContext): HintStep[] {
  const check = checkMedusaPaint(board, candidates, context)
  if (check.kind === 'steps') {
    return check.steps
  }
  if (check.stuck) {
    return startSteps(context, `Your Medusa is fully coloured, but it doesn't lead anywhere. `)
  }
  return [
    {
      text: `Your Medusa is fully coloured.${check.focusCells.length > 0 ? ` Now look at ${cellsText(check.focusCells as Cell[])}.` : ''}`,
    },
    ...(check.builtNotation ? [{ text: check.builtNotation, final: true }] : []),
  ]
}

/** The Dragon move the user's colouring has reached: which candidates to
 * look at, then the move's own explanation (`rename`d to the user's paint
 * colours). */
export function dragonMoveSteps(move: DragonMove, rename: (text: string) => string): HintStep[] {
  const conclusion = ['mass-elimination', 'rule3', 'rule4', 'rule5', 'solution'].includes(move.kind)
  if (conclusion) {
    const refs = [...move.eliminated, ...move.solved]
    const where =
      move.kind === 'mass-elimination' || move.kind === 'solution' || refs.length === 0
        ? 'Look for a contradiction between your colours.'
        : `Look at ${cellsText(uniqueCells(refs).slice(0, 4))}.`
    return [
      { text: `Your colouring is far enough along to make a deduction. ${where}` },
      { text: rename(move.description) },
    ]
  }
  const targets = move.colored.slice(0, 4).map(formatCandidate)
  const more = move.colored.length > 4 ? ` (and ${move.colored.length - 4} more)` : ''
  return [
    { text: `Your colouring is right so far. Next, look at ${listAnd(targets)}${more}.` },
    { text: rename(move.description) },
  ]
}
