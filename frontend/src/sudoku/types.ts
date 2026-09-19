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

/** candidateColors[row][col][digit - 1] is the colour painted on that
 * candidate, or null if unpainted. Only meaningful where the matching
 * CandidateGrid entry is true - a candidate that's off or solved away
 * shouldn't still carry a colour. */
export type CandidateColorGrid = (CandidateColor | null)[][][]

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
