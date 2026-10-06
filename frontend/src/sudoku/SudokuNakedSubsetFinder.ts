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

  /** Triples and quads computed together, sharing the per-unit scan for
   * cells with 2-4 marked candidates (a triple's eligible cells are just
   * that set narrowed to <=3) instead of each doing its own full pass over
   * every unit. Dynamic Dragon's Extension Rule 3 simulation calls both
   * back to back, unconditionally, on every step it reaches this far - with
   * the per-step AIC limit off that can be hundreds of times per Dragon
   * step, and the separate scans were a measurable chunk of it. Produces
   * the exact same instances (in the exact same order) as calling
   * findNakedTriples and findNakedQuads separately - kept as its own method
   * rather than replacing them, since most callers (the Techniques panel)
   * only ever need one size at a time and never benefit from the shared
   * scan. */
  findNakedTriplesAndQuads(
    board: Board,
    candidates: CandidateGrid,
  ): { triples: NakedSubsetInstance[]; quads: NakedSubsetInstance[] } {
    const triples: NakedSubsetInstance[] = []
    const quads: NakedSubsetInstance[] = []
    const seenTriples = new Map<string, NakedSubsetInstance>()
    const seenQuads = new Map<string, NakedSubsetInstance>()

    for (const unit of sudokuUnits()) {
      const unsolvedCells = unit.filter(([row, col]) => board[row][col] === 0)
      const eligibleFor4 = unsolvedCells.filter(([row, col]) => {
        const count = markedCandidateDigits(candidates[row][col]).length
        return count >= 2 && count <= 4
      })
      const eligibleFor3 = eligibleFor4.filter(
        ([row, col]) => markedCandidateDigits(candidates[row][col]).length <= 3,
      )

      this.emitSubsets(3, eligibleFor3, unsolvedCells, candidates, seenTriples, triples)
      this.emitSubsets(4, eligibleFor4, unsolvedCells, candidates, seenQuads, quads)
    }

    return { triples, quads }
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
    const seen = new Map<string, NakedSubsetInstance>()
    const instances: NakedSubsetInstance[] = []

    for (const unit of sudokuUnits()) {
      const unsolvedCells = unit.filter(([row, col]) => board[row][col] === 0)
      const eligibleCells = unsolvedCells.filter(([row, col]) => {
        const count = markedCandidateDigits(candidates[row][col]).length
        return count >= 2 && count <= size
      })

      this.emitSubsets(size, eligibleCells, unsolvedCells, candidates, seen, instances)
    }

    return instances
  }

  /** The shared body of findNakedSubsets: every `size`-combination of
   * `eligibleCells` that collectively uses exactly `size` digits becomes an
   * instance (deduped against `seen`, appended to `out`) - factored out so
   * findNakedTriplesAndQuads can run it against a pre-computed eligible set
   * per size without repeating the per-unit scan above it. */
  private emitSubsets(
    size: 3 | 4,
    eligibleCells: Cell[],
    unsolvedCells: Cell[],
    candidates: CandidateGrid,
    seen: Map<string, NakedSubsetInstance>,
    out: NakedSubsetInstance[],
  ): void {
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
      // cells spanning one row and also all sitting in one box): one
      // instance, so the panel doesn't list the identical subset twice,
      // holding both units' eliminations. (Until 2026-10-05 the second
      // unit's were dropped with the duplicate - a triple in a row and a box
      // never cleared the rest of the box - which is also why an ALS-AIC
      // restating such a triple stayed listed beside it.)
      const key = `${combo
        .map(([r, c]) => `${r}.${c}`)
        .sort()
        .join('-')}|${digits.join(',')}`
      const known = seen.get(key)
      if (known) {
        for (const elimination of eliminations) {
          if (!known.eliminations.some((e) => e.row === elimination.row && e.col === elimination.col && e.digit === elimination.digit)) {
            known.eliminations.push(elimination)
          }
        }
        continue
      }
      const instance: NakedSubsetInstance = { size, cells: [...combo], digits, eliminations }
      seen.set(key, instance)
      out.push(instance)
    }
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
