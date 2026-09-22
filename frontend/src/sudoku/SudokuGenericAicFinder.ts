import type { Board, CandidateGrid } from './types'
import {
  SHORT_AIC_MAX_LENGTH,
  buildLinkGraphs,
  computeEliminations,
  pickBestPerEliminationSet,
  type AicLink,
  type LinkGraphs,
  type ShortAicInstance,
} from './SudokuShortAicFinder'

/**
 * ============================================================================
 *  GENERIC AIC - LONGEST CHAIN TO LOOK FOR
 * ============================================================================
 * The one number to change: how many *links* the longest Generic AIC may have.
 * An AIC always has an odd number of links (strong, weak, strong, ...,
 * strong), so useful values are 7, 9, 11, 13, ... - it must be above 5, since
 * chains up to 5 links are Short AIC's (SudokuShortAicFinder). Even values are
 * rounded down to the odd number below.
 *
 * Bigger finds more (and harder) eliminations but searches more of the board
 * on every run: the search happens each time the Techniques panel refreshes
 * and, inside Dynamic Dragon Colouring, up to once per colouring step. See
 * the timings below.
 *
 * Timing (measured): the search is breadth-first, so its cost stays roughly
 * flat as the limit rises - under 1 ms per run on realistic hard positions and
 * on the sparsest boards at every limit from 7 to 15, and it matched an
 * exhaustive depth-first search exactly at 7 and 9. So the default is chosen
 * for readability, not speed: 11 links is about the longest chain a person can
 * still follow. Raise it freely if you want longer chains.
 */
export const GENERIC_AIC_MAX_LENGTH = 11

/**
 * Generic AIC: alternating inference chains too long for Short AIC. Same idea
 * as SudokuShortAicFinder - strong, weak, strong, ..., strong links joining
 * candidates X ... Y, so that if X is false Y is true - but with any odd number
 * of links from 7 up to `maxLength`, and the same two eliminations follow
 * (Type 1: a cell seeing two same-digit ends; Type 2: ends of different digits
 * that see each other).
 *
 * Search: one breadth-first pass per starting candidate over states "reached
 * by a strong link" / "reached by a weak link". Breadth-first order means each
 * (start, end) pair is first met by its *shortest* chain, so a pair reachable
 * in 5 links or fewer is left to Short AIC rather than reported here as a
 * longer, worse chain. Only candidates that have a strong link somewhere can
 * sit at a chain's ends or inside it, which is what keeps the search small.
 *
 * Chains that would visit the same candidate twice are dropped rather than
 * repaired, matching Short AIC's "distinct candidates" rule; when several
 * chains reach the same eliminations the shortest wins (ties: more conjugate
 * pairs, fewer same-cell links).
 */
export class SudokuGenericAicFinder {
  /** `graphs` lets a caller that's already run Short AIC on the same board/
   * candidates (Dynamic Dragon's Extension Rule 3 - see aicsInOrder in
   * SudokuDragonFinder) pass in that same link graph instead of having it
   * rebuilt here from scratch. Defaults to building it here, so every other
   * caller is unaffected. */
  findGenericAics(
    board: Board,
    candidates: CandidateGrid,
    maxLength: number = GENERIC_AIC_MAX_LENGTH,
    graphs?: LinkGraphs,
  ): ShortAicInstance[] {
    // Chains have an odd number of links; round an even limit down.
    const limit = maxLength % 2 === 0 ? maxLength - 1 : maxLength
    if (limit <= SHORT_AIC_MAX_LENGTH) {
      return []
    }

    const { strongAdjacency, weakAdjacency, nodeByKey } = graphs ?? buildLinkGraphs(board, candidates)

    // Integer ids for the nodes that can be part of an AIC at all (those with
    // a strong link) - every inner loop below is then plain array indexing.
    const keys = Array.from(strongAdjacency.keys())
    const idOf = new Map<string, number>(keys.map((key, id) => [key, id]))
    const n = keys.length
    const strong: number[][] = keys.map((key) => strongAdjacency.get(key)!.map((k) => idOf.get(k)!))
    const weak: number[][] = keys.map((key) =>
      (weakAdjacency.get(key) ?? []).flatMap((k) => {
        const id = idOf.get(k)
        return id === undefined ? [] : [id]
      }),
    )
    const nodes = keys.map((key) => nodeByKey.get(key)!)

    // Per-start bookkeeping, reset by bumping `stamp` instead of refilling.
    const seenStrong = new Int32Array(n) // reached by a strong link this pass
    const seenWeak = new Int32Array(n) // reached by a weak link this pass
    const fromStrong = new Int32Array(n) // the weak-reached node a strong-reached one came from
    const fromWeak = new Int32Array(n) // the strong-reached node a weak-reached one came from
    let stamp = 0

    const reportedPairs = new Set<number>()
    const instances: ShortAicInstance[] = []

    for (let start = 0; start < n; start++) {
      stamp++
      seenStrong[start] = stamp // never revisit the start itself
      seenWeak[start] = stamp

      let frontier: number[] = []
      for (const a of strong[start]) {
        if (seenStrong[a] !== stamp) {
          seenStrong[a] = stamp
          fromStrong[a] = start
          frontier.push(a)
        }
      }

      // `frontier` holds candidates first reached by a strong link at `length`.
      for (let length = 1; length < limit && frontier.length > 0; length += 2) {
        const viaWeak: number[] = []
        for (const a of frontier) {
          for (const b of weak[a]) {
            if (seenWeak[b] !== stamp) {
              seenWeak[b] = stamp
              fromWeak[b] = a
              viaWeak.push(b)
            }
          }
        }
        const next: number[] = []
        for (const b of viaWeak) {
          for (const y of strong[b]) {
            if (seenStrong[y] === stamp) {
              continue
            }
            seenStrong[y] = stamp
            fromStrong[y] = b
            next.push(y)

            const endLength = length + 2
            if (endLength <= SHORT_AIC_MAX_LENGTH) {
              continue // Short AIC's chain, not this finder's
            }
            const pairKey = start < y ? start * n + y : y * n + start
            if (reportedPairs.has(pairKey)) {
              continue
            }

            // Walk back to the start: y <- b <- a <- b' <- ... <- start.
            const path: number[] = [y]
            for (let at = y; at !== start; ) {
              at = path.length % 2 === 1 ? fromStrong[at] : fromWeak[at]
              path.push(at)
            }
            path.reverse()
            if (new Set(path).size !== path.length) {
              continue
            }

            const outcome = computeEliminations(board, candidates, nodes[start], nodes[y])
            if (!outcome) {
              continue
            }
            reportedPairs.add(pairKey)

            const chain = path.map((id) => nodes[id])
            const links: AicLink[] = []
            for (let i = 0; i < chain.length - 1; i++) {
              links.push({ from: chain[i], to: chain[i + 1], kind: i % 2 === 0 ? 'strong' : 'weak' })
            }
            instances.push({
              nodes: chain,
              links,
              length: endLength,
              isSingleDigit: chain.every((node) => node.digit === chain[0].digit),
              eliminationType: outcome.type,
              eliminations: outcome.eliminations,
            })
          }
        }
        frontier = next
      }
    }

    return pickBestPerEliminationSet(instances)
  }
}
