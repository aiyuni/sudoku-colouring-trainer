export type Board = number[][]

/** Per-cell pencil marks: candidates[row][col][digit - 1] is true when that digit is noted. */
export type CandidateGrid = boolean[][][]

/** The nine manual highlight colours a user can paint onto a candidate -
 * purely a user annotation, independent of any solving technique. */
export type CandidateColor =
  | 'skyBlue'
  | 'paleYellow'
  | 'lightPink'
  | 'blue'
  | 'rust'
  | 'limeGreen'
  | 'purple'
  | 'darkGreen'
  | 'tan'

/** The colour palette's order (swatch 1 first) - what "Copy Puzzle As-Is"
 * stores a painted colour as, so a pasted string keeps each colour's place
 * in the palette whatever hex the swatches have been customized to. Must
 * match the swatch list in App.tsx; append new colours, never reorder, or
 * strings copied earlier paste back in the wrong colours. */
export const CANDIDATE_COLOR_ORDER: readonly CandidateColor[] = [
  'skyBlue',
  'paleYellow',
  'lightPink',
  'blue',
  'rust',
  'limeGreen',
  'purple',
  'darkGreen',
  'tan',
]

/** How a painted colour is drawn on its candidate pip. */
export type CandidatePaintShape = 'circle' | 'square' | 'diamond'

/** One colour painted on a candidate. The shape is captured when it's
 * painted (from that swatch's shape setting at the time), so changing a
 * swatch's shape later only affects what gets painted from then on -
 * unlike the swatch's hex, which is looked up at render time, so
 * recolouring a swatch still recolours everything painted with it. */
export interface CandidatePaintLayer {
  readonly color: CandidateColor
  readonly shape: CandidatePaintShape
}

/** The paint on one candidate: a single colour, or two (multicolour) -
 * the first fills the bottom-left half of the pip, the second the
 * top-right half. Treated as immutable: replace it, never push onto it,
 * since cloneCandidateColors only copies the outer arrays. */
export type CandidatePaint = readonly [CandidatePaintLayer] | readonly [CandidatePaintLayer, CandidatePaintLayer]

/** candidateColors[row][col][digit - 1] is the paint on that candidate,
 * or null if unpainted. Only meaningful where the matching CandidateGrid
 * entry is true - a candidate that's off or solved away shouldn't still
 * carry a colour. */
export type CandidateColorGrid = (CandidatePaint | null)[][][]

/** The puzzle a first visit opens on (givens drawn as a heart). Separate
 * from SAMPLE_PUZZLE, which the How It Works Basics lessons are built on -
 * changing that one would break them. */
export const DEFAULT_PUZZLE: Board = [
  [0, 2, 5, 0, 0, 0, 8, 6, 0],
  [3, 6, 0, 2, 0, 8, 0, 1, 7],
  [7, 0, 0, 0, 1, 0, 0, 0, 3],
  [6, 0, 0, 0, 0, 0, 0, 0, 2],
  [0, 4, 0, 0, 0, 0, 0, 9, 0],
  [0, 3, 0, 0, 0, 0, 0, 7, 0],
  [0, 0, 6, 0, 0, 0, 1, 0, 0],
  [0, 0, 0, 5, 0, 7, 0, 0, 0],
  [4, 9, 0, 0, 3, 0, 0, 5, 8],
]

export const SAMPLE_PUZZLE: Board = [
  [5, 3, 0, 0, 7, 0, 0, 0, 0],
  [6, 0, 0, 1, 9, 5, 0, 0, 0],
  [0, 9, 8, 0, 0, 0, 0, 6, 0],
  [8, 0, 0, 0, 6, 0, 0, 0, 3],
  [4, 0, 0, 8, 0, 3, 0, 0, 1],
  [7, 0, 0, 0, 2, 0, 0, 0, 6],
  [0, 6, 0, 0, 0, 0, 2, 8, 0],
  [0, 0, 0, 4, 1, 9, 0, 0, 5],
  [0, 0, 0, 0, 8, 0, 0, 7, 9],
]
