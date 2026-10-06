import { foldDragonMoves } from './dragonReplay'
import {
  isDynamicDragonMove,
  SudokuDragonFinder,
  type DragonCandidateRef,
  type DragonColor,
  type DragonExtendOptions,
  type DragonMove,
  type DragonNode,
  type Rule3Technique,
} from './SudokuDragonFinder'
import { listEffectiveEliminations } from './SudokuDragonTargetFinder'
import type { GivenMask } from './SudokuAvoidableRectangleFinder'
import { SudokuMedusaFinder, type MedusaChain, type StrongLinkGraph } from './SudokuMedusaFinder'
import type { Board, CandidateGrid } from './types'

/**
 * An AIC's equivalent Dragon - the reverse of SudokuDragonAicConverter (which
 * reads a Dragon's elimination step as a chain). Dev-only for now, like that
 * one.
 *
 * **Exact, by request**: the Dragon is built *from the chain*, not searched
 * for among the Dragons the solver would find. (The first version did search
 * - every stuck Medusa's log, cut where the chain's eliminations were made -
 * and what it found was a Dragon for most chains but the chain's own
 * reasoning for few: long exhaustive logs removing far more than the chain.)
 *
 * How a chain becomes a Dragon. Take `X = A - B = C - D = Y` ("X or Y is
 * true") and one of its strong links that is a real Medusa link (a bilocal
 * digit or a bivalue cell), say `B = C`:
 *   - colour that link's 3D Medusa: B one colour, C the other;
 *   - assume C's side: C true makes D false (the weak link), and D's strong
 *     link then forces Y - a Dragon extension, coloured C's dragon colour;
 *   - assume B's side: B true makes A false, which forces X - B's dragon colour.
 * So every candidate the chain takes as true on a side is coloured on that
 * side, the two ends land on opposite sides, and what the chain removes (it
 * is weakly linked to both ends) is what the Dragon's own Rules 3-5 remove.
 * The candidates in between (A and D above) are the ones each extension
 * rules out; a Dragon never colours those - they are false on the side
 * being followed - so "every candidate of the chain" means: the true ones
 * coloured, the false ones each the reason for the next extension.
 *
 * That colouring is not trusted, it is handed to the Dragon finder as if the
 * user had coloured it (`continueColouring`, Autocomplete Dragon's check):
 * each candidate must come out as one of Dragon's own extensions (Rule 1,
 * Rule 2, hidden single - or, for a Dynamic Dragon, Extension Rule 3) from
 * the ones before it, in whatever order makes them derivable, and the finder
 * then carries on to the elimination. So the result is an ordinary move log.
 *
 * When there is no exact Dragon (`AicDragonFailure`):
 *   - 'no-medusa-link': no strong link of the chain is a Medusa link between
 *     two single candidates (a chain made only of grouped/UR/ALS links);
 *   - 'medusa-resolves': every such link sits in a Medusa that is not stuck -
 *     a 3D Medusa already proves something there, and a Dragon only starts
 *     from a stuck one. When that Medusa's own eliminations include all of
 *     the chain's, it *is* the chain's equivalent - nothing needs extending -
 *     and is returned as `medusa` too. The UI shows it in preference to a
 *     Dragon from another of the chain's links, by request: it is the
 *     easier technique;
 *   - 'unreachable': Dragon's rules can't colour the chain's candidates (a
 *     grouped, UR or ALS link in the way, with no enabled Dynamic technique
 *     standing in for it);
 *   - 'not-covered': coloured, but the Dragon's eliminations from there are
 *     not all of the chain's (an end that is a group can't be coloured).
 *
 * The Medusa is a whole connected component, so it usually colours more than
 * the chain's one link (`medusaExtras`) and the finished colouring may remove
 * more than the chain does (`extras`) - both reported, neither avoidable.
 * Each usable strong link is tried as the start; a plain Dragon beats a
 * Dynamic one, then the start whose Medusa strays least from the chain.
 */

function keyOf(ref: DragonCandidateRef): string {
  return `${ref.row},${ref.col},${ref.digit}`
}

function chainKeyOf(chain: MedusaChain): string {
  return chain.candidates
    .map((c) => `${c.row}.${c.col}.${c.digit}.${c.color[0]}`)
    .sort()
    .join('-')
}

const DRAGON_COLOUR: Record<'blue' | 'yellow', DragonColor> = { blue: 'darkBlue', yellow: 'orange' }

/** A chain as its nodes in order - each a list of candidates, one for an
 * ordinary node, several for a grouped one - and, per link between
 * consecutive nodes, whether it is strong. */
export interface AicChainShape {
  nodes: ReadonlyArray<readonly DragonCandidateRef[]>
  strong: readonly boolean[]
  /** An ALS-AIC's almost locked sets (its ALS links' and its closure's
   * cells). A colouring that colours a candidate in one of these cells has
   * not left the chain, by request: such candidates don't count as "off the
   * chain" (`medusaExtras`, `offChain`). */
  alsCells?: ReadonlyArray<readonly [number, number]>
}

/** Every candidate that counts as on the chain when asking what a colouring
 * coloured beyond it: the chain's own, plus any candidate in an ALS cell. */
function chainTerritory(chain: AicChainShape): Set<string> {
  const keys = new Set(chain.nodes.flatMap((node) => node.map(keyOf)))
  for (const [row, col] of chain.alsCells ?? []) {
    for (let digit = 1; digit <= 9; digit++) keys.add(keyOf({ row, col, digit }))
  }
  return keys
}

export type AicDragonFailure = 'no-medusa-link' | 'medusa-resolves' | 'unreachable' | 'not-covered'

export interface AicDragonEquivalent {
  kind: 'dragon' | 'dynamic'
  /** Same key App uses to name a chain's technique instance. */
  chainKey: string
  /** The move log, cut right after the first move by which every one of the
   * chain's eliminations is made. */
  moves: DragonMove[]
  /** The strong link of the chain the Medusa was started from (index into
   * `AicChainShape.strong`). */
  seedLink: number
  /** How many of the chain's candidates end up coloured, and how many of
   * them the chain takes as true on some side (all of those are). */
  coloured: number
  trueNodes: number
  /** Medusa candidates that are not on the chain. */
  medusaExtras: number
  /** Every coloured candidate that is not on the chain, once the eliminations
   * are made (the Medusa's, plus anything a promotion or a further extension
   * added). */
  offChain: number
  /** Extensions the finder still needed after the chain's own candidates
   * were coloured, before the elimination (0 = the chain alone does it). */
  furtherExtensions: number
  /** Candidates the Dragon removes that the chain does not. */
  extras: DragonCandidateRef[]
}

/** A 3D Medusa through one of the chain's strong links that is not stuck and
 * already makes every elimination of the chain by its own rules. */
export interface AicMedusaEquivalent {
  medusa: MedusaChain
  seedLink: number
  /** How many of the chain's candidates the Medusa colours. */
  coloured: number
  /** Medusa candidates that are not on the chain. */
  medusaExtras: number
  /** Candidates the Medusa removes that the chain does not. */
  extras: DragonCandidateRef[]
}

export interface AicDragonSearch {
  best: AicDragonEquivalent | null
  /** See AicMedusaEquivalent. Independent of `best`: both can be set (the
   * Dragon from one strong link, the Medusa from another). */
  medusa: AicMedusaEquivalent | null
  /** Why there is no Dragon (the furthest any start got). */
  failure: AicDragonFailure | null
}

export interface AicDragonOptions {
  /** False under the "Disable Dynamic Dragons" setting. Defaults to true. */
  dynamicEnabled?: boolean
  /** The Dynamic Dragon techniques to allow. The caller leaves the AIC kinds
   * out: a Dynamic Dragon that calls on the chain itself as a helper would
   * explain nothing. */
  allowedRule3Techniques?: ReadonlySet<Rule3Technique>
  aicLimitPerStep?: boolean
  maxTechniquesPerStep?: number
  givens?: GivenMask | null
}

const FAILURE_ORDER: AicDragonFailure[] = ['no-medusa-link', 'medusa-resolves', 'unreachable', 'not-covered']

export class SudokuAicDragonConverter {
  private readonly medusaFinder = new SudokuMedusaFinder()
  private readonly dragonFinder = new SudokuDragonFinder()

  find(
    board: Board,
    candidates: CandidateGrid,
    chain: AicChainShape,
    eliminations: readonly DragonCandidateRef[],
    options: AicDragonOptions = {},
  ): AicDragonSearch {
    const wanted = new Set(eliminations.map(keyOf))
    let best: AicDragonEquivalent | null = null
    let medusaEquivalent: AicMedusaEquivalent | null = null
    let failure: AicDragonFailure = 'no-medusa-link'
    const failed = (reason: AicDragonFailure) => {
      if (FAILURE_ORDER.indexOf(reason) > FAILURE_ORDER.indexOf(failure)) failure = reason
    }
    if (wanted.size === 0) {
      return { best, medusa: null, failure }
    }

    const medusaOf = new Map<string, { medusa: MedusaChain; color: 'blue' | 'yellow' }>()
    for (const medusa of this.medusaFinder.findChains(board, candidates)) {
      for (const c of medusa.candidates) medusaOf.set(keyOf(c), { medusa, color: c.color })
    }
    const onChain = new Set(chain.nodes.flatMap((node) => node.map(keyOf)))
    const territory = chainTerritory(chain)
    const tried = new Set<MedusaChain>()

    for (let s = 0; s < chain.strong.length; s++) {
      const from = chain.nodes[s]
      const to = chain.nodes[s + 1]
      if (!chain.strong[s] || from.length !== 1 || to.length !== 1) {
        continue
      }
      const a = medusaOf.get(keyOf(from[0]))
      const b = medusaOf.get(keyOf(to[0]))
      if (!a || !b || a.medusa !== b.medusa || a.color === b.color) {
        continue
      }
      // Two links in one Medusa give the same colouring: one try per Medusa.
      const medusa = a.medusa
      if (tried.has(medusa)) {
        continue
      }
      tried.add(medusa)
      const removed = this.medusaRemoves(medusa, board, candidates)
      if (removed) {
        failed('medusa-resolves')
        // Not a Dragon's start - but does the Medusa already do what the chain does?
        const removedKeys = new Set(removed.map(keyOf))
        if ([...wanted].every((key) => removedKeys.has(key))) {
          const medusaExtras = medusa.candidates.filter((c) => !territory.has(keyOf(c))).length
          // The Medusa that strays least from the chain.
          if (!medusaEquivalent || medusaExtras < medusaEquivalent.medusaExtras) {
            medusaEquivalent = {
              medusa,
              seedLink: s,
              coloured: medusa.candidates.filter((c) => onChain.has(keyOf(c))).length,
              medusaExtras,
              extras: removed.filter((ref) => !wanted.has(keyOf(ref))),
            }
          }
        }
        continue
      }
      const outcome = this.dragonFrom(medusa, s, a.color, b.color, chain, onChain, territory, wanted, board, candidates, options)
      if ('failure' in outcome) {
        failed(outcome.failure)
      } else if (best === null || compare(rank(outcome), rank(best)) < 0) {
        best = outcome
      }
    }
    return { best, medusa: medusaEquivalent, failure: best ? null : failure }
  }

  /**
   * The "short" equivalents, by request (dev use, this feature only): the
   * same two ideas without the completeness a real Medusa or Dragon has, so
   * the colouring can stay on the chain's own candidates.
   *
   * - **Short Medusa**: not the whole connected component, only a path of
   *   strong links from one end of the chain to the other - along the chain's
   *   own candidates when every link of it is strong, else the shortest such
   *   path in the strong-link graph. Its two ends get opposite colours, and
   *   Medusa's own rules on just those candidates make the eliminations.
   * - **Short Dragon**: a Dragon whose starting "Medusa" is a single strong
   *   link of the chain (a bilocal digit or a bivalue cell: two candidates,
   *   two colours) - not a whole component, and it need not be stuck. The
   *   rest is the exact Dragon above: the chain's other true candidates,
   *   checked as Dragon's own extensions, then its own eliminations.
   *
   * Both get the Dragon finder's two-sided rule (a candidate both sides force
   * is true) like every Dragon - it is part of Dragon Colouring itself since
   * 2026-10-05, no longer a prototype of this feature.
   *
   * Neither changes a rule: both are the app's own Medusa and Dragon code run
   * on a deliberately partial colouring, which stays valid (every coloured
   * pair is still "exactly one is true"), so what they remove is sound - the
   * sweep checks it. They are not what the solver means by a 3D Medusa or a
   * Dragon anywhere else, and nothing else uses them.
   */
  findShort(
    board: Board,
    candidates: CandidateGrid,
    chain: AicChainShape,
    eliminations: readonly DragonCandidateRef[],
    options: AicDragonOptions = {},
  ): AicDragonSearch {
    const wanted = new Set(eliminations.map(keyOf))
    let best: AicDragonEquivalent | null = null
    let failure: AicDragonFailure = 'no-medusa-link'
    if (wanted.size === 0) {
      return { best, medusa: null, failure }
    }
    const graph = this.medusaFinder.buildStrongLinkGraph(board, candidates)
    const onChain = new Set(chain.nodes.flatMap((node) => node.map(keyOf)))
    const territory = chainTerritory(chain)
    const medusa = this.shortMedusa(graph, chain, onChain, territory, wanted, board, candidates)

    for (let s = 0; s < chain.strong.length; s++) {
      const from = chain.nodes[s]
      const to = chain.nodes[s + 1]
      if (!chain.strong[s] || from.length !== 1 || to.length !== 1) {
        continue
      }
      // Only a link the strong-link graph has: a bilocal digit or a bivalue cell.
      if (!(graph.adjacency.get(keyOf(from[0])) ?? []).includes(keyOf(to[0]))) {
        continue
      }
      const link: MedusaChain = {
        candidates: [
          { ...from[0], color: 'blue' },
          { ...to[0], color: 'yellow' },
        ],
        hasBivalueCellLink: from[0].row === to[0].row && from[0].col === to[0].col,
      }
      const outcome = this.dragonFrom(link, s, 'blue', 'yellow', chain, onChain, territory, wanted, board, candidates, options, true)
      if ('failure' in outcome) {
        if (FAILURE_ORDER.indexOf(outcome.failure) > FAILURE_ORDER.indexOf(failure)) failure = outcome.failure
      } else if (best === null || compare(rank(outcome), rank(best)) < 0) {
        best = outcome
      }
    }
    return { best, medusa, failure: best ? null : failure }
  }

  /** See findShort. */
  private shortMedusa(
    graph: StrongLinkGraph,
    chain: AicChainShape,
    onChain: ReadonlySet<string>,
    /** `onChain` plus the ALS cells' candidates: what doesn't count as off the chain. */
    territory: ReadonlySet<string>,
    wanted: ReadonlySet<string>,
    board: Board,
    candidates: CandidateGrid,
  ): AicMedusaEquivalent | null {
    const first = chain.nodes[0]
    const last = chain.nodes[chain.nodes.length - 1]
    if (!first || first.length !== 1 || last.length !== 1) {
      return null
    }
    // On the chain's own candidates if strong links join them all, else anywhere.
    for (const within of [onChain, null]) {
      const path = strongPath(graph, keyOf(first[0]), keyOf(last[0]), within)
      // An odd number of links, so the two ends get opposite colours.
      if (!path || path.length % 2 !== 0) {
        continue
      }
      const medusa: MedusaChain = {
        candidates: path.map((key, i) => ({ ...graph.nodeByKey.get(key)!, color: i % 2 === 0 ? ('blue' as const) : ('yellow' as const) })),
        hasBivalueCellLink: path.some((key, i) => i > 0 && graph.bivalueEdgeKeys.has(path[i - 1] < key ? `${path[i - 1]}|${key}` : `${key}|${path[i - 1]}`)),
      }
      const removed = this.medusaRemoves(medusa, board, candidates)
      const removedKeys = new Set((removed ?? []).map(keyOf))
      if (!removed || ![...wanted].every((key) => removedKeys.has(key))) {
        continue
      }
      const medusaExtras = path.filter((key) => !territory.has(key)).length
      return {
        medusa,
        seedLink: 0,
        coloured: path.filter((key) => onChain.has(key)).length,
        medusaExtras,
        extras: removed.filter((ref) => !wanted.has(keyOf(ref))),
      }
    }
    return null
  }

  /** Everything a Medusa colouring removes by Medusa's own rules (the mass
   * elimination and Rules 3-5), or null when it proves nothing (it is stuck). */
  private medusaRemoves(medusa: MedusaChain, board: Board, candidates: CandidateGrid): DragonCandidateRef[] | null {
    const mass = this.medusaFinder.findMassElimination(medusa, board, candidates)
    const rule3 = this.medusaFinder.findRule3Eliminations(medusa, board, candidates)
    const rule4 = this.medusaFinder.findRule4Eliminations(medusa, candidates)
    const rule5 = this.medusaFinder.findRule5Eliminations(medusa, candidates)
    if (mass === null && rule3.length === 0 && rule4.length === 0 && rule5.length === 0) {
      return null
    }
    return listEffectiveEliminations(board, candidates, {
      eliminatedCandidates: [
        ...(mass?.eliminatedCandidates ?? []).map((c) => ({ row: c.row, col: c.col, digit: c.digit })),
        ...rule3.map((r) => ({ row: r.row, col: r.col, digit: r.digit })),
        ...rule4.flatMap((r) => r.eliminatedDigits.map((digit) => ({ row: r.row, col: r.col, digit }))),
        ...rule5.map((r) => ({ row: r.row, col: r.col, digit: r.eliminatedDigit })),
      ],
      solvedCandidates: (mass?.solvedCells ?? []).map((c) => ({ row: c.row, col: c.col, digit: c.digit })),
    })
  }

  /**
   * The Dragon that follows the chain from `medusa` - the colouring of its
   * strong link `s`, whose two candidates are `fromColor` and `toColor` (the
   * whole stuck Medusa for an exact Dragon, the bare link for a short one):
   * plain if Dragon's rules allow, else Dynamic. Or why not.
   */
  private dragonFrom(
    medusa: MedusaChain,
    s: number,
    fromColor: 'blue' | 'yellow',
    toColor: 'blue' | 'yellow',
    chain: AicChainShape,
    onChain: ReadonlySet<string>,
    /** `onChain` plus the ALS cells' candidates: what doesn't count as off the chain. */
    territory: ReadonlySet<string>,
    wanted: ReadonlySet<string>,
    board: Board,
    candidates: CandidateGrid,
    options: AicDragonOptions,
    /** A short Dragon: only the chain's own eliminations are kept (see cutAtEliminations). */
    short = false,
  ): AicDragonEquivalent | { failure: AicDragonFailure } {
    // Going forward from the link, every second node is true when its far
    // end is; going back, every second node is true when its near end is.
    const painted: DragonNode[] = []
    let trueNodes = 2
    chain.nodes.forEach((node, m) => {
      const side = m > s + 1 && (m - (s + 1)) % 2 === 0 ? toColor : m < s && (s - m) % 2 === 0 ? fromColor : null
      if (!side) {
        return
      }
      trueNodes++
      // A grouped node can't be coloured; whatever follows it has to be
      // reached without it (a Dynamic Dragon's locked candidate, say).
      // One already in this Medusa is only checked for being on that side.
      if (node.length === 1) {
        painted.push({ ...node[0], color: DRAGON_COLOUR[side] })
      }
    })

    // Exhaustive: with the two-sided rule a Dragon often stops first at a
    // placement the chain has nothing to do with; carrying on past it (the
    // log is cut where the chain's eliminations are all made, below) is what
    // lets the colouring reach them.
    const attempts: Array<{ kind: AicDragonEquivalent['kind']; extend: DragonExtendOptions }> = [{ kind: 'dragon', extend: { exhaustive: true } }]
    if (options.dynamicEnabled !== false) {
      attempts.push({
        kind: 'dynamic',
        extend: {
          dynamic: true,
          exhaustive: true,
          allowedRule3Techniques: options.allowedRule3Techniques,
          aicLimitPerStep: options.aicLimitPerStep,
          maxTechniquesPerStep: options.maxTechniquesPerStep,
          givens: options.givens,
        },
      })
    }
    // Stepping stones (by request, 2026-10-05): the other candidates of an
    // ALS-AIC's ALS cells - already "not off the chain" - may be coloured on
    // the way to a painted node. An ALS link needs them: in Dragon terms it
    // is a step through the set's other digits, which aren't chain nodes.
    // Without them, two thirds of the ALS-AICs the old two-sided prototype
    // converted had no Dragon (dragon-research/two-sided-rule/why-drop-deep.ts).
    const stoneKeys = new Set([...territory].filter((key) => !onChain.has(key)))
    const check = (extend: DragonExtendOptions, allowed: ReadonlySet<string>) =>
      this.dragonFinder.continueColouring(medusa, painted, board, candidates, extend, allowed.size > 0 ? (c) => allowed.has(keyOf(c)) : undefined)
    let failure: AicDragonFailure = 'unreachable'
    for (const { kind, extend } of attempts) {
      /** The Dragon a check leads to, or why not. */
      const outcome = (checked: ReturnType<typeof check>) => {
        if (checked.kind === 'invalid') {
          return 'unreachable' as const
        }
        const moves = checked.result?.moves
        if (!moves) {
          return 'not-covered' as const
        }
        // A Dynamic attempt that needed no Dynamic step is the plain Dragon again.
        if (kind === 'dynamic' && !moves.some(isDynamicDragonMove)) {
          return 'plain' as const
        }
        return this.cutAtEliminations(board, candidates, moves, checked.checkedMoves, wanted, short) ?? ('not-covered' as const)
      }
      const checked = check(extend, stoneKeys)
      let found = outcome(checked)
      if (typeof found === 'string') {
        if (found === 'not-covered') failure = 'not-covered'
        continue
      }
      // The check takes the first stone that helps, not the fewest: drop
      // each one whose removal still leaves a Dragon (last first).
      if (checked.kind === 'checked') {
        let used = new Set(
          found.moves
            .slice(1, checked.checkedMoves)
            .flatMap((move) => move.colored)
            .map(keyOf)
            .filter((key) => stoneKeys.has(key)),
        )
        for (const key of [...used].reverse()) {
          const fewer = new Set([...used].filter((k) => k !== key))
          const again = outcome(check(extend, fewer))
          if (typeof again !== 'string') {
            used = fewer
            found = again
          }
        }
      }
      const fold = foldDragonMoves(found.moves, found.moves.length - 1)
      const colouredKeys = new Set(
        [fold.blueCandidates, fold.yellowCandidates, fold.darkBlueCandidates, fold.orangeCandidates].flat().map(keyOf),
      )
      const coloured = [...onChain].filter((key) => colouredKeys.has(key)).length
      return {
        kind,
        chainKey: chainKeyOf(medusa),
        moves: found.moves,
        seedLink: s,
        coloured,
        trueNodes,
        medusaExtras: medusa.candidates.filter((c) => !territory.has(keyOf(c))).length,
        offChain: [...colouredKeys].filter((key) => !territory.has(key)).length,
        furtherExtensions: found.furtherExtensions,
        extras: found.extras,
      }
    }
    return { failure }
  }

  /** `moves` cut after the first move (at or past the chain's own steps) by
   * which every wanted candidate is gone, or null if that never happens. */
  private cutAtEliminations(
    board: Board,
    candidates: CandidateGrid,
    moves: DragonMove[],
    checkedMoves: number,
    wanted: ReadonlySet<string>,
    onlyWanted: boolean,
  ): { moves: DragonMove[]; furtherExtensions: number; extras: DragonCandidateRef[] } | null {
    for (let k = 0; k < moves.length; k++) {
      if (moves[k].eliminated.length === 0 && moves[k].solved.length === 0) {
        continue
      }
      const fold = foldDragonMoves(moves, k)
      const removed = listEffectiveEliminations(board, candidates, {
        eliminatedCandidates: fold.eliminatedCandidates,
        solvedCandidates: fold.solvedCandidates,
      })
      const removedKeys = new Set(removed.map(keyOf))
      if (![...wanted].every((key) => removedKeys.has(key))) {
        continue
      }
      const furtherExtensions = moves.slice(checkedMoves, k + 1).filter((move) => move.kind.startsWith('extension')).length
      const whole = { moves: moves.slice(0, k + 1), furtherExtensions, extras: removed.filter((ref) => !wanted.has(keyOf(ref))) }
      if (!onlyWanted) {
        return whole
      }
      // A short Dragon shows the chain's eliminations and no others: the
      // finder reports every Rule 3/4/5 find of the finished colouring as a
      // move of its own, so the finds that remove nothing of the chain's are
      // simply left out of the log (a mass elimination is one fact, kept whole).
      const isFind = (move: DragonMove) => move.kind === 'rule3' || move.kind === 'rule4' || move.kind === 'rule5'
      const trimmed = whole.moves.filter((move) => !isFind(move) || move.eliminated.some((e) => wanted.has(keyOf(e))))
      if (trimmed.length === whole.moves.length || trimmed.length === 0) {
        return whole
      }
      const trimmedFold = foldDragonMoves(trimmed, trimmed.length - 1)
      const trimmedRemoved = listEffectiveEliminations(board, candidates, {
        eliminatedCandidates: trimmedFold.eliminatedCandidates,
        solvedCandidates: trimmedFold.solvedCandidates,
      })
      const trimmedKeys = new Set(trimmedRemoved.map(keyOf))
      return [...wanted].every((key) => trimmedKeys.has(key))
        ? { moves: trimmed, furtherExtensions, extras: trimmedRemoved.filter((ref) => !wanted.has(keyOf(ref))) }
        : whole
    }
    return null
  }
}

/** Plain before Dynamic, then the one that needs least beyond the chain. */
function rank(e: AicDragonEquivalent): number[] {
  return [e.kind === 'dragon' ? 0 : 1, e.furtherExtensions, e.offChain, e.moves.length]
}

/** The shortest path of strong links from `from` to `to` (as candidate keys,
 * both ends included), through `within` only when given - or null. */
function strongPath(graph: StrongLinkGraph, from: string, to: string, within: ReadonlySet<string> | null): string[] | null {
  const previous = new Map<string, string | null>([[from, null]])
  const queue = [from]
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i]
    if (current === to) {
      const path: string[] = []
      for (let at: string | null = to; at !== null; at = previous.get(at) ?? null) {
        path.unshift(at)
      }
      return path
    }
    for (const next of graph.adjacency.get(current) ?? []) {
      if (!previous.has(next) && (!within || within.has(next))) {
        previous.set(next, current)
        queue.push(next)
      }
    }
  }
  return null
}

function compare(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] - b[i]
  }
  return 0
}
