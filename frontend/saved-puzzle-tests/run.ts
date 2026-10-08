/**
 * Tests for the Saved Puzzles storage (src/savedPuzzles.ts):
 *
 *   npm run test:saved-puzzles
 *
 * Runs in Node against a stand-in localStorage: a save comes back exactly
 * as it went in (digits, givens, candidates, colours, Variant constraints),
 * several saves stay independent, the Classic and Variant lists never mix,
 * and corrupt, foreign or newer-format entries are skipped without throwing
 * or being destroyed. Exits non-zero on any failure.
 */
import { createEmptyCandidateColors, createEmptyCandidates } from '../src/sudoku/boardUtils'
import { CLASSIC_CONSTRAINTS, normalizeConstraints, type SudokuConstraints } from '../src/sudoku/SudokuConstraints'
import { DEFAULT_VARIANT_PUZZLE, parseVariantPuzzle } from '../src/sudoku/VariantPuzzle'
import * as persisted from '../src/persistedState'
import type { SavedGrid } from '../src/persistedState'
import type { CandidateColorGrid } from '../src/sudoku/types'
import * as saves from '../src/savedPuzzles'

// localStorage stand-in (the modules under test only touch it when called).
const store = new Map<string, string>()
let failWrites = false
;(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => {
    if (failWrites) {
      throw new Error('QuotaExceededError')
    }
    store.set(key, value)
  },
  removeItem: (key: string) => void store.delete(key),
}

const CLASSIC_KEY = 'sudoku-solver-saved-puzzles'
const VARIANT_KEY = 'sudoku-solver-variants-saved-puzzles'

let checks = 0
let failures = 0
function check(name: string, ok: boolean, detail = ''): void {
  checks++
  if (!ok) {
    failures++
    console.error(`FAIL ${name}${detail ? ` - ${detail}` : ''}`)
  }
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** A mid-solve Classic position: some givens, some entered digits, pencil
 * marks on the rest, and candidate colours in both one- and two-layer form. */
function classicGrid(seed: number): SavedGrid {
  const solution = '534678912672195348198342567859761423426853791713924856961537284287419635345286179'
  const board = Array.from({ length: 9 }, () => Array<number>(9).fill(0))
  const givens = Array.from({ length: 9 }, () => Array<boolean>(9).fill(false))
  const candidates = createEmptyCandidates()
  const candidateColors: CandidateColorGrid = createEmptyCandidateColors()
  for (let i = 0; i < 81; i++) {
    const r = Math.floor(i / 9)
    const c = i % 9
    const roll = (i * 7 + seed * 13) % 10
    if (roll < 3) {
      board[r][c] = Number(solution[i])
      givens[r][c] = true
    } else if (roll < 5) {
      board[r][c] = Number(solution[i])
    } else {
      for (let d = 0; d < 9; d++) {
        candidates[r][c][d] = d + 1 === Number(solution[i]) || (d + i + seed) % 3 === 0
      }
      const d = Number(solution[i]) - 1
      if (roll === 5) {
        candidateColors[r][c][d] = [{ color: 'blue', shape: 'circle' }]
      } else if (roll === 6) {
        candidateColors[r][c][d] = [
          { color: 'paleYellow', shape: 'square' },
          { color: 'lightPink', shape: 'diamond' },
        ]
      }
    }
  }
  return { board, givens, candidates, candidateColors }
}

function variantGrid(): SavedGrid {
  const parsed = parseVariantPuzzle(DEFAULT_VARIANT_PUZZLE)
  if (!parsed.ok) {
    throw new Error('the default Variant puzzle no longer parses')
  }
  const candidates = createEmptyCandidates()
  candidates[0][0] = [true, false, true, false, false, false, false, false, true]
  const candidateColors = createEmptyCandidateColors()
  candidateColors[0][0][2] = [{ color: 'blue', shape: 'circle' }]
  // Every optional rule on top of the cages, so each one has to survive.
  const constraints = normalizeConstraints({ ...parsed.constraints, diagonals: true, antiKnight: true, entropy: true })
  return { board: parsed.board, givens: parsed.givens, candidates, candidateColors, constraints }
}

const gridOnly = ({ board, givens, candidates, candidateColors }: SavedGrid) => ({ board, givens, candidates, candidateColors })
const rulesOf = (constraints: SudokuConstraints | undefined) => {
  const c = constraints ?? CLASSIC_CONSTRAINTS
  return { regions: c.regions, cages: c.cages, diagonals: !!c.diagonals, antiKnight: !!c.antiKnight, entropy: !!c.entropy }
}

function main() {
  // ---- Classic page -------------------------------------------------------
  check('empty list to start with', saves.loadSavedPuzzles().length === 0)

  const first = classicGrid(1)
  const saved = saves.savePuzzle({ name: '  My puzzle  ', kind: 'Classic', rating: 'SE rating: 7.2', grid: first })
  check('save succeeds', saved.ok)
  if (!saved.ok) throw new Error('cannot continue')
  check('name is trimmed', saved.puzzle.name === 'My puzzle')
  check('written under the Classic key only', store.has(CLASSIC_KEY) && !store.has(VARIANT_KEY))

  let list = saves.loadSavedPuzzles()
  check('one entry after one save', list.length === 1)
  check('grid round-trips exactly', same(gridOnly(list[0].grid), gridOnly(first)))
  check('a Classic entry has no constraints', list[0].grid.constraints === undefined)
  check('kind, rating and page are kept', list[0].kind === 'Classic' && list[0].rating === 'SE rating: 7.2' && list[0].page === 'classic')
  check('two-layer colours survive', same(list[0].grid.candidateColors, first.candidateColors))

  // Several saves, independent of each other.
  const second = classicGrid(2)
  const third = classicGrid(3)
  const savedSecond = saves.savePuzzle({ name: 'Second', kind: 'Classic', rating: null, grid: second })
  const savedThird = saves.savePuzzle({ name: 'Third', kind: 'Classic', rating: null, grid: third })
  check('more saves succeed', savedSecond.ok && savedThird.ok)
  list = saves.loadSavedPuzzles()
  check('three entries', list.length === 3)
  check('ids are distinct', new Set(list.map((p) => p.id)).size === 3)
  const byName = (name: string) => saves.loadSavedPuzzles().find((p) => p.name === name)
  check('each entry holds its own grid', same(gridOnly(byName('My puzzle')!.grid), gridOnly(first)) && same(gridOnly(byName('Second')!.grid), gridOnly(second)) && same(gridOnly(byName('Third')!.grid), gridOnly(third)))

  // Saving over an entry keeps its id and creation time, and nothing else moves.
  const progressed = classicGrid(1)
  const emptyCell = progressed.board.flatMap((row, r) => row.map((value, c) => [r, c, value])).find(([, , value]) => value === 0)!
  progressed.board[emptyCell[0]][emptyCell[1]] = 5
  const updated = saves.savePuzzle({ name: 'My puzzle', kind: 'Classic', rating: null, grid: progressed, replaceId: saved.puzzle.id })
  check('update succeeds and is reported as a replace', updated.ok && updated.replaced)
  list = saves.loadSavedPuzzles()
  check('still three entries after an update', list.length === 3)
  check('the update kept the id and creation time', byName('My puzzle')!.id === saved.puzzle.id && byName('My puzzle')!.createdAt === saved.puzzle.createdAt)
  check('the update holds the new progress', same(gridOnly(byName('My puzzle')!.grid), gridOnly(progressed)))
  check('the other entries are untouched', same(gridOnly(byName('Second')!.grid), gridOnly(second)))
  check('most recently saved first', list[0].name === 'My puzzle')

  // Names.
  check('a name is found without case', saves.savedPuzzleNamed(list, 'my PUZZLE')?.id === saved.puzzle.id)
  check('an unused name is left alone', saves.unusedSavedPuzzleName(list, 'Fourth') === 'Fourth')
  check('a used name gets (2)', saves.unusedSavedPuzzleName(list, 'Second') === 'Second (2)')
  saves.savePuzzle({ name: 'Second (2)', kind: 'Classic', rating: null, grid: second })
  check('then (3)', saves.unusedSavedPuzzleName(saves.loadSavedPuzzles(), 'Second') === 'Second (3)')
  check('a very long name is cut', saves.savePuzzle({ name: 'x'.repeat(500), kind: 'Classic', rating: null, grid: third }).ok && saves.loadSavedPuzzles()[0].name.length === saves.SAVED_PUZZLE_NAME_MAX_LENGTH)

  // "Is the puzzle on the grid already saved?"
  list = saves.loadSavedPuzzles()
  check('the grid finds its own save', saves.savedPuzzleOfGrid(list, classicGrid(1))?.id === saved.puzzle.id)
  const noGivens = classicGrid(1)
  noGivens.givens = noGivens.givens.map((row) => row.map(() => false))
  check('a grid without givens matches nothing', saves.savedPuzzleOfGrid(list, noGivens) === undefined)

  // Delete.
  const beforeDelete = saves.loadSavedPuzzles().length
  const deleted = saves.deleteSavedPuzzle(savedSecond.ok ? savedSecond.puzzle.id : '')
  check('delete removes exactly one', deleted.ok && deleted.puzzles.length === beforeDelete - 1 && !byName('Second'))
  check('delete leaves the rest intact', same(gridOnly(byName('Third')!.grid), gridOnly(third)))
  check('deleting an unknown id is harmless', saves.deleteSavedPuzzle('no-such-entry').puzzles.length === beforeDelete - 1)

  // A refused write is reported, and loses nothing.
  failWrites = true
  const refused = saves.savePuzzle({ name: 'Refused', kind: 'Classic', rating: null, grid: first })
  check('a refused write is reported', !refused.ok && refused.reason === 'storage')
  check('a refused delete is reported', !saves.deleteSavedPuzzle(saved.puzzle.id).ok)
  failWrites = false
  check('nothing was lost by the refused writes', saves.loadSavedPuzzles().length === beforeDelete - 1 && !byName('Refused'))

  // ---- Corrupt, foreign and newer data ------------------------------------
  const good = JSON.parse(store.get(CLASSIC_KEY)!) as Record<string, unknown>[]
  const goodCount = good.length
  const template = good[0]
  const newer = { ...template, v: 99, id: 'from-the-future-1', somethingNew: [1, 2, 3] }
  const broken: unknown[] = [
    null,
    42,
    'text',
    [],
    {},
    { ...template, id: 'bad-board-00001', board: '123' },
    { ...template, id: 'bad-board-00002', board: 'x'.repeat(81) },
    { ...template, id: 'bad-givens-0001', givens: '2'.repeat(81) },
    { ...template, id: 'bad-givens-0002', board: '0'.repeat(81), givens: '1'.repeat(81) },
    { ...template, id: 'bad-cands-00001', candidates: 'zzz'.repeat(81) },
    { ...template, id: 'bad-cands-00002', candidates: 'fff'.repeat(81) },
    { ...template, id: 'bad-cands-00003', candidates: undefined },
    { ...template, id: 'bad name 1' },
    { ...template, id: 'bad-name-000001', name: '   ' },
    { ...template, id: 'old-version-001', v: 0 },
    { ...template, id: 'other-page-0001', page: 'variant' },
    newer,
  ]
  store.set(CLASSIC_KEY, JSON.stringify([...broken, ...good]))
  let afterCorruption: ReturnType<typeof saves.loadSavedPuzzles> = []
  let threw = false
  try {
    afterCorruption = saves.loadSavedPuzzles()
  } catch {
    threw = true
  }
  check('bad entries never throw', !threw)
  check('only the good entries are listed', afterCorruption.length === goodCount, `${afterCorruption.length} vs ${goodCount}`)
  check('a Variant-tagged entry in the Classic key is not listed', !afterCorruption.some((p) => p.id === 'other-page-0001'))

  // Unreadable colours are dropped one by one, the entry stays.
  const oddColours = { ...template, id: 'odd-colours-001', name: 'Odd colours', colours: [[5, ['no-such-colour', 'circle']], [9999, ['blue', 'circle']], 'junk', [7, ['blue', 'hexagon']], [8, ['blue', 'circle']]] }
  store.set(CLASSIC_KEY, JSON.stringify([oddColours, newer]))
  const odd = saves.loadSavedPuzzles()
  check('an entry with unreadable colours still loads', odd.length === 1)
  check('only its readable colour is kept', odd[0].grid.candidateColors.flat(2).filter(Boolean).length === 1 && !!odd[0].grid.candidateColors[0][0][8])

  // A newer-format entry is neither shown nor destroyed by a later write.
  saves.savePuzzle({ name: 'After', kind: 'Classic', rating: null, grid: first })
  const rewritten = JSON.parse(store.get(CLASSIC_KEY)!) as Record<string, unknown>[]
  check('a newer-format entry is kept in storage', rewritten.some((entry) => entry.id === 'from-the-future-1' && same(entry.somethingNew, [1, 2, 3])))
  check('and is still not listed', !saves.loadSavedPuzzles().some((p) => p.id === 'from-the-future-1'))

  for (const garbage of ['', 'not json', '{"a":1}', '123', 'null', '[[[', '"[]"']) {
    store.set(CLASSIC_KEY, garbage)
    let listed = -1
    try {
      listed = saves.loadSavedPuzzles().length
    } catch {
      listed = -1
    }
    check(`unreadable storage (${JSON.stringify(garbage)}) gives an empty list`, listed === 0)
  }
  check('saving works again after unreadable storage', saves.savePuzzle({ name: 'Fresh', kind: 'Classic', rating: null, grid: first }).ok && saves.loadSavedPuzzles().length === 1)
  const classicBefore = store.get(CLASSIC_KEY)

  // ---- Variant page -------------------------------------------------------
  persisted.selectVariantStorage()
  check('the Variant list starts empty: no Classic entry shows', saves.loadSavedPuzzles().length === 0)

  const variant = variantGrid()
  const savedVariant = saves.savePuzzle({ name: 'Fresh', kind: 'Anti-Knight Entropy Killer X-Sudoku', rating: null, grid: variant })
  check('variant save succeeds', savedVariant.ok)
  check('written under the Variant key', store.has(VARIANT_KEY))
  check('the Classic key is untouched by a Variant save', store.get(CLASSIC_KEY) === classicBefore)
  const variantList = saves.loadSavedPuzzles()
  check('one Variant entry, tagged variant', variantList.length === 1 && variantList[0].page === 'variant')
  check('variant grid round-trips', same(gridOnly(variantList[0].grid), gridOnly(variant)))
  check('cages and every rule flag round-trip', same(rulesOf(variantList[0].grid.constraints), rulesOf(variant.constraints)))
  check('the kind is kept', variantList[0].kind === 'Anti-Knight Entropy Killer X-Sudoku')
  check('the grid finds its own Variant save', saves.savedPuzzleOfGrid(variantList, variant)?.id === variantList[0].id)
  check('the same givens under other rules is another puzzle', saves.savedPuzzleOfGrid(variantList, { ...variant, constraints: normalizeConstraints({ ...variant.constraints!, antiKnight: false }) }) === undefined)

  // A Jigsaw's regions.
  const regions = Array.from({ length: 9 }, (_, r) => Array.from({ length: 9 }, () => r))
  const jigsaw: SavedGrid = { ...classicGrid(4), constraints: normalizeConstraints({ regions, cages: [] }) }
  saves.savePuzzle({ name: 'Rows as regions', kind: 'Jigsaw', rating: null, grid: jigsaw })
  check('regions round-trip', same(saves.loadSavedPuzzles()[0].grid.constraints?.regions, regions))

  // A Variant-page puzzle with no extra rule comes back as the Classic constraints.
  saves.savePuzzle({ name: 'Plain', kind: 'Classic', rating: null, grid: { ...classicGrid(5), constraints: CLASSIC_CONSTRAINTS } })
  check('no rules = no constraints stored', saves.loadSavedPuzzles()[0].grid.constraints === undefined)

  // A Variant entry whose layout no longer validates is skipped, not half-loaded.
  const variantStored = JSON.parse(store.get(VARIANT_KEY)!) as Record<string, unknown>[]
  const brokenLayout = { ...variantStored.find((entry) => entry.name === 'Rows as regions'), id: 'broken-layout-01', constraints: { regions: [[1, 2]], cages: [] } }
  const classicInVariant = { ...(JSON.parse(classicBefore!) as Record<string, unknown>[])[0], id: 'classic-in-variant' }
  store.set(VARIANT_KEY, JSON.stringify([brokenLayout, classicInVariant, ...variantStored]))
  const variantAfter = saves.loadSavedPuzzles()
  check('a broken layout is skipped', !variantAfter.some((p) => p.id === 'broken-layout-01'))
  check('a Classic-tagged entry in the Variant key is not listed', !variantAfter.some((p) => p.id === 'classic-in-variant'))
  check('the good Variant entries are all still there', variantAfter.length === variantStored.length)

  console.log(`${checks - failures}/${checks} checks passed`)
  if (failures > 0) {
    process.exit(1)
  }
}

main()
