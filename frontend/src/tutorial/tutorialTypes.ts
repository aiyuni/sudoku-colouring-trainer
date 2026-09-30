import type { Board, CandidateGrid } from '../sudoku/types'

/** The first four are Dragon Colouring's usual colours; the last four are a
 * Double Dragon's second Dragon (pink/purple, lime green/dark green). */
export type TutorialColor = 'blue' | 'yellow' | 'darkBlue' | 'orange' | 'pink' | 'purple' | 'limeGreen' | 'darkGreen'
/** The same hexes as the technique-* colour classes (App.css), for the two
 * halves of a split pip and the colour key's split swatch - App.tsx's
 * DRAGON_HIGHLIGHT_HEX draws the board's split pips the same way. */
export const TUTORIAL_COLOUR_HEX: Record<TutorialColor, string> = {
  blue: '#38bdf8',
  yellow: '#fde047',
  darkBlue: '#1d4ed8',
  orange: '#fb923c',
  pink: '#e6a3e6',
  purple: '#9313b5',
  limeGreen: '#7bc82c',
  darkGreen: '#3d5c0e',
}

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
  /** A candidate may appear in `coloured` twice, once per Dragon of a Double
   * Dragon (a first-Dragon candidate the second Dragon absorbs): it is then
   * drawn as a split pip, the first colour listed bottom-left. */
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
