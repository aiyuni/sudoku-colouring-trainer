import { buildMedusaChainInstance, cellRef, medusaFinder, type TechniqueCandidateRef, type TechniqueInstance } from './techniqueEngine'
import { unitLabel } from './sudoku/SudokuConstraints'
import type { DragonMove } from './sudoku/SudokuDragonFinder'
import type { ChainColor } from './sudoku/SudokuMedusaFinder'
import { autocompleteMedusa, type MedusaSeed } from './sudoku/SudokuMedusaAutocompleter'
import { formatCandidate } from './sudoku/SudokuDragonTargetFinder'
import { boxOf, sudokuUnits, type Cell } from './sudoku/SudokuUnits'
import type { Board, CandidateGrid } from './sudoku/types'
import { tutorialTargetFor, type TutorialTarget } from './tutorial/tutorialLinks'

/** One hint the popup reveals ("Next hint" shows the next one). `lines` are
 * listed under `text` (an invalid colouring's problems, say). */
export interface HintStep {
  text: string
  lines?: string[]
  /** This step already states the whole conclusion (in the user's own
   * colours), so no separate answer step follows it. */
  final?: boolean
  /** A "Learn this technique" link to the How It Works section teaching it
   * (the first hint only, and only when the page teaches the technique). */
  learn?: TutorialTarget
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
  // 27 and 28 are an X-Sudoku's diagonals (Variant page).
  return index >= 27 ? unitLabel(index) : index < 9 ? `row ${index + 1}` : index < 18 ? `column ${index - 8}` : `box ${index - 17}`
}

function boxName(row: number, col: number): string {
  return `box ${boxOf(row, col) + 1}`
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
  if (id.startsWith('avoidable-rectangle-')) return 'Avoidable Rectangle'
  if (id.startsWith('extended-ur-')) return 'Extended UR'
  if (id.startsWith('short-aic-')) return instance.aicPattern ?? 'Short AIC'
  if (id.startsWith('generic-aic-')) return 'generic AIC'
  if (id.startsWith('grouped-aic-')) return 'Grouped AIC'
  if (id.startsWith('uraic-')) return 'UR-AIC'
  if (id.startsWith('alsaic-')) return 'ALS-AIC'
  return instance.name
}

/** One line on what the technique is, shown with its name. */
function techniqueBlurb(instance: TechniqueInstance): string {
  const id = instance.id
  if (id.startsWith('naked-single')) return 'Some cell has only one candidate left.'
  if (id.startsWith('hidden-single')) return 'Some digit has only one place left in a row, column or box.'
  // Variant solver: the Killer cage techniques.
  if (id.startsWith('killer-cage-sum')) return 'A cage has one empty cell left, so its sum says what that cell is.'
  if (id.startsWith('killer-cage-combinations'))
    return "Some candidate fits no way of filling its cage: different digits, each from its own cell's candidates, adding up to the cage's sum."
  if (id.startsWith('killer-cage-locked'))
    return 'A cage needs a certain digit whichever way it is filled, so cells that see every place it could go in the cage lose it.'
  if (id.startsWith('entropy-square'))
    return 'Some 2x2 square has only one cell left for one of its three groups - low (1-3), middle (4-6), high (7-9) - or only two cells left for two of them.'
  if (id.startsWith('variant-locked-knight'))
    return "Some digit has only a few places left in a row, column or box, and one cell elsewhere sees every one of them - counting a knight's move as seeing."
  if (id.startsWith('variant-locked-diagonal'))
    return "Some digit has only a few places left in a unit, and they line up on a diagonal (or the diagonal's places all sit in one box)."
  if (id.startsWith('killer-45-'))
    return 'Every row, column and box adds up to 45. The cages lying inside (or covering) some of them leave a sum for the few cells that stick in or out.'
  if (id.startsWith('locked-candidate-pointing'))
    return "A digit's candidates inside one box all lie in the same row or column."
  if (id.startsWith('locked-candidate-claiming'))
    return "A digit's candidates inside one row or column all lie in the same box."
  if (id.startsWith('naked-')) return 'Some cells of one row, column or box hold only as many digits as there are cells.'
  if (id.startsWith('hidden-pair')) return 'Two digits can only go in the same two cells of a row, column or box.'
  if (id.startsWith('ur-')) return 'Four cells in a rectangle over two boxes would give the puzzle two solutions.'
  // BUG+N: "bug-plus-n-<N>-..." - one technique, worded by its N.
  if (id.startsWith('bug-plus-n-1-'))
    return 'Every unsolved cell has two candidates except one - the puzzle would have two solutions without it.'
  if (id.startsWith('bug-plus-n-'))
    return `Every unsolved cell has two candidates except ${id.startsWith('bug-plus-n-2-') ? 'two' : 'three'} - one of their extra digits must be true, or the puzzle would have two solutions.`
  if (id.startsWith('bivalue-oddagon-')) return 'An odd loop of cells sharing the same two candidates can\'t be all those two digits.'
  if (id.startsWith('avoidable-rectangle-'))
    return 'Four cells in a rectangle over two boxes, some already solved (not givens), must not end up as two digits that could swap.'
  if (id.startsWith('extended-ur-'))
    return 'Six cells that, holding only two or three digits between them, could be filled in two ways.'
  if (id.startsWith('simple-color-')) return 'Look for a digit where its candidates can only be in X or Y cell.  Start colouring the candidates in two alternating colours.'
  if (id.startsWith('fish-')) return 'A digit confined to the same columns in several rows (or the same rows in several columns).'
  if (id.startsWith('short-single-digit-aic')) {
    switch (instance.aicPattern) {
      case 'Skyscraper':
        return 'Two parallel rows (or columns) each hold a digit only twice, and one end of each lines up.'
      case 'Two-String Kite':
        return 'A row and a column each hold a digit only twice, and one end of each shares a box.'
      case 'Crane':
        return 'A row or column and a box each hold a digit only twice, and one end of each lines up.'
      case 'Empty Rectangle':
        return "A box's candidates for a digit all lie in one row and one column of it, and a row or column holding that digit only twice crosses one of them."
      default:
        return 'A short chain of strong and weak links on a single digit.'
    }
  }
  if (id.startsWith('short-aic-') && instance.aicPattern === 'W-Wing')
    return 'Two cells that don\'t see each other hold only the same two digits, and some row, column or box would have no place left for one of those digits if both cells were it.'
  if (id.startsWith('short-aic-') && instance.aicPattern === 'Y-Wing')
    return 'A cell holding only two digits sees two other two-digit cells, each sharing one of its digits and both sharing a third digit - one of them must be that third digit.'
  if (id.startsWith('short-aic-') || id.startsWith('generic-aic-'))
    return 'A chain of alternating strong and weak links whose two ends can\'t both be false.'
  if (id.startsWith('grouped-aic-'))
    return 'A chain of alternating strong and weak links whose two ends can\'t both be false, where at least one node is a group: a digit\'s two or three candidates in one box and one row or column, taken together as "the digit is in one of these cells".'
  if (id.startsWith('als-xz-')) return 'Two almost locked sets linked by a restricted common digit.'
  if (id.startsWith('uraic-'))
    return 'A chain of alternating strong and weak links, where at least one link (or elimination) comes from a Unique Rectangle that must not become a deadly pattern.'
  if (id.startsWith('alsaic-'))
    return 'A chain of alternating strong and weak links, where at least one link (or elimination) comes from an almost locked set: N cells holding N+1 digits, so all but one of those digits must be in them.'
  if (id.startsWith('sue-de-coq-'))
    return 'Cells where a row or column crosses a box hold two more digits than cells; two two-digit cells, one in the line and one in the box, split those digits between them.'
  if (id.startsWith('medusa-')) return 'Colour a network of strong links across digits in two colours until something contradicts or sees both colours.'
  if (id.startsWith('double-dynamic-dragon-') || id.startsWith('double-dragon-'))
    return 'Two stuck Dragons, linked to each other.'
  if (id.startsWith('dynamic-dragon-'))
    return 'Dynamic Dragon Colouring always starts from a stuck 3D Medusa.'
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

  if (id.startsWith('entropy-square')) {
    const [top, left] = usedCells[0]
    return [
      { text: 'Every 2x2 square needs a low (1-3), a middle (4-6) and a high (7-9) digit. Look for a square that is short of room for one of them.' },
      {
        text: `Look at the 2x2 square ${cellRef(top, left)}-${cellRef(top + 1, left + 1)}. Which of its cells can still hold each group?`,
      },
    ]
  }
  if (id.startsWith('variant-locked-')) {
    const digit = usedDigits[0]
    return [
      { text: `Look at where ${digit} can still go.` },
      {
        text: `${digit} is down to ${cellsText(usedCells)} in one unit. Which other cells see all of those${
          id.startsWith('variant-locked-knight') ? " (a knight's move counts)" : ' (the diagonals count)'
        }?`,
      },
    ]
  }
  if (id.startsWith('killer-cage-')) {
    const [row, col] = usedCells[0]
    const size = usedCells.length
    const where = size === 1 ? `the one-cell cage at ${cellRef(row, col)}` : `the cage of ${size} cells starting at ${cellRef(row, col)}`
    if (id.startsWith('killer-cage-sum')) {
      return [{ text: `Look at ${where}.` }, { text: 'Only one of its cells is still empty. What must it be for the cage to reach its sum?' }]
    }
    if (id.startsWith('killer-cage-locked')) {
      return [
        { text: `Look at ${where}.` },
        { text: `Every way of filling it uses a ${usedDigits[0]}. Which cells outside the cage see all the places that ${usedDigits[0]} could go?` },
      ]
    }
    return [
      { text: `Look at ${where}.` },
      { text: 'Which sets of different digits add up to its sum? Then check each cell: can it really hold each of its candidates in one of those sets?' },
    ]
  }
  if (id.startsWith('killer-45-')) {
    // The notation opens with the houses and their total ("Rows 1-2 add up to 90; ...").
    const houses = instance.notation.split(';')[0]
    const cells = (instance.medusaHighlightCells ?? []).map(([row, col]) => cellRef(row, col))
    return [
      { text: `${houses}.` },
      {
        text: id.startsWith('killer-45-innie')
          ? 'Add up the cages lying wholly inside. What is left over is the total of the other cells there.'
          : 'Add up every cage that covers them and take the total away. What is left over is the total of the cells sticking out.',
      },
      { text: `Those cells are ${listAnd(cells)}.` },
    ]
  }
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

  if (id.startsWith('bug-plus-n-1-')) {
    const { row, col } = instance.solvedCandidates[0]
    return [
      { text: 'Find the one unsolved cell that has three candidates.' },
      { text: `It's ${cellRef(row, col)}. Which of its candidates appears three times in its row, column or box?` },
    ]
  }

  if (id.startsWith('bug-plus-n-')) {
    const count = id.startsWith('bug-plus-n-2-') ? 'two' : 'three'
    const extras = listAnd(instance.usedCandidates.map((c) => `${c.digit} in ${cellRef(c.row, c.col)}`))
    return [
      { text: `Find the ${count} unsolved cells that have three candidates. For each, which candidate appears three times in its row, column or box? That's its extra digit.` },
      {
        text: `They're ${cellsText(instance.usedCells)}, with extra digits ${extras}. One of those must be true - so which cells see all of them?`,
      },
    ]
  }

  if (id.startsWith('avoidable-rectangle-')) {
    const [first] = instance.eliminatedCandidates
    if (id.startsWith('avoidable-rectangle-1-')) {
      return [
        { text: 'Look for a rectangle over two boxes with three solved corners (not givens), the same digit on two opposite corners.' },
        {
          text: `The rectangle is ${cellsText(usedCells)}. If ${cellRef(first.row, first.col)} were ${first.digit}, its two digits could swap round all four cells - a second solution.`,
        },
      ]
    }
    return [
      { text: 'Look for a rectangle over two boxes with two side-by-side solved corners (not givens), and two unsolved corners with two candidates each.' },
      {
        text: `The rectangle is ${cellsText(usedCells)}. Unless one of the unsolved corners is ${first.digit}, the rectangle would hold two digits that could swap - a second solution.`,
      },
    ]
  }

  if (id.startsWith('extended-ur-')) {
    // usedCandidates are the pattern digits; the odd cell has the border.
    const [odd] = instance.medusaHighlightCells ?? []
    return [
      {
        text:
          usedDigits.length === 2
            ? `Look for five cells holding only ${listAnd(usedDigits)}, and a sixth that also has other candidates, where every row, column and box they touch holds exactly two of the six.`
            : `Look for a 2-by-3 block of cells over two or three boxes: five of them hold only ${listAnd(usedDigits)}, and the sixth also has other candidates.`,
      },
      {
        text: `The six cells are ${cellsText(usedCells)}. If ${cellRef(odd[0], odd[1])} were one of ${listAnd(usedDigits)} too, the six could be filled in two ways - a second solution.`,
      },
    ]
  }

  if (id.startsWith('bivalue-oddagon-')) {
    const byCell = usedCells.map(([r, c]) =>
      new Set(instance.usedCandidates.filter((u) => u.row === r && u.col === c).map((u) => u.digit)),
    )
    const pair = usedDigits.filter((d) => byCell.every((digits) => digits.has(d)))
    return [
      { text: `Look for a loop of an odd number of cells, each linked to the next, and all holding the candidates ${listAnd(pair)}.` },
      { text: `The loop is ${cellsText(usedCells)}. The cells with an extra candidate are what stop it being a deadly pattern.` },
    ]
  }

  if (id.startsWith('simple-color-')) {
    const digit = instance.blueCandidates?.[0]?.digit ?? instance.yellowCandidates?.[0]?.digit
    const start = instance.blueCandidates?.[0]
    return [
      { text: `Look at digit ${digit}.` },
      ...(start ? [{ text: `Start the colouring from ${formatCandidate(start)}.` }] : []),
    ]
  }

  if (id.startsWith('fish-')) {
    const reason = instance.notation.split(', thus ')[0]
    return [{ text: `Look at digit ${usedDigits[0]}.` }, { text: `${reason}.` }]
  }

  if (id.startsWith('uraic-')) {
    const rectangles = uniqueCells(instance.usedCells.map(([row, col]) => ({ row, col, digit: 0 })))
    const [chain, rest] = instance.notation.split(' states that ')
    return [
      { text: `Look at the Unique Rectangle${rectangles.length > 4 ? 's' : ''} at ${cellsText(rectangles)}.` },
      { text: `The chain is ${chain}, where =UR= and -UR- mark links that come from a rectangle.` },
      { text: `It states that ${rest}` },
    ]
  }

  if (id.startsWith('alsaic-')) {
    const alsCells = uniqueCells(instance.usedCells.map(([row, col]) => ({ row, col, digit: 0 })))
    const [chain, rest] = instance.notation.split(' states that ')
    return [
      { text: `Look for almost locked sets among ${cellsText(alsCells)}.` },
      { text: `The chain is ${chain}, where =ALS= marks a link between two digits of one almost locked set.` },
      { text: `It states that ${rest}` },
    ]
  }

  if (id.includes('aic-')) {
    const links = instance.aicLinks ?? []
    const digits = uniqueSorted((instance.aicCandidates ?? []).map((n) => n.digit))
    if (instance.aicPattern === 'W-Wing' && instance.aicPatternText) {
      return [{ text: `Look for two cells holding only {${digits.join(',')}}.` }, { text: `${instance.aicPatternText}.` }]
    }
    if (instance.aicPattern === 'Y-Wing' && instance.aicPatternText) {
      return [{ text: 'Look for a cell holding only two digits, and two cells it sees holding only two digits each.' }, { text: `${instance.aicPatternText}.` }]
    }
    if (instance.aicPattern && instance.aicPatternText) {
      return [{ text: `Look at digit ${digits[0]}.` }, { text: `${instance.aicPatternText}.` }]
    }
    // A grouped end (Empty Rectangle) is "one of these cells".
    const endText = (ref: TechniqueCandidateRef, cells?: ReadonlyArray<readonly [number, number]>) =>
      cells ? `${ref.digit} in one of ${cellsText(cells)}` : formatCandidate(ref)
    const first = links[0]
    const last = links[links.length - 1]
    return [
      {
        text: `The chain has ${links.length} links and uses the ${digits.length === 1 ? 'digit' : 'digits'} ${listAnd(digits)}. It eliminates ${eliminatedText}.`,
      },
      ...(first && last
        ? [{ text: `The chain starts at ${endText(first.from, first.fromCells)} and ends at ${endText(last.to, last.toCells)}.  This means one of those two must be true.` }]
        : []),
    ]
  }

  if (id.startsWith('sue-de-coq-')) {
    const reason = instance.notation.split(', thus ')[0]
    const [first, ...rest] = reason.split('. ')
    return [
      { text: `${first}.` },
      ...(rest.length > 0 ? [{ text: `${rest.join('. ')}.` }] : []),
      { text: `It eliminates ${eliminatedText}.` },
    ]
  }

  if (id.startsWith('als-xz-')) {
    const rcc = instance.blueCandidates?.[0]?.digit
    const z = uniqueSorted((instance.yellowCandidates ?? []).map((c) => c.digit))
    return [
      { text: `The two sets are linked by RCC (X) digit ${rcc}, and ${listAnd(z)} ${z.length === 1 ? 'is the digit (Z) ' : 'are the digits'} that get${z.length === 1 ? 's' : ''} eliminated.` },
      { text: `It eliminates ${eliminatedText}.` },
    ]
  }

  // Double Dragon / Double Dynamic Dragon (and a Dragon whose colouring
  // hint wasn't worked out): where the first Medusa starts.
  if (instance.moves && instance.moves.length > 0) {
    const medusa = instance.moves[0].colored
    if (medusa.length > 0) {
      return [{ text: `Start with a 3D Medusa that includes ${formatCandidate(medusaStartCandidate(medusa))}, and colour it until it gets stuck.` }]
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
  // "a Skyscraper", "an X-Wing" - but a Colouring technique is named as a
  // method, not a thing: "is Simple Colouring", "is Dynamic Dragon Colouring".
  const article = /Colouring$/.test(label) ? '' : /^([AEIO]|X-)/.test(label) ? 'an ' : 'a '
  const intro: HintStep = {
    text: `The easiest technique available is ${article}${label}.${blurb ? ` ${blurb}` : ''}`,
    learn: tutorialTargetFor(instance.id) ?? undefined,
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
      text: `${prefix}Start a 3D Medusa from ${formatCandidate(start)}: colour it ${context.colorNames.blue}, then look for candidates that have a strong link relationship with it, and colour them in a different colour (we will use ${context.colorNames.yellow}), alternatively.`,
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
        text: `Your colouring is right so far (${outcome.added.length} more candidate${outcome.added.length === 1 ? '' : 's'} to colour). Next, see if you can spot what colour would ${formatCandidate(next.target)} be.`,
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
  const conclusion = ['mass-elimination', 'rule3', 'rule4', 'rule5', 'two-sided-colour', 'two-sided', 'solution'].includes(move.kind)
  if (conclusion) {
    const refs = [...move.eliminated, ...move.solved]
    const where =
      move.kind === 'mass-elimination' || move.kind === 'solution' || refs.length === 0
        ? 'Look for a contradiction between your colours.'
        : `Look at ${cellsText(uniqueCells(refs).slice(0, 4))}.`
    return [
      { text: `Your current colouring is enough to make a deduction. ${where}` },
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
