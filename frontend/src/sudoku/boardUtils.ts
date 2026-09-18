import type { Board, CandidateGrid } from './types'

const SIZE = 9

export function createEmptyBoard(): Board {
  return Array.from({ length: SIZE }, () => Array<number>(SIZE).fill(0))
}

export function cloneBoard(board: Board): Board {
  return board.map((row) => [...row])
}

/** Which cells were pre-filled (used to style them differently from user entries). */
export function computeGivenMask(board: Board): boolean[][] {
  return board.map((row) => row.map((value) => value !== 0))
}

export function createEmptyCandidates(): CandidateGrid {
  return Array.from({ length: SIZE }, () =>
    Array.from({ length: SIZE }, () => Array<boolean>(SIZE).fill(false)),
  )
}

export function cloneCandidates(candidates: CandidateGrid): CandidateGrid {
  return candidates.map((row) => row.map((cell) => [...cell]))
}

/** Which digits (1-9) are marked as candidates in a single cell. */
export function markedCandidateDigits(cellCandidates: readonly boolean[]): number[] {
  const digits: number[] = []
  for (let i = 0; i < cellCandidates.length; i++) {
    if (cellCandidates[i]) {
      digits.push(i + 1)
    }
  }
  return digits
}
