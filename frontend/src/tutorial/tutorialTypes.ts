import type { Board, CandidateGrid } from '../sudoku/types'

export type TutorialColor = 'blue' | 'yellow' | 'darkBlue' | 'orange'
export type TutorialCell = readonly [row: number, col: number]

export interface CandRef {
  row: number
  col: number
  digit: number
}

export interface ColouredCand extends CandRef {
  color: TutorialColor
}

export interface TutorialLink {
  from: CandRef
  to: CandRef
  /** 'strong': the two candidates can't both be false (a strong link) - drawn
   * as the app's usual red line, with an arrowhead when it shows which one
   * the colouring came from. 'sees': a dashed line joining a candidate to
   * something it can see, used to show why an elimination follows. */
  kind: 'strong' | 'sees'
  arrow?: boolean
}

/** One picture in a lesson: the same puzzle, with a different set of things
 * lit up. Everything is cumulative *as authored* - a frame lists exactly
 * what should be visible in it, so frames can be shown in any order or all
 * at once. */
export interface TutorialFrame {
  /** One short sentence. */
  caption: string
  /** A tiny label above the caption ("Colour", "Extend", "Result"...). */
  badge?: string
  coloured?: ColouredCand[]
  /** Candidates that just appeared in this step - ringed so the eye goes
   * straight to them. */
  fresh?: CandRef[]
  /** A technique's basis (yellow pips), for the non-colouring lessons. */
  basis?: CandRef[]
  eliminated?: CandRef[]
  solved?: CandRef[]
  outlineCells?: TutorialCell[]
  /** Green inset border - the cells a Dynamic Dragon step's helper technique
   * (a naked pair, a Unique Rectangle...) is built on. */
  greenCells?: TutorialCell[]
  /** A light tint over a whole row/column/box. */
  unitCells?: TutorialCell[]
  links?: TutorialLink[]
  /** Dim every candidate that isn't covered by one of these, so the digit(s)
   * or cell(s) the step is about stand out. Nothing is dimmed if omitted.
   * Coloured/basis/eliminated/solved/fresh candidates are never dimmed. */
  spotlight?: { digits?: number[]; cells?: TutorialCell[] }
  /** Show the outcome as already applied: solved candidates become placed
   * digits (with their peers' candidates cleared) and eliminated candidates
   * disappear, instead of being marked red/green. */
  applied?: boolean
}

export interface PuzzleState {
  board: Board
  givens: boolean[][]
  candidates: CandidateGrid
}

export interface TutorialLesson {
  id: string
  title: string
  /** One line under the title, shown when a tab has several lessons. */
  hint?: string
  state: PuzzleState
  frames: TutorialFrame[]
}
