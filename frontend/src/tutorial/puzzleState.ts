import { cloneBoard, cloneCandidates, createEmptyCandidates } from '../sudoku/boardUtils'
import { BOARD_SIZE, SudokuRules } from '../sudoku/SudokuRules'
import type { Board, CandidateGrid } from '../sudoku/types'
import type { CandRef, PuzzleState, TutorialFrame } from './tutorialTypes'

const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9]

/** Builds a tutorial position from the two pieces the example lists in
 * tutorialExamples.ts store: an 81-character board ('0' = empty, row by row)
 * and, optionally, the pencil marks that have already been removed from a
 * plain "every legal digit" autofill, written the way the app writes cells
 * ("r3c4-5 r3c4-9" = 5 and 9 removed from r3c4).
 *
 * Pencil marks are app state, not something derivable from the board - the
 * finders trust them as given - so this is what makes a mid-solve position
 * reproducible from a short string. */
export function decodePuzzleState(boardString: string, removed = ''): PuzzleState {
  if (!/^[0-9]{81}$/.test(boardString)) {
    throw new Error('A tutorial board must be exactly 81 digits (0 for an empty cell).')
  }
  const board: Board = Array.from({ length: BOARD_SIZE }, (_, r) =>
    Array.from({ length: BOARD_SIZE }, (_, c) => Number(boardString[r * BOARD_SIZE + c])),
  )
  const candidates = createEmptyCandidates()
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] === 0) {
        candidates[r][c] = DIGITS.map((d) => SudokuRules.isSafe(board, r, c, d))
      }
    }
  }
  for (const token of removed.split(/\s+/).filter(Boolean)) {
    const match = /^r([1-9])c([1-9])-([1-9])$/.exec(token)
    if (!match) {
      throw new Error(`Bad removed-candidate "${token}" - expected something like r3c4-5.`)
    }
    candidates[Number(match[1]) - 1][Number(match[2]) - 1][Number(match[3]) - 1] = false
  }
  const givens = board.map((row) => row.map((value) => value !== 0))
  return { board, givens, candidates }
}

/** The board and pencil marks a frame should draw. For an `applied` frame
 * that's the state *after* its solves and eliminations - placed digits,
 * their peers' marks cleared, eliminated marks gone; otherwise it's the
 * position untouched (the frame marks the same things in red/green
 * instead). */
export function stateForFrame(
  state: PuzzleState,
  frame: TutorialFrame,
): { board: Board; candidates: CandidateGrid; placed: Set<string> } {
  const placed = new Set<string>()
  if (!frame.applied) {
    return { board: state.board, candidates: state.candidates, placed }
  }
  const board = cloneBoard(state.board)
  const candidates = cloneCandidates(state.candidates)
  for (const { row, col, digit } of frame.solved ?? []) {
    board[row][col] = digit
    candidates[row][col] = Array(9).fill(false)
    placed.add(`${row},${col}`)
  }
  for (const { row, col, digit } of frame.solved ?? []) {
    SudokuRules.eliminatePeerCandidates(candidates, board, row, col, digit)
  }
  for (const { row, col, digit } of frame.eliminated ?? []) {
    candidates[row][col][digit - 1] = false
  }
  return { board, candidates, placed }
}

export function candKey(ref: CandRef): string {
  return `${ref.row},${ref.col},${ref.digit}`
}
