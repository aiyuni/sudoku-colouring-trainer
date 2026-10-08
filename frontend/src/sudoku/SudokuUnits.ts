/** Every row, column, and box, each as a list of its nine cells - and, since
 * the Variant solver, which cells make up a "box" at all: the 3x3 boxes of a
 * Classic Sudoku or a Jigsaw's regions. Both live in SudokuConstraints.ts
 * (the active constraint model); this file is the name the finders have
 * always imported them by. */
export { sudokuUnits, boxOf, sameBox, boxCells, seesCell, housePeersOf, isStandardLayout, boxWord, unitLabel, sharesHouseOrLink } from './SudokuConstraints'
export type { Cell } from './SudokuConstraints'
