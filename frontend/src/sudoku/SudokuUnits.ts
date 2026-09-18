import { BOARD_SIZE, BOX_SIZE } from './SudokuRules'

export type Cell = readonly [row: number, col: number]

/** Every row, column, and box, each as a list of its nine cells. */
export function sudokuUnits(): Cell[][] {
  const units: Cell[][] = []

  for (let row = 0; row < BOARD_SIZE; row++) {
    units.push(Array.from({ length: BOARD_SIZE }, (_, col) => [row, col] as Cell))
  }
  for (let col = 0; col < BOARD_SIZE; col++) {
    units.push(Array.from({ length: BOARD_SIZE }, (_, row) => [row, col] as Cell))
  }
  for (let box = 0; box < BOARD_SIZE; box++) {
    const boxRow = Math.floor(box / BOX_SIZE) * BOX_SIZE
    const boxCol = (box % BOX_SIZE) * BOX_SIZE
    const cells: Cell[] = []
    for (let dr = 0; dr < BOX_SIZE; dr++) {
      for (let dc = 0; dc < BOX_SIZE; dc++) {
        cells.push([boxRow + dr, boxCol + dc])
      }
    }
    units.push(cells)
  }

  return units
}
