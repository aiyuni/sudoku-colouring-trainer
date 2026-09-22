import type { DragonCandidateRef, DragonColor, DragonMove } from './SudokuDragonFinder'

/** Every candidate's colour as of `moves[0..stepIndex]` - a promotion move
 * overwrites an earlier colour for the same candidate rather than adding a
 * second one, so each candidate shows only its latest colour at that step.
 * Eliminated/solved candidates just accumulate.
 *
 * Shared by the Techniques panel's Dragon stepper (App.tsx) and the How It
 * Works tutorial, so both replay a move log identically.
 *
 * `includeCurrentMove` (default true, what every caller but the live
 * substep player wants) controls whether the move *at* `stepIndex` itself
 * counts, or only the moves before it. A Dynamic Dragon Colouring step's
 * own "substep" player (see App.tsx's DragonStepper) reveals that one
 * move's chained reasoning one technique at a time; until it reaches the
 * last technique, the move's own conclusion (the cell it colours) hasn't
 * been "revealed" yet, so this withholds it from the fold. */
export function foldDragonMoves(moves: DragonMove[], stepIndex: number, includeCurrentMove = true) {
  const colorByKey = new Map<string, { row: number; col: number; digit: number; color: DragonColor }>()
  const eliminatedCandidates: DragonCandidateRef[] = []
  const solvedCandidates: DragonCandidateRef[] = []

  const lastIndex = Math.min(stepIndex, moves.length - 1) - (includeCurrentMove ? 0 : 1)
  for (let i = 0; i <= lastIndex; i++) {
    const move = moves[i]
    for (const n of move.colored) {
      colorByKey.set(`${n.row},${n.col},${n.digit}`, n)
    }
    eliminatedCandidates.push(...move.eliminated)
    solvedCandidates.push(...move.solved)
  }

  const blueCandidates: DragonCandidateRef[] = []
  const yellowCandidates: DragonCandidateRef[] = []
  const darkBlueCandidates: DragonCandidateRef[] = []
  const orangeCandidates: DragonCandidateRef[] = []
  for (const n of colorByKey.values()) {
    const ref = { row: n.row, col: n.col, digit: n.digit }
    if (n.color === 'blue') blueCandidates.push(ref)
    else if (n.color === 'yellow') yellowCandidates.push(ref)
    else if (n.color === 'darkBlue') darkBlueCandidates.push(ref)
    else orangeCandidates.push(ref)
  }

  return { blueCandidates, yellowCandidates, darkBlueCandidates, orangeCandidates, eliminatedCandidates, solvedCandidates }
}
