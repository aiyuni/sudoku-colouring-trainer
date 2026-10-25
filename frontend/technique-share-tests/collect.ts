/**
 * Real Dragon rows for the technique share link tests: the stock positions
 * walked Easy-Solve style with the app's own engine, keeping the first rows
 * of each Dragon kind met on the way (with the grid each was found on).
 */
import { buildTechniqueInstances, fullTechniqueEffect, pickEasiestInstance, type TechniqueInstance } from '../src/techniqueEngine'
import { DEFAULT_RULE3_TECHNIQUES, type Rule3Technique } from '../src/sudoku/SudokuDragonFinder'
import { DYNAMIC_DRAGON_PUZZLE_STOCK } from '../src/sudoku/dynamicDragonPuzzleStockData'
import { DOUBLE_DRAGON_PUZZLE_STOCK } from '../src/sudoku/doubleDragonPuzzleStockData'
import { SudokuRules } from '../src/sudoku/SudokuRules'
import { shareableDragonKind, type SharedDragonKind } from '../src/techniqueShareLink'
import type { Board, CandidateGrid } from '../src/sudoku/types'

export interface FoundDragon {
  board: Board
  givens: boolean[][]
  candidates: CandidateGrid
  instance: TechniqueInstance
  kind: SharedDragonKind
}

export interface CollectSettings {
  allowed: ReadonlySet<Rule3Technique>
  exhaustive: boolean
  doubleDragon: boolean
  doubleDynamic: boolean
}

export const TEST_SETTINGS: CollectSettings = {
  allowed: new Set(DEFAULT_RULE3_TECHNIQUES),
  exhaustive: true,
  doubleDragon: true,
  doubleDynamic: true,
}

const parse = (line: string): Board => Array.from({ length: 9 }, (_, r) => Array.from({ length: 9 }, (_, c) => Number(line[r * 9 + c]) || 0))
const autofill = (board: Board): CandidateGrid =>
  board.map((row, r) => row.map((v, c) => Array.from({ length: 9 }, (_, d) => v === 0 && SudokuRules.isSafe(board, r, c, d + 1))))

export function techniqueList(board: Board, candidates: CandidateGrid, givens: boolean[][], s: CollectSettings): TechniqueInstance[] {
  return buildTechniqueInstances(
    board,
    candidates,
    0,
    s.allowed,
    false,
    false,
    true,
    s.exhaustive,
    false,
    false,
    false,
    true,
    new Set(),
    false,
    Infinity,
    s.doubleDragon,
    s.doubleDynamic,
    givens,
  )
}

/** Up to `perKind` rows of each kind, from at most `puzzles` stock positions
 * (Double Dragon stock first: those are where the Double rows are). */
export function collectDragons(perKind: number, puzzles: number, s: CollectSettings = TEST_SETTINGS): FoundDragon[] {
  const found: FoundDragon[] = []
  const count = (kind: SharedDragonKind) => found.filter((f) => f.kind === kind).length
  const lines = [...DOUBLE_DRAGON_PUZZLE_STOCK.slice(0, Math.ceil(puzzles / 2)), ...DYNAMIC_DRAGON_PUZZLE_STOCK.slice(0, Math.floor(puzzles / 2))]
  for (const line of lines) {
    const board = parse(line)
    const givens = board.map((row) => row.map((v) => v !== 0))
    const cands = autofill(board)
    for (let step = 0; step < 80 && board.some((r) => r.includes(0)); step++) {
      const instances = techniqueList(board, cands, givens, s)
      for (const instance of instances) {
        const kind = shareableDragonKind(instance)
        if (kind && count(kind) < perKind) {
          found.push({
            board: board.map((r) => [...r]),
            givens: givens.map((r) => [...r]),
            candidates: cands.map((r) => r.map((c) => [...c])),
            instance,
            kind,
          })
        }
      }
      if ((['dragon', 'dynamic-dragon', 'double-dragon', 'double-dynamic-dragon'] as const).every((k) => count(k) >= perKind)) {
        return found
      }
      const chosen = pickEasiestInstance(instances)
      if (!chosen) break
      const effect = fullTechniqueEffect(chosen)
      for (const { row, col, digit } of effect.solvedCandidates) {
        board[row][col] = digit
        cands[row][col] = Array(9).fill(false)
        SudokuRules.eliminatePeerCandidates(cands, board, row, col, digit)
      }
      for (const { row, col, digit } of effect.eliminatedCandidates) cands[row][col][digit - 1] = false
    }
  }
  return found
}
