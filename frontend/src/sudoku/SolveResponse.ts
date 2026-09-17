import type { Board } from './types'

export type SolveStatus = 'solved' | 'invalid' | 'unsolvable' | 'multiple'

/** Outcome of a solve attempt. Mirrors a typical API response shape, kept as a class for symmetry with a server-side model. */
export class SolveResponse {
  readonly solved: boolean
  readonly status: SolveStatus
  readonly message: string
  readonly board: Board | null

  private constructor(solved: boolean, status: SolveStatus, message: string, board: Board | null) {
    this.solved = solved
    this.status = status
    this.message = message
    this.board = board
  }

  static ok(board: Board): SolveResponse {
    return new SolveResponse(true, 'solved', 'Puzzle solved.', board)
  }

  static invalid(message: string): SolveResponse {
    return new SolveResponse(false, 'invalid', message, null)
  }

  static unsolvable(): SolveResponse {
    return new SolveResponse(false, 'unsolvable', 'No solution exists for this puzzle.', null)
  }

  static multiple(): SolveResponse {
    return new SolveResponse(
      false,
      'multiple',
      'This puzzle has more than one solution. Add more givens to make it unique.',
      null,
    )
  }
}
