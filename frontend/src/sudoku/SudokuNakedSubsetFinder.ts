import { markedCandidateDigits } from './boardUtils'
import type { CandidateElimination } from './SudokuPairFinder'
import { sudokuUnits, type Cell } from './SudokuUnits'
import type { Board, CandidateGrid } from './types'

export interface NakedSubsetInstance {
  size: 3 | 4
  /** The N cells sharing (between them) exactly N candidate digits. */
  cells: Cell[]
  /** The N candidates, ascending. */
  digits: number[]
  /** Every currently-marked candidate this subset proves can't be there. */
  eliminations: CandidateElimination[]
}

/**
 * Naked triples/quads: the same idea as naked pairs, generalized to three or
 * four cells - if N cells in the same row, column, or box collectively use
 * only N candidate digits between them (each cell holding some non-empty
 * subset of those N, and nothing else), those N cells must fill exactly
 * those N digits, in some order - so none of them can appear anywhere else
 * in that unit, and get eliminated from the unit's other cells.
 */
export class SudokuNakedSubsetFinder {
  findNakedTriples(board: Board, candidates: CandidateGrid): NakedSubsetInstance[] {
    return this.findNakedSubsets(board, candidates, 3)
  }

  findNakedQuads(board: Board, candidates: CandidateGrid): NakedSubsetInstance[] {
    return this.findNakedSubsets(board, candidates, 4)
  }

  findNakedTripleEliminations(board: Board, candidates: CandidateGrid): CandidateElimination[] {
    return this.dedupeEliminations(this.findNakedTriples(board, candidates))
  }

  findNakedQuadEliminations(board: Board, candidates: CandidateGrid): CandidateElimination[] {
    return this.dedupeEliminations(this.findNakedQuads(board, candidates))
  }

  private dedupeEliminations(instances: NakedSubsetInstance[]): CandidateElimination[] {
    const eliminations = new Map<string, CandidateElimination>()
    for (const instance of instances) {
      for (const elimination of instance.eliminations) {
        eliminations.set(`${elimination.row},${elimination.col},${elimination.digit}`, elimination)
      }
    }
    return Array.from(eliminations.values())
  }

  private findNakedSubsets(board: Board, candidates: CandidateGrid, size: 3 | 4): NakedSubsetInstance[] {
    const seen = new Set<string>()
    const instances: NakedSubsetInstance[] = []

    for (const unit of sudokuUnits()) {
      const unsolvedCells = unit.filter(([row, col]) => board[row][col] === 0)
      const eligibleCells = unsolvedCells.filter(([row, col]) => {
        const count = markedCandidateDigits(candidates[row][col]).length
        return count >= 2 && count <= size
      })

      for (const combo of this.combinations(eligibleCells, size)) {
        const digitSet = new Set<number>()
        for (const [row, col] of combo) {
          for (const digit of markedCandidateDigits(candidates[row][col])) {
            digitSet.add(digit)
          }
        }
        if (digitSet.size !== size) {
          continue
        }
        const digits = Array.from(digitSet).sort((a, b) => a - b)

        const eliminations: CandidateElimination[] = []
        for (const [row, col] of unsolvedCells) {
          if (combo.some(([cr, cc]) => cr === row && cc === col)) {
            continue
          }
          for (const digit of digits) {
            if (candidates[row][col][digit - 1]) {
              eliminations.push({ row, col, digit })
            }
          }
        }
        if (eliminations.length === 0) {
          continue
        }

        // The same N cells can turn up via more than one unit (e.g. three
        // cells spanning one row and also all sitting in one box) - dedupe
        // so the panel doesn't list the identical subset twice.
        const key = `${combo
          .map(([r, c]) => `${r}.${c}`)
          .sort()
          .join('-')}|${digits.join(',')}`
        if (seen.has(key)) {
          continue
        }
        seen.add(key)

        instances.push({ size, cells: [...combo], digits, eliminations })
      }
    }

    return instances
  }

  private combinations(items: Cell[], size: number): Cell[][] {
    if (size === 0) {
      return [[]]
    }
    const results: Cell[][] = []
    const pick = (start: number, chosen: Cell[]) => {
      if (chosen.length === size) {
        results.push([...chosen])
        return
      }
      for (let i = start; i < items.length; i++) {
        chosen.push(items[i])
        pick(i + 1, chosen)
        chosen.pop()
      }
    }
    pick(0, [])
    return results
  }
}
