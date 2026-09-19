import { cloneBoard, createEmptyCandidates } from './src/sudoku/boardUtils'
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
  for (let r = 0; r < BOARD_SIZE; r++)
    for (let c = 0; c < BOARD_SIZE; c++)
      if (board[r][c] === 0) candidates[r][c] = DIGITS.map((d) => SudokuRules.isSafe(board, r, c, d))
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
  for (const { row, col, digit } of eliminations) candidates[row][col][digit - 1] = false
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

function cellRef(row: number, col: number): string {
  return `r${row + 1}c${col + 1}`
}

async function main() {
  for (let trial = 0; trial < 30; trial++) {
    const puzzle = generator.generate()
    const solveResponse = solver.solve(cloneBoard(puzzle))
    if (!solveResponse.solved || !solveResponse.board) continue
    const solution = solveResponse.board

    const board = cloneBoard(puzzle)
    const candidates = createEmptyCandidates()
    grindToStuck(board, candidates)
    if (board.flat().every((v) => v !== 0)) continue

    for (const chain of medusaFinder.findChains(board, candidates)) {
      const stuck =
        medusaFinder.findMassElimination(chain, board, candidates) === null &&
        medusaFinder.findRule3Eliminations(chain, board, candidates).length === 0 &&
        medusaFinder.findRule4Eliminations(chain, candidates).length === 0 &&
        medusaFinder.findRule5Eliminations(chain, candidates).length === 0
      if (!stuck) continue
      const result = dragonFinder.extend(chain, board, candidates)
      if (!result) continue

      // check for bad moves
      let bad = false
      for (const move of result.moves) {
        for (const { row, col, digit } of move.eliminated) {
          if (solution[row][col] === digit) bad = true
        }
        for (const { row, col, digit } of move.solved) {
          if (solution[row][col] !== digit) bad = true
        }
      }
      if (!bad) continue

      console.log(`=== Trial ${trial}: BAD CHAIN FOUND ===`)
      console.log('Board:')
      for (let r = 0; r < 9; r++) console.log(board[r].join(' '))
      console.log('Solution:')
      for (let r = 0; r < 9; r++) console.log(solution[r].join(' '))
      console.log('Candidates:')
      for (let r = 0; r < 9; r++) {
        const row = []
        for (let c = 0; c < 9; c++) {
          if (board[r][c] !== 0) row.push(String(board[r][c]))
          else {
            const digits = candidates[r][c].map((v, i) => (v ? i + 1 : null)).filter(Boolean)
            row.push(`[${digits.join('')}]`)
          }
        }
        console.log(row.join(' '))
      }
      console.log('Seed medusa chain:')
      for (const n of chain.candidates) console.log(`  ${n.digit}${cellRef(n.row, n.col)} = ${n.color}`)
      console.log('Move log:')
      for (const move of result.moves) {
        console.log(`  [${move.kind}] ${move.description}`)
        for (const c of move.colored) console.log(`      colored: ${c.digit}${cellRef(c.row, c.col)} = ${c.color}`)
        for (const e of move.eliminated) console.log(`      eliminated: ${e.digit}${cellRef(e.row, e.col)} (truth=${solution[e.row][e.col]})`)
        for (const s of move.solved) console.log(`      solved: ${s.digit}${cellRef(s.row, s.col)} (truth=${solution[s.row][s.col]})`)
      }
      console.log('=== END ===')
      process.exit(0)
    }
  }
  console.log('No bad chain found in 30 trials.')
}

main()
