import type { ChainColor, ColoredCandidate, MedusaChain, SudokuMedusaFinder } from './SudokuMedusaFinder'
import type { Board, CandidateGrid } from './types'

/** One candidate the user painted with one of the two Medusa colours. */
export interface MedusaSeed {
  row: number
  col: number
  digit: number
  color: ChainColor
}

export type MedusaAutocompleteResult =
  | { kind: 'invalid'; problems: string[] }
  | {
      kind: 'complete'
      /** The whole Medusa the seeds belong to, coloured to agree with them -
       * exactly the chain findChains would report for that component, up to
       * which side is called blue. */
      chain: MedusaChain
      /** The chain's candidates the user hadn't painted yet. */
      added: ColoredCandidate[]
      /** allowOutside only: painted candidates that aren't in the chain at
       * all (no strong link, or another component) - left for the caller to
       * account for. Always empty otherwise. */
      outside: MedusaSeed[]
    }

/** At most this many problems are listed for an invalid colouring - past a
 * handful, more of the same only buries the first (usually the cause). */
const MAX_PROBLEMS = 5

function nodeKey(row: number, col: number, digit: number): string {
  return `${row},${col},${digit}`
}

function describe(node: { row: number; col: number; digit: number }): string {
  return `${node.digit}r${node.row + 1}c${node.col + 1}`
}

function opposite(color: ChainColor): ChainColor {
  return color === 'blue' ? 'yellow' : 'blue'
}

/**
 * "Autocomplete Colours": finishes a 3D Medusa the user started painting by
 * hand. The user's paint is the starting point, never replaced - it is
 * checked against Medusa's own strong-link graph (buildStrongLinkGraph,
 * unchanged), and when it is a valid start, the rest of that chain is
 * coloured to agree with it.
 *
 * A valid start means every painted candidate is a node of the graph (it has
 * a strong link at all), they all lie in one connected component (one
 * Medusa, not two unrelated ones sharing a pair of colours), and each one's
 * colour matches the parity the strong links force: two candidates an even
 * number of links apart share a colour, an odd number apart they don't. A
 * component with an odd loop can't be two-coloured at all - findChains skips
 * those, and so does this (it only happens with wrong candidates).
 *
 * A colouring that already contains a Medusa contradiction (two of one
 * colour in a unit, say) is *not* invalid - that is exactly what Rule 1
 * reports, and the caller runs the Medusa rules on the completed chain.
 *
 * `allowOutside` is for Autocomplete Dragon: there a Medusa colour can also
 * sit outside the chain (a promoted dragon colour, or Medusa growth after
 * one), so a painted candidate outside the main chain is handed back in
 * `outside` for the Dragon check instead of being a problem. `mainSeed`, also
 * Dragon-only, picks the chain (the one holding that candidate) instead of
 * the most-painted one - growth after a promotion can paint more candidates
 * than the Medusa itself has, so the caller tries each painted chain in turn.
 */
export function autocompleteMedusa(
  finder: SudokuMedusaFinder,
  board: Board,
  candidates: CandidateGrid,
  seeds: MedusaSeed[],
  colorNames: Record<ChainColor, string>,
  { allowOutside = false, mainSeed }: { allowOutside?: boolean; mainSeed?: MedusaSeed } = {},
): MedusaAutocompleteResult {
  const problems: string[] = []
  const outside: MedusaSeed[] = []
  const graph = finder.buildStrongLinkGraph(board, candidates)
  const { adjacency, nodeByKey, bivalueEdgeKeys } = graph

  const linked: MedusaSeed[] = []
  for (const seed of seeds) {
    if (board[seed.row][seed.col] !== 0 || !candidates[seed.row][seed.col][seed.digit - 1]) {
      problems.push(`${describe(seed)} is painted ${colorNames[seed.color]}, but it isn't a candidate any more.`)
    } else if (!adjacency.has(nodeKey(seed.row, seed.col, seed.digit))) {
      if (allowOutside) {
        outside.push(seed)
        continue
      }
      problems.push(
        `${describe(seed)} is painted ${colorNames[seed.color]}, but it has no strong link (its cell has more than two candidates, and ${seed.digit} appears more than twice in each of its row, column and box), so it can't be part of a Medusa.`,
      )
    } else {
      linked.push(seed)
    }
  }

  // One BFS per component touched by a seed, recording each node's parity
  // (distance mod 2) from the component's start and a parent pointer, so a
  // wrongly coloured seed can be shown the exact strong links that decide
  // its colour.
  const componentOf = new Map<string, number>()
  const parityOf = new Map<string, number>()
  const parentOf = new Map<string, string | null>()
  const components: Array<{ keys: string[]; oddLoop: boolean; hasBivalueCellLink: boolean }> = []
  for (const seed of linked) {
    const startKey = nodeKey(seed.row, seed.col, seed.digit)
    if (componentOf.has(startKey)) {
      continue
    }
    const id = components.length
    const component = { keys: [startKey], oddLoop: false, hasBivalueCellLink: false }
    components.push(component)
    componentOf.set(startKey, id)
    parityOf.set(startKey, 0)
    parentOf.set(startKey, null)
    const queue = [startKey]
    while (queue.length > 0) {
      const current = queue.shift()!
      const nextParity = 1 - parityOf.get(current)!
      for (const neighbor of adjacency.get(current) ?? []) {
        const edgeKey = current < neighbor ? `${current}|${neighbor}` : `${neighbor}|${current}`
        if (bivalueEdgeKeys.has(edgeKey)) {
          component.hasBivalueCellLink = true
        }
        if (!componentOf.has(neighbor)) {
          componentOf.set(neighbor, id)
          parityOf.set(neighbor, nextParity)
          parentOf.set(neighbor, current)
          component.keys.push(neighbor)
          queue.push(neighbor)
        } else if (parityOf.get(neighbor) !== nextParity) {
          component.oddLoop = true
        }
      }
    }
  }

  // The chain the user means is the component most of their paint is in;
  // any seed elsewhere is the odd one out, not the other way round.
  const seedsByComponent = new Map<number, MedusaSeed[]>()
  for (const seed of linked) {
    const id = componentOf.get(nodeKey(seed.row, seed.col, seed.digit))!
    seedsByComponent.set(id, [...(seedsByComponent.get(id) ?? []), seed])
  }
  let mainId = -1
  for (const [id, list] of seedsByComponent) {
    if (mainId === -1 || list.length > seedsByComponent.get(mainId)!.length) {
      mainId = id
    }
  }
  if (mainSeed) {
    mainId = componentOf.get(nodeKey(mainSeed.row, mainSeed.col, mainSeed.digit)) ?? -1
  }
  if (mainId === -1) {
    if (outside.length > 0) {
      problems.push(
        `None of the candidates painted ${colorNames.blue} or ${colorNames.yellow} has a strong link, so there's no Medusa to start from.`,
      )
    }
    return { kind: 'invalid', problems: problems.slice(0, MAX_PROBLEMS) }
  }
  const mainSeeds = seedsByComponent.get(mainId)!
  const main = components[mainId]

  for (const [id, list] of seedsByComponent) {
    if (id === mainId) {
      continue
    }
    if (allowOutside) {
      outside.push(...list)
      continue
    }
    for (const seed of list) {
      problems.push(
        `${describe(seed)} isn't connected by strong links to ${describe(mainSeeds[0])}, so they can't be part of the same Medusa.`,
      )
    }
  }

  if (main.oddLoop) {
    problems.push(
      `The strong links through ${describe(mainSeeds[0])} form a loop of odd length, so they can't be coloured with two colours at all - some candidates on the grid are probably wrong.`,
    )
    return { kind: 'invalid', problems: problems.slice(0, MAX_PROBLEMS) }
  }

  // Which colour parity 0 is: whichever reading agrees with more of the
  // user's paint, so the seeds reported as wrong are the minority.
  const agreeWithBlueAtZero = mainSeeds.filter(
    (seed) => (parityOf.get(nodeKey(seed.row, seed.col, seed.digit)) === 0) === (seed.color === 'blue'),
  )
  const zeroColor: ChainColor = agreeWithBlueAtZero.length * 2 >= mainSeeds.length ? 'blue' : 'yellow'
  const colorOfKey = (key: string): ChainColor => (parityOf.get(key) === 0 ? zeroColor : opposite(zeroColor))

  const rightSeeds = mainSeeds.filter((seed) => colorOfKey(nodeKey(seed.row, seed.col, seed.digit)) === seed.color)
  const wrongSeeds = mainSeeds.filter((seed) => colorOfKey(nodeKey(seed.row, seed.col, seed.digit)) !== seed.color)
  for (const seed of wrongSeeds) {
    const reference = rightSeeds[0]
    const path = strongLinkPath(parentOf, nodeKey(reference.row, reference.col, reference.digit), nodeKey(seed.row, seed.col, seed.digit))
    const pathText = path ? ` (strong links: ${path.map((key) => describe(nodeByKey.get(key)!)).join(' = ')})` : ''
    problems.push(
      `${describe(seed)} is painted ${colorNames[seed.color]}, but following the strong links from ${describe(reference)} (${colorNames[reference.color]}) it must be ${colorNames[opposite(seed.color)]}${pathText}.`,
    )
  }

  if (problems.length > 0) {
    return { kind: 'invalid', problems: problems.slice(0, MAX_PROBLEMS) }
  }

  const seeded = new Set(mainSeeds.map((seed) => nodeKey(seed.row, seed.col, seed.digit)))
  const chainCandidates: ColoredCandidate[] = main.keys.map((key) => ({ ...nodeByKey.get(key)!, color: colorOfKey(key) }))
  return {
    kind: 'complete',
    chain: { candidates: chainCandidates, hasBivalueCellLink: main.hasBivalueCellLink },
    added: chainCandidates.filter((c) => !seeded.has(nodeKey(c.row, c.col, c.digit))),
    outside,
  }
}

/** The strong-link path between two nodes of one BFS tree: up from each to
 * their lowest common ancestor. Tree edges are real strong links, and a
 * tree path's length has the same parity as any other path between the two
 * nodes (the component has no odd loop by the time this runs), so it
 * demonstrates exactly why the two must share, or not share, a colour. */
function strongLinkPath(parentOf: Map<string, string | null>, from: string, to: string): string[] | null {
  const ancestorsOfFrom: string[] = []
  for (let key: string | null = from; key !== null; key = parentOf.get(key) ?? null) {
    ancestorsOfFrom.push(key)
  }
  const indexInFrom = new Map(ancestorsOfFrom.map((key, i) => [key, i]))
  const fromTo: string[] = []
  for (let key: string | null = to; key !== null; key = parentOf.get(key) ?? null) {
    const i = indexInFrom.get(key)
    if (i !== undefined) {
      return [...ancestorsOfFrom.slice(0, i + 1), ...fromTo.reverse()]
    }
    fromTo.push(key)
  }
  return null
}
