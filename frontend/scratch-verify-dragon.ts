import { markedCandidateDigits, cloneBoard, cloneCandidates, createEmptyCandidates } from './src/sudoku/boardUtils'
import { SudokuColorFinder } from './src/sudoku/SudokuColorFinder'
import { SudokuDragonFinder } from './src/sudoku/SudokuDragonFinder'
import { SudokuGenerator } from './src/sudoku/SudokuGenerator'
import { SudokuMedusaFinder } from './src/sudoku/SudokuMedusaFinder'
import { SudokuPairFinder } from './src/sudoku/SudokuPairFinder'
import { SudokuRules } from './src/sudoku/SudokuRules'
import { SudokuSingleFinder } from './src/sudoku/SudokuSingleFinder'
import { SudokuSolver } from './src/sudoku/SudokuSolver'
import type { Board, CandidateGrid } from './src/sudoku/types'

const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9]
const BOARD_SIZE = 9

const generator = new SudokuGenerator()
const solver = new SudokuSolver()
const singleFinder = new SudokuSingleFinder()
const pairFinder = new SudokuPairFinder()
const colorFinder = new SudokuColorFinder()
const medusaFinder = new SudokuMedusaFinder()
const dragonFinder = new SudokuDragonFinder()

function autofill(board: Board, candidates: CandidateGrid) {
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] === 0) {
        candidates[r][c] = DIGITS.map((d) => SudokuRules.isSafe(board, r, c, d))
      }
    }
  }
}

function applySingles(board: Board, candidates: CandidateGrid): boolean {
  const assignments = singleFinder.findNakedAndHiddenSingles(board, candidates)
  if (assignments.length === 0) return false
  for (const { row, col, digit } of assignments) {
    board[row][col] = digit
    candidates[row][col] = Array(9).fill(false)
    SudokuRules.eliminatePeerCandidates(candidates, board, row, col, digit)
  }
  return true
}

function applyNakedPairs(board: Board, candidates: CandidateGrid): boolean {
  const eliminations = pairFinder.findNakedPairEliminations(board, candidates)
  if (eliminations.length === 0) return false
  for (const { row, col, digit } of eliminations) {
    candidates[row][col][digit - 1] = false
  }
  return true
}

function applySimpleColoring(board: Board, candidates: CandidateGrid): boolean {
  let changed = false
  for (const digit of DIGITS) {
    for (const chain of colorFinder.findChains(board, candidates, digit)) {
      const rule1 = colorFinder.findRule1(chain)
      if (rule1) {
        for (const [row, col] of rule1.solvedCells) {
          board[row][col] = digit
          candidates[row][col] = Array(9).fill(false)
          SudokuRules.eliminatePeerCandidates(candidates, board, row, col, digit)
          changed = true
        }
      }
      const rule2 = colorFinder.findRule2(chain, board, candidates)
      if (rule2) {
        for (const [row, col] of rule2.eliminatedCells) {
          if (candidates[row][col][digit - 1]) {
            candidates[row][col][digit - 1] = false
            changed = true
          }
        }
      }
    }
  }
  return changed
}

function applyMedusa(board: Board, candidates: CandidateGrid): boolean {
  let changed = false
  for (const chain of medusaFinder.findChains(board, candidates)) {
    const mass = medusaFinder.findMassElimination(chain, board, candidates)
    if (mass) {
      for (const { row, col, digit } of mass.solvedCells) {
        if (board[row][col] === 0) {
          board[row][col] = digit
          candidates[row][col] = Array(9).fill(false)
          SudokuRules.eliminatePeerCandidates(candidates, board, row, col, digit)
          changed = true
        }
      }
      for (const { row, col, digit } of mass.eliminatedCandidates) {
        if (board[row][col] === 0 && candidates[row][col][digit - 1]) {
          candidates[row][col][digit - 1] = false
          changed = true
        }
      }
    }
    for (const r3 of medusaFinder.findRule3Eliminations(chain, board, candidates)) {
      if (candidates[r3.row][r3.col][r3.digit - 1]) {
        candidates[r3.row][r3.col][r3.digit - 1] = false
        changed = true
      }
    }
    for (const r4 of medusaFinder.findRule4Eliminations(chain, candidates)) {
      for (const digit of r4.eliminatedDigits) {
        if (candidates[r4.row][r4.col][digit - 1]) {
          candidates[r4.row][r4.col][digit - 1] = false
          changed = true
        }
      }
    }
    for (const r5 of medusaFinder.findRule5Eliminations(chain, candidates)) {
      if (candidates[r5.row][r5.col][r5.eliminatedDigit - 1]) {
        candidates[r5.row][r5.col][r5.eliminatedDigit - 1] = false
        changed = true
      }
    }
  }
  return changed
}

function grindToStuck(board: Board, candidates: CandidateGrid) {
  autofill(board, candidates)
  for (;;) {
    if (applySingles(board, candidates)) continue
    if (applyNakedPairs(board, candidates)) continue
    if (applySimpleColoring(board, candidates)) continue
    if (applyMedusa(board, candidates)) continue
    break
  }
}

function computeStuckDragonExtensions(board: Board, candidates: CandidateGrid) {
  const results: Array<{ moves: ReturnType<typeof dragonFinder.extend> extends infer R ? (R extends { moves: infer M } ? M : never) : never }> = []
  for (const chain of medusaFinder.findChains(board, candidates)) {
    const stuck =
      medusaFinder.findMassElimination(chain, board, candidates) === null &&
      medusaFinder.findRule3Eliminations(chain, board, candidates).length === 0 &&
      medusaFinder.findRule4Eliminations(chain, candidates).length === 0 &&
      medusaFinder.findRule5Eliminations(chain, candidates).length === 0
    if (!stuck) continue
    const result = dragonFinder.extend(chain, board, candidates)
    if (!result) continue
    results.push({ moves: result.moves })
  }
  return results
}

function cellRef(row: number, col: number): string {
  return `r${row + 1}c${col + 1}`
}

async function main() {
  const TRIALS = 400
  let dragonFirings = 0
  let totalMoves = 0
  let badSolve = 0
  let badElimination = 0
  let structuralIssues = 0

  for (let trial = 0; trial < TRIALS; trial++) {
    const puzzle = generator.generate()
    const solveResponse = solver.solve(cloneBoard(puzzle))
    if (!solveResponse.solved || !solveResponse.board) {
      continue
    }
    const solution = solveResponse.board

    const board = cloneBoard(puzzle)
    const candidates = createEmptyCandidates()
    grindToStuck(board, candidates)

    if (board.flat().every((v) => v !== 0)) {
      continue // fully solved by simpler techniques - nothing for Dragon to do
    }

    const dragonChains = computeStuckDragonExtensions(board, candidates)
    if (dragonChains.length === 0) {
      continue
    }

    dragonFirings++

    for (const { moves } of dragonChains) {
      totalMoves += moves.length

      // Structural checks on the move log itself.
      if (moves[0].kind !== 'medusa') {
        structuralIssues++
        console.log(`Trial ${trial}: first move is not the medusa seed (${moves[0].kind}).`)
      }
      const lastMove = moves[moves.length - 1]
      if (!['mass-elimination', 'rule3', 'rule4', 'rule5'].includes(lastMove.kind) && moves.every(m => m.eliminated.length === 0 && m.solved.length === 0)) {
        structuralIssues++
        console.log(`Trial ${trial}: no elimination/solve moves present despite being surfaced.`)
      }

      // Cross-validate every solved/eliminated candidate against the puzzle's
      // unique ground-truth solution (from SudokuSolver, independent of any
      // coloring logic).
      for (const move of moves) {
        for (const { row, col, digit } of move.solved) {
          if (solution[row][col] !== digit) {
            badSolve++
            console.log(
              `Trial ${trial}: Dragon Colouring said ${cellRef(row, col)}=${digit} but the true solution is ${solution[row][col]}. Move: ${move.description}`,
            )
          }
        }
        for (const { row, col, digit } of move.eliminated) {
          if (solution[row][col] === digit) {
            badElimination++
            console.log(
              `Trial ${trial}: Dragon Colouring eliminated ${digit} from ${cellRef(row, col)}, but that IS the true solution. Move: ${move.description}`,
            )
          }
        }
      }
    }
  }

  console.log('---')
  console.log(`Trials: ${TRIALS}`)
  console.log(`Dragon Colouring fired on: ${dragonFirings} puzzles`)
  console.log(`Total moves logged: ${totalMoves}`)
  console.log(`Bad solves (contradicts true solution): ${badSolve}`)
  console.log(`Bad eliminations (removed the true digit): ${badElimination}`)
  console.log(`Structural issues: ${structuralIssues}`)
  if (badSolve === 0 && badElimination === 0 && structuralIssues === 0 && dragonFirings > 0) {
    console.log('PASS: every Dragon Colouring conclusion across all firings matched the puzzles\' true solutions.')
  } else if (dragonFirings === 0) {
    console.log('INCONCLUSIVE: Dragon Colouring never fired in this batch - try more trials or harder puzzles.')
  } else {
    console.log('FAIL: see logged issues above.')
  }
}

main()
