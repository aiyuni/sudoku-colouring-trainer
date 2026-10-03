// "Independent" Double (Dynamic) Dragons, the user's rule for generated puzzles (2026-10-02): the second
// Dragon's Medusa must not start on any candidate the first Dragon coloured (its whole stuck colouring,
// Medusa included). A shared *cell* is fine as long as the digit differs - the user chose "no shared
// candidate" over the stricter "no shared cell".
import type { DragonMove } from 'C:/Git/sudoku-solver/frontend/src/sudoku/SudokuDragonFinder'

const key = (n: { row: number; col: number; digit: number }) => `${n.row},${n.col},${n.digit}`

/** A Double Dragon move log (first Dragon's moves, then the 'second-medusa' move, then the second Dragon's)
 * whose second Medusa shares no candidate with the first Dragon's colouring. */
export function isIndependentDoubleDragon(moves: readonly DragonMove[]): boolean {
  const start = moves.findIndex((m) => m.id === 'second-medusa')
  if (start < 0) return false
  const first = new Set(moves.slice(0, start).flatMap((m) => m.colored).map(key))
  return moves[start].colored.every((n) => !first.has(key(n)))
}
