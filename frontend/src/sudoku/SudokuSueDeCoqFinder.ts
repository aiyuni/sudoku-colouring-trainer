import type { CandidateElimination } from './SudokuPairFinder'
import { BOX_SIZE } from './SudokuRules'
import type { Cell } from './SudokuUnits'
import type { Board, CandidateGrid } from './types'

/**
 * Sue-de-Coq, basic variant only (HoDoKu's "Sue de Coq" page,
 * https://hodoku.sourceforge.net/en/tech_misc.php):
 *
 *  - C: 2 or 3 unsolved cells where a row (or column) crosses a box, holding
 *    exactly |C| + 2 candidates V between them (2 cells / 4 digits or
 *    3 cells / 5 digits).
 *  - L: a bivalue cell in the line, outside the box, both candidates from V.
 *  - B: a bivalue cell in the box, outside the line, both candidates from V
 *    and none of L's.
 *
 * Why it works: C's cells all share the line and the box, so they hold |C|
 * different digits of V. They can hold at most one of L's two digits (L sees
 * them all, and needs one of its own), and likewise at most one of B's. That
 * leaves at least |C| - 2 of their digits among V's other |C| - 2 - so C
 * holds every one of those, plus exactly one of L's and one of B's. Hence
 * L's digits are both in C + L (eliminate them from the rest of the line),
 * B's both in C + B (rest of the box), and the leftover digits in C (rest of
 * the line *and* the box).
 *
 * The extended forms (extra intersection candidates balanced by further
 * cells, line/box cells with candidates outside V, ALS instead of bivalue
 * cells) are deliberately not implemented, by request.
 *
 * C may be any 2 of 3 unsolved intersection cells; the third is then simply
 * one more cell of both the rest of the line and the rest of the box.
 */
export interface SueDeCoqInstance {
  lineKind: 'row' | 'col'
  /** 0-indexed row or column. */
  line: number
  /** 0-indexed box (row-major). */
  box: number
  /** The intersection cells, row-major. */
  cells: Cell[]
  /** V, ascending. */
  digits: number[]
  lineCell: Cell
  /** L's two digits, ascending. */
  lineDigits: number[]
  boxCell: Cell
  /** B's two digits, ascending. */
  boxDigits: number[]
  /** V minus L's and B's digits (empty for 2 intersection cells). */
  extraDigits: number[]
  eliminations: CandidateElimination[]
  /** Conclusion-free explanation, for the Techniques panel. */
  reasonText: string
}

export class SudokuSueDeCoqFinder {
  find(board: Board, candidates: CandidateGrid): SueDeCoqInstance[] {
    const maskOf = (row: number, col: number): number => {
      if (board[row][col] !== 0) return 0
      let mask = 0
      for (let d = 0; d < 9; d++) {
        if (candidates[row][col][d]) mask |= 1 << d
      }
      return mask
    }
    const masks = Array.from({ length: 9 }, (_, row) => Array.from({ length: 9 }, (_, col) => maskOf(row, col)))

    const found: SueDeCoqInstance[] = []
    for (let box = 0; box < 9; box++) {
      const boxRow = Math.floor(box / BOX_SIZE) * BOX_SIZE
      const boxCol = (box % BOX_SIZE) * BOX_SIZE
      const boxCells: Cell[] = []
      for (let r = boxRow; r < boxRow + BOX_SIZE; r++) {
        for (let c = boxCol; c < boxCol + BOX_SIZE; c++) boxCells.push([r, c])
      }
      for (const lineKind of ['row', 'col'] as const) {
        const firstLine = lineKind === 'row' ? boxRow : boxCol
        for (let line = firstLine; line < firstLine + BOX_SIZE; line++) {
          const lineCells: Cell[] = Array.from({ length: 9 }, (_, i): Cell => (lineKind === 'row' ? [line, i] : [i, line]))
          const inBox = ([r, c]: Cell) => Math.floor(r / BOX_SIZE) * BOX_SIZE === boxRow && Math.floor(c / BOX_SIZE) * BOX_SIZE === boxCol
          const inLine = ([r, c]: Cell) => (lineKind === 'row' ? r : c) === line
          const intersection = lineCells.filter((cell) => inBox(cell) && masks[cell[0]][cell[1]] !== 0)
          const lineRest = lineCells.filter((cell) => !inBox(cell) && masks[cell[0]][cell[1]] !== 0)
          const boxRest = boxCells.filter((cell) => !inLine(cell) && masks[cell[0]][cell[1]] !== 0)

          for (const cells of intersectionSubsets(intersection)) {
            const vMask = cells.reduce((m, [r, c]) => m | masks[r][c], 0)
            if (popcount(vMask) !== cells.length + 2) continue
            const inC = (cell: Cell) => cells.some(([r, c]) => r === cell[0] && c === cell[1])

            for (const lineCell of lineRest) {
              const lMask = masks[lineCell[0]][lineCell[1]]
              if (popcount(lMask) !== 2 || (lMask & ~vMask) !== 0) continue
              for (const boxCell of boxRest) {
                const bMask = masks[boxCell[0]][boxCell[1]]
                if (popcount(bMask) !== 2 || (bMask & ~vMask) !== 0 || (bMask & lMask) !== 0) continue
                const extraMask = vMask & ~lMask & ~bMask

                const eliminations: CandidateElimination[] = []
                const eliminate = (houseCells: Cell[], partner: Cell, digitMask: number) => {
                  for (const cell of houseCells) {
                    const [r, c] = cell
                    if (inC(cell) || (r === partner[0] && c === partner[1])) continue
                    const hit = masks[r][c] & digitMask
                    for (let d = 0; d < 9; d++) {
                      if ((hit & (1 << d)) !== 0 && !eliminations.some((e) => e.row === r && e.col === c && e.digit === d + 1)) {
                        eliminations.push({ row: r, col: c, digit: d + 1 })
                      }
                    }
                  }
                }
                eliminate(lineCells, lineCell, lMask | extraMask)
                eliminate(boxCells, boxCell, bMask | extraMask)
                if (eliminations.length === 0) continue

                eliminations.sort((a, b) => a.row - b.row || a.col - b.col || a.digit - b.digit)
                const instance: SueDeCoqInstance = {
                  lineKind,
                  line,
                  box,
                  cells,
                  digits: digitsOf(vMask),
                  lineCell,
                  lineDigits: digitsOf(lMask),
                  boxCell,
                  boxDigits: digitsOf(bMask),
                  extraDigits: digitsOf(extraMask),
                  eliminations,
                  reasonText: '',
                }
                instance.reasonText = sueDeCoqReasonText(instance)
                found.push(instance)
              }
            }
          }
        }
      }
    }
    return found
  }
}

/** Every 2- or 3-cell subset of the (up to 3) unsolved intersection cells. */
function intersectionSubsets(cells: Cell[]): Cell[][] {
  if (cells.length < 2) return []
  if (cells.length === 2) return [cells]
  return [cells, [cells[0], cells[1]], [cells[0], cells[2]], [cells[1], cells[2]]]
}

function popcount(mask: number): number {
  let n = 0
  for (let m = mask; m !== 0; m &= m - 1) n++
  return n
}

function digitsOf(mask: number): number[] {
  const digits: number[] = []
  for (let d = 0; d < 9; d++) if ((mask & (1 << d)) !== 0) digits.push(d + 1)
  return digits
}

const cellText = ([r, c]: Cell) => `r${r + 1}c${c + 1}`

/** "r7c1, r7c3 hold only 3459. Along with r7c7 (45) in row 7 and r8c3 (39)
 * in box 7, they lock 45 in row 7 and 39 in box 7" (+ ", and 7 in both" for
 * leftover digits). */
function sueDeCoqReasonText(s: SueDeCoqInstance): string {
  const join = (digits: number[]) => digits.join('')
  const lineName = `${s.lineKind === 'row' ? 'row' : 'column'} ${s.line + 1}`
  const boxName = `box ${s.box + 1}`
  return (
    `${s.cells.map(cellText).join(', ')} hold only ${join(s.digits)}. ` +
    `Along with ${cellText(s.lineCell)} (${join(s.lineDigits)}) in ${lineName} and ${cellText(s.boxCell)} (${join(s.boxDigits)}) in ${boxName}, ` +
    `they lock ${join(s.lineDigits)} in ${lineName} and ${join(s.boxDigits)} in ${boxName}` +
    (s.extraDigits.length > 0 ? `, and ${join(s.extraDigits)} in both` : '')
  )
}
