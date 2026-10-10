/**
 * Tests for the "More..." practice-puzzle generator (src/practice/):
 *
 *   npm run test:practice
 *
 * Runs in Node. Covers the technique list and its four sections, the row
 * matchers behind every technique and named pattern, real generation for a
 * representative set of targets - each generated state re-derived here from
 * the app's own Techniques list and checked against the puzzle's solution -
 * the "Start from beginning" option (the puzzle at its givens, replayed here
 * one easiest move at a time), the pre-generated stock, the worker pool's
 * found / timeout / cancel /
 * crash paths (with stand-in workers), and the generators that were there
 * before (random puzzle, Simple Colouring, 3D Medusa, Dragon). Exits
 * non-zero on any failure.
 *
 *   npm run test:practice -- --all     also generates every other live target (slower)
 */
import { RULE3_TECHNIQUE_GROUPS } from '../src/settingsDefaults'
import { SudokuDragonPuzzleGenerator } from '../src/sudoku/SudokuDragonPuzzleGenerator'
import { SudokuGenerator } from '../src/sudoku/SudokuGenerator'
import { SudokuRules } from '../src/sudoku/SudokuRules'
import { SudokuSolver } from '../src/sudoku/SudokuSolver'
import type { Board } from '../src/sudoku/types'
import { applyTechniqueEffect, buildTechniqueInstances, fullTechniqueEffect, pickEasiestInstance, type TechniqueInstance } from '../src/techniqueEngine'
import {
  generatePracticePuzzle,
  generatePracticePuzzleInParallel,
  practiceSearchWindowMs,
  STOCK_LIVE_SEARCH_MS,
  type PracticeWorkerLike,
} from '../src/practice/parallelPracticePuzzle'
import {
  easiestFirstSolveReachesTarget,
  generatePracticePuzzleBlocking,
  practiceStartState,
  practiceStateIsConsistent,
  practiceStateNeedsTarget,
  walkPuzzleForTarget,
  type PracticePuzzleState,
} from '../src/practice/practicePuzzleGenerator'
import {
  decodePracticeState,
  encodePracticeState,
  pickStockPracticePuzzle,
  practiceTargetHasStock,
  transformPracticeState,
} from '../src/practice/practicePuzzleStock'
import { PRACTICE_PUZZLE_STOCK } from '../src/practice/practicePuzzleStockData'
import type { PracticeWorkerRequest, PracticeWorkerResponse } from '../src/practice/practicePuzzle.worker'
import {
  ALL_PRACTICE_TECHNIQUES_ON,
  PRACTICE_CATEGORY_TITLES,
  PRACTICE_TARGETS,
  PRACTICE_TECHNIQUES,
  practiceTargetById,
  practiceTargetRank,
  practiceTechniqueOfTarget,
  type PracticeSolverSettings,
  type PracticeTarget,
} from '../src/practice/practiceTargets'

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
const solver = new SudokuSolver()

const NOTHING_ON: PracticeSolverSettings = {
  shortSingleDigitAicEnabled: false,
  shortAicEnabled: false,
  genericAicEnabled: false,
  enabledFish: [],
  alsXzEnabled: false,
  urAicEnabled: false,
  alsAicEnabled: false,
  groupedAicEnabled: false,
  enabledExotic: [],
  doubleDragonEnabled: false,
}

// ---------------------------------------------------------------- the list

function testTechniqueList(): void {
  check('four sections, Defaults shown as Normal', same(PRACTICE_CATEGORY_TITLES, ['Normal', 'Advanced', 'Brutal', 'Unfair']))
  check('the sections are Dragon Configuration\'s four groups', RULE3_TECHNIQUE_GROUPS.length === 4 && RULE3_TECHNIQUE_GROUPS[0].title === 'Defaults')

  const ids = PRACTICE_TARGETS.map((target) => target.id)
  check('target ids are unique', new Set(ids).size === ids.length)
  check('technique ids are unique', new Set(PRACTICE_TECHNIQUES.map((t) => t.id)).size === PRACTICE_TECHNIQUES.length)
  check('no colouring technique is offered', !PRACTICE_TECHNIQUES.some((t) => /colou?r|medusa|dragon/i.test(`${t.id} ${t.name}`)))

  // Every technique sits in the section its Dragon Configuration group says.
  const rule3Of: Record<string, string> = {
    'locked-candidate': 'locked candidate',
    'naked-pair': 'naked pair',
    'naked-triple': 'naked triple',
    'naked-quad': 'naked quad',
    'hidden-pair': 'hidden pair',
    'unique-rectangle': 'UR',
    'bug-plus-n': 'BUG+N',
    'avoidable-rectangle': 'avoidable rectangle',
    'bivalue-oddagon': 'bivalue oddagon',
    'x-wing': 'x-wing',
    'short-single-digit-aic': 'short single-digit aic',
    'finned-x-wing': 'finned x-wing',
    'short-aic': 'short aic',
    swordfish: 'swordfish',
    'finned-swordfish': 'finned swordfish',
    'generic-aic': 'generic aic',
    'extended-ur': 'extended ur',
    'grouped-aic': 'grouped aic',
    'als-xz': 'als-xz',
    'ur-aic': 'ur-aic',
    'als-aic': 'als-aic',
  }
  for (const technique of PRACTICE_TECHNIQUES) {
    const rule3 = rule3Of[technique.id]
    if (rule3) {
      const group = RULE3_TECHNIQUE_GROUPS.findIndex((g) => (g.techniques as readonly string[]).includes(rule3))
      check(`${technique.id} is in its Dragon Configuration group`, group === technique.category, `group ${group}, category ${technique.category}`)
    }
  }
  // Every Dragon Configuration technique is offered.
  for (const group of RULE3_TECHNIQUE_GROUPS) {
    for (const rule3 of group.techniques) {
      check(`Dragon Configuration's "${rule3}" is offered`, Object.values(rule3Of).includes(rule3))
    }
  }
  const category = (id: string) => PRACTICE_TECHNIQUES.find((t) => t.id === id)?.category
  check('the singles are Normal', category('naked-single') === 0 && category('hidden-single') === 0)
  check('Sue-de-Coq is Unfair', category('sue-de-coq') === 3)
  check('Normal / Advanced / Brutal / Unfair are all populated', [0, 1, 2, 3].every((c) => PRACTICE_TECHNIQUES.some((t) => t.category === c)))

  // Named patterns: each its own target, after an "Any".
  const patterns = (id: string) => PRACTICE_TECHNIQUES.find((t) => t.id === id)!.targets.map((t) => t.label)
  check('Unique Rectangle types', same(patterns('unique-rectangle'), ['Any', 'Type 1', 'Type 2', 'Type 3', 'Type 4', 'Type 5', 'Type 7a', 'Type 7b', 'Type 7c', 'Type 7d, Hidden Rectangle']))
  check('single-digit patterns', same(patterns('short-single-digit-aic'), ['Any', 'Skyscraper', 'Two-String Kite', 'Crane', 'Empty Rectangle']))
  check('Short AIC patterns', same(patterns('short-aic'), ['Any', 'W-Wing', 'Y-Wing', 'Unnamed chain']))
  check('BUG+N', same(patterns('bug-plus-n'), ['Any', 'BUG+1', 'BUG+2', 'BUG+3']))
  check('Locked Candidate', same(patterns('locked-candidate'), ['Any', 'Pointing', 'Claiming']))
  check('Avoidable Rectangle', same(patterns('avoidable-rectangle'), ['Any', 'Type 1', 'Type 2']))
  check('Bivalue Oddagon', same(patterns('bivalue-oddagon'), ['Any', 'Type 1', 'Type 2']))
  for (const technique of PRACTICE_TECHNIQUES) {
    check(`${technique.id}: the whole-technique target comes first`, technique.targets[0].id === technique.id)
    for (const target of technique.targets) {
      check(`${target.id} resolves`, practiceTargetById(target.id) === target && practiceTechniqueOfTarget(target.id) === technique)
    }
  }
  check('an unknown id resolves to nothing', practiceTargetById('nope') === null && practiceTechniqueOfTarget('nope') === null)

  // Switched off = can't be picked, with a reason; switched on = fine.
  const optional = ['x-wing', 'finned-x-wing', 'swordfish', 'finned-swordfish', 'short-single-digit-aic', 'short-aic', 'generic-aic', 'extended-ur', 'sue-de-coq', 'grouped-aic', 'als-xz', 'ur-aic', 'als-aic']
  for (const technique of PRACTICE_TECHNIQUES) {
    const off = technique.disabledReason(NOTHING_ON)
    check(`${technique.id}: ${optional.includes(technique.id) ? 'needs its switch' : 'always available'}`, optional.includes(technique.id) ? typeof off === 'string' && off.includes('Technique Selections') : off === null)
    check(`${technique.id}: available with everything on`, technique.disabledReason(ALL_PRACTICE_TECHNIQUES_ON) === null)
  }
  check('one fish switch enables one fish', PRACTICE_TECHNIQUES.find((t) => t.id === 'swordfish')!.disabledReason({ ...NOTHING_ON, enabledFish: ['x-wing'] }) !== null)
}

// ------------------------------------------------------------- the matchers

/** A Techniques-list row as buildTechniqueInstances names it. */
function row(id: string, name: string, aicPattern?: string): TechniqueInstance {
  return { id, name, notation: '', usedCells: [], usedCandidates: [], eliminatedCandidates: [], solvedCandidates: [], techniqueRank: 0, ...(aicPattern ? { aicPattern } : {}) } as TechniqueInstance
}

function testMatchers(): void {
  // [a real row id + name, the targets that must claim it - and no other may].
  const cases: [TechniqueInstance, string[]][] = [
    [row('naked-single-0-1', 'Naked Single'), ['naked-single']],
    [row('hidden-single-0-1-5', 'Hidden Single'), ['hidden-single']],
    [row('locked-candidate-pointing-5-0.1-0.2', 'Locked Candidate (Pointing)'), ['locked-candidate', 'locked-candidate/pointing']],
    [row('locked-candidate-claiming-5-0.1-0.2', 'Locked Candidate (Claiming)'), ['locked-candidate', 'locked-candidate/claiming']],
    [row('naked-pair-0-1-0-2', 'Naked Pair'), ['naked-pair']],
    [row('naked-triple-0.1-0.2-0.3', 'Naked Triple'), ['naked-triple']],
    [row('naked-quad-0.1-0.2-0.3-0.4', 'Naked Quad'), ['naked-quad']],
    [row('hidden-pair-0-1-0-2-3-4', 'Hidden Pair'), ['hidden-pair']],
    // The id is the finder's type name, spaces out, lower case: "Type 7a" -> ur-type7a-...
    ...['1', '2', '3', '4', '5', '7a', '7b', '7c', '7d'].map(
      (type): [TechniqueInstance, string[]] => [
        row(`ur-type${type}-0.0-0.1-3.0-3.1-1,2`, `Unique Rectangle (Type ${type}${type === '7d' ? ', Hidden Rectangle' : ''})`),
        ['unique-rectangle', `unique-rectangle/type-${type}`],
      ],
    ),
    // A row merging two types is a Unique Rectangle, but neither type alone.
    [row('ur-types4&7b-0.0-0.1-3.0-3.1-1,2', 'Unique Rectangle (Types 4 & 7b)'), ['unique-rectangle']],
    [row('bug-plus-n-1-4.4', 'BUG+1'), ['bug-plus-n', 'bug-plus-n/1']],
    [row('bug-plus-n-2-1.1-7.8', 'BUG+2'), ['bug-plus-n', 'bug-plus-n/2']],
    [row('bug-plus-n-3-1.1-7.8-2.2', 'BUG+3'), ['bug-plus-n', 'bug-plus-n/3']],
    [row('avoidable-rectangle-1-0.0-0.1-3.0-3.1-x', 'Avoidable Rectangle (Type 1)'), ['avoidable-rectangle', 'avoidable-rectangle/type-1']],
    [row('avoidable-rectangle-2-0.0-0.1-3.0-3.1-x', 'Avoidable Rectangle (Type 2)'), ['avoidable-rectangle', 'avoidable-rectangle/type-2']],
    [row('bivalue-oddagon-1-x', 'Bivalue Oddagon (Type 1)'), ['bivalue-oddagon', 'bivalue-oddagon/type-1']],
    [row('bivalue-oddagon-2-x', 'Bivalue Oddagon (Type 2)'), ['bivalue-oddagon', 'bivalue-oddagon/type-2']],
    [row('fish-x-wing-5-row-01-23', 'X-Wing'), ['x-wing']],
    [row('fish-finned x-wing-5-row-01-23', 'Finned X-Wing'), ['finned-x-wing']],
    [row('fish-swordfish-5-row-012-345', 'Swordfish'), ['swordfish']],
    [row('fish-finned swordfish-5-row-012-345', 'Finned Swordfish'), ['finned-swordfish']],
    [row('short-single-digit-aic-1-x', 'Skyscraper', 'Skyscraper'), ['short-single-digit-aic', 'short-single-digit-aic/skyscraper']],
    [row('short-single-digit-aic-1-x', 'Two-String Kite', 'Two-String Kite'), ['short-single-digit-aic', 'short-single-digit-aic/two-string-kite']],
    [row('short-single-digit-aic-1-x', 'Crane', 'Crane'), ['short-single-digit-aic', 'short-single-digit-aic/crane']],
    [row('short-single-digit-aic-1-x', 'Empty Rectangle', 'Empty Rectangle'), ['short-single-digit-aic', 'short-single-digit-aic/empty-rectangle']],
    [row('short-aic-2-x', 'W-Wing', 'W-Wing'), ['short-aic', 'short-aic/w-wing']],
    [row('short-aic-2-x', 'Y-Wing', 'Y-Wing'), ['short-aic', 'short-aic/y-wing']],
    [row('short-aic-2-x', 'Short AIC (Type 2)'), ['short-aic', 'short-aic/unnamed']],
    [row('generic-aic-1-x', 'Generic AIC (Type 1; 7 links)'), ['generic-aic']],
    [row('grouped-aic-1-x', 'Grouped AIC'), ['grouped-aic']],
    [row('als-xz-x', 'ALS-xz'), ['als-xz']],
    [row('uraic-1-x', 'UR-AIC (Type 1; 5 links)'), ['ur-aic']],
    [row('alsaic-1-x', 'ALS-AIC (Type 1; 5 links)'), ['als-aic']],
    [row('sue-de-coq-x', 'Sue-de-Coq'), ['sue-de-coq']],
    [row('extended-ur-1-x', 'Extended UR (Type 1)'), ['extended-ur']],
    // Colouring rows and the Variant page's rows belong to no target.
    [row('simple-color-rule1-5-x', 'Simple Colouring Rule 1 (5)'), []],
    [row('medusa-x', '3D Medusa Rule 2'), []],
    [row('dragon-x', 'Dragon Colouring'), []],
    [row('dynamic-dragon-x', 'Dynamic Dragon Colouring'), []],
    [row('killer-45-x', 'Rule of 45'), []],
  ]
  const claimed = new Set<string>()
  for (const [instance, expected] of cases) {
    const got = PRACTICE_TARGETS.filter((target) => target.matches(instance)).map((target) => target.id)
    check(`row "${instance.name}" (${instance.id}) -> ${expected.join(' + ') || 'nothing'}`, same([...got].sort(), [...expected].sort()), `got ${got.join(', ') || 'nothing'}`)
    expected.forEach((id) => claimed.add(id))
  }
  for (const target of PRACTICE_TARGETS) {
    check(`${target.id} has a matcher case`, claimed.has(target.id))
  }
}

// ----------------------------------------------- a generated state, examined

function fullList(state: PracticePuzzleState, settings: PracticeSolverSettings): TechniqueInstance[] {
  // Spelled out again here rather than through the generator's own helper.
  return buildTechniqueInstances(
    state.board, state.candidates, 0, new Set(), settings.shortAicEnabled, settings.shortSingleDigitAicEnabled, true, false,
    settings.genericAicEnabled, false, false, false, new Set(settings.enabledFish), settings.alsXzEnabled, Infinity,
    settings.doubleDragonEnabled, false, state.givens, new Set(settings.enabledExotic), settings.urAicEnabled, settings.alsAicEnabled,
    settings.groupedAicEnabled,
  )
}

/** Everything a served practice state has to be, checked from scratch. */
function examineState(label: string, state: PracticePuzzleState, settings: PracticeSolverSettings, target: PracticeTarget): void {
  // The puzzle: its givens alone have exactly one solution.
  const puzzle: Board = state.board.map((r, i) => r.map((value, j) => (state.givens[i][j] ? value : 0)))
  const solutions = solver.findSolutions(puzzle, 2)
  check(`${label}: the givens have exactly one solution`, solutions.length === 1)
  if (solutions.length !== 1) {
    return
  }
  const [solution] = solutions
  let digitsRight = true
  let marksRight = true
  let marksLegal = true
  let givensFilled = true
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const value = state.board[r][c]
      if (state.givens[r][c] && value === 0) givensFilled = false
      if (value !== 0) {
        if (value !== solution[r][c]) digitsRight = false
        if (state.candidates[r][c].some(Boolean)) marksLegal = false
      } else {
        if (!state.candidates[r][c][solution[r][c] - 1]) marksRight = false
        // No mark the placed digits already rule out (what Autofill would never give).
        state.candidates[r][c].forEach((on, d) => {
          if (on && !SudokuRules.isSafe(state.board, r, c, d + 1)) marksLegal = false
        })
      }
    }
  }
  check(`${label}: every given is on the board`, givensFilled)
  check(`${label}: every placed digit is the solution's`, digitsRight)
  check(`${label}: every empty cell still has its solution digit`, marksRight)
  check(`${label}: no candidate conflicts with a placed digit`, marksLegal)
  check(`${label}: not solved yet`, state.board.flat().some((value) => value === 0))
  check(`${label}: the generator's own consistency check agrees`, practiceStateIsConsistent(state, solution))

  // The technique: the app's full Techniques list, its easiest tier.
  const instances = fullList(state, settings)
  const lowest = Math.min(...instances.map((instance) => instance.techniqueRank))
  const easiest = instances.filter((instance) => instance.techniqueRank === lowest)
  check(`${label}: something applies`, instances.length > 0)
  check(`${label}: a ${target.name} row is in the easiest tier`, easiest.some((instance) => target.matches(instance)))
  check(`${label}: the target's rows are of the tier practiceTargetRank says`, easiest.filter((i) => target.matches(i)).every((i) => i.techniqueRank === practiceTargetRank(target.id)))
  const strangers = easiest.filter((instance) => !target.matches(instance))
  check(`${label}: nothing else is in the easiest tier`, strangers.length === 0, strangers.map((s) => s.name).join(', '))
  const easier = instances.filter((instance) => instance.techniqueRank < Math.min(...instances.filter((i) => target.matches(i)).map((i) => i.techniqueRank)))
  check(`${label}: no easier technique makes progress`, easier.length === 0, easier.map((s) => s.name).join(', '))
  // What the Hint popup and Easy Solve would pick.
  const pick = pickEasiestInstance(instances)
  check(`${label}: the easiest-first pick is a ${target.name}`, pick !== null && target.matches(pick), pick?.name)
  check(`${label}: the target's rows make real progress`, easiest.every((instance) => instance.eliminatedCandidates.length + instance.solvedCandidates.length > 0))
  check(`${label}: practiceStateNeedsTarget agrees`, practiceStateNeedsTarget(state, settings, target))
}

/** The switches a target needs and nothing else. */
function ownSettings(targetId: string): PracticeSolverSettings {
  const technique = practiceTechniqueOfTarget(targetId)!
  const tries: PracticeSolverSettings[] = [
    NOTHING_ON,
    { ...NOTHING_ON, shortSingleDigitAicEnabled: true },
    { ...NOTHING_ON, shortSingleDigitAicEnabled: true, shortAicEnabled: true },
    { ...NOTHING_ON, shortSingleDigitAicEnabled: true, shortAicEnabled: true, genericAicEnabled: true },
    ...(['x-wing', 'finned x-wing', 'swordfish', 'finned swordfish'] as const).map((fish) => ({ ...NOTHING_ON, enabledFish: [fish] })),
    { ...NOTHING_ON, alsXzEnabled: true },
    { ...NOTHING_ON, urAicEnabled: true },
    { ...NOTHING_ON, alsAicEnabled: true },
    { ...NOTHING_ON, groupedAicEnabled: true },
    { ...NOTHING_ON, enabledExotic: ['sue de coq'] },
    { ...NOTHING_ON, enabledExotic: ['extended ur'] },
  ]
  return tries.find((settings) => technique.disabledReason(settings) === null)!
}

function testGeneration(all: boolean): void {
  // One or two per section, a named pattern of each family, Sue-de-Coq.
  const representative = [
    'hidden-single', 'locked-candidate/pointing', 'naked-triple', 'hidden-pair', 'unique-rectangle/type-1', 'unique-rectangle/type-4',
    'unique-rectangle/type-7d', 'bug-plus-n/1', 'avoidable-rectangle/type-1', 'bivalue-oddagon',
    'x-wing', 'short-single-digit-aic/skyscraper', 'short-single-digit-aic/two-string-kite', 'short-single-digit-aic/empty-rectangle',
    'finned-x-wing', 'short-aic/w-wing', 'short-aic/y-wing',
    'finned-swordfish', 'generic-aic',
    'extended-ur', 'sue-de-coq',
  ]
  const ids = all ? PRACTICE_TARGETS.map((target) => target.id).filter((id) => !practiceTargetHasStock(id)) : representative
  for (const id of ids) {
    const target = practiceTargetById(id)!
    // Every optional technique on: the strictest hierarchy. And, for the
    // representative ones, the target's own switch alone: the loosest.
    for (const [profile, settings] of [['all on', ALL_PRACTICE_TECHNIQUES_ON], ...(all ? [] : [['own switch only', ownSettings(id)]])] as [string, PracticeSolverSettings][]) {
      const started = Date.now()
      const result = generatePracticePuzzleBlocking({ targetId: id, settings, timeBudgetMs: 60_000 })
      check(`${id} [${profile}]: generated`, result.state !== null, `none in ${Date.now() - started} ms, ${result.puzzlesTried} puzzles`)
      if (result.state) {
        examineState(`${id} [${profile}]`, result.state, settings, target)
      }
    }
  }
}

function testWalk(): void {
  // A state that needs the target is returned as it stands; a solved or
  // stuck puzzle gives null; a deadline in the past stops the walk at once.
  const target = practiceTargetById('hidden-single')!
  const puzzle = new SudokuGenerator().generate()
  check('a walk past its deadline returns nothing', walkPuzzleForTarget(puzzle, NOTHING_ON, target, Date.now() - 1) === null)
  const solved = solver.findSolutions(puzzle, 1)[0]
  check('a solved grid has no state to offer', walkPuzzleForTarget(solved, NOTHING_ON, target) === null)
  check('a solved grid needs nothing', !practiceStateNeedsTarget({ board: solved, givens: solved.map((r) => r.map(() => true)), candidates: solved.map((r) => r.map(() => Array(9).fill(false))) }, NOTHING_ON, target))
}

// ------------------------------------------------- "Start from beginning"

/** A person's solve, replayed with the full Techniques list (not the
 * generator's easiest-tier shortcut): one move at a time, always from the
 * easiest tier that has any, the picked technique left for last among equally
 * easy ones. Returns the state where the easiest tier is all target, or why
 * there was none. */
function solveFromStart(puzzle: Board, settings: PracticeSolverSettings, target: PracticeTarget): { reached: PracticePuzzleState | null; why: string; moves: number } {
  let state = practiceStartState(puzzle)
  const targetRank = practiceTargetRank(target.id)
  for (let moves = 0; moves < 2000; moves++) {
    const instances = fullList(state, settings)
    if (instances.length === 0) {
      return { reached: null, why: 'solved or stuck', moves }
    }
    const lowest = Math.min(...instances.map((instance) => instance.techniqueRank))
    const easiest = instances.filter((instance) => instance.techniqueRank === lowest)
    const other = easiest.find((instance) => !target.matches(instance))
    if (!other) {
      return { reached: state, why: '', moves }
    }
    if (lowest > targetRank) {
      return { reached: null, why: `needs ${other.name} first`, moves }
    }
    const { board, candidates } = applyTechniqueEffect(state.board, state.candidates, fullTechniqueEffect(other))
    state = { board, givens: state.givens, candidates }
  }
  return { reached: null, why: 'never ended', moves: 2000 }
}

/** What a "from the beginning" puzzle has to be. */
function examineStart(label: string, start: PracticePuzzleState, settings: PracticeSolverSettings, target: PracticeTarget): void {
  const clues = start.board.flat().filter(Boolean).length
  check(`${label}: only the givens are on the grid`, start.board.every((r, i) => r.every((value, j) => (value !== 0) === start.givens[i][j])))
  check(`${label}: 17 to 30 givens`, clues >= 17 && clues <= 30, `${clues}`)
  check(`${label}: one solution`, solver.findSolutions(start.board, 2).length === 1)
  check(`${label}: the candidates are a plain autofill`, same(start.candidates, practiceStartState(start.board).candidates))
  const solve = solveFromStart(start.board, settings, target)
  check(`${label}: an easiest-first solve reaches a point that needs ${target.name}`, solve.reached !== null, solve.why)
  if (solve.reached) {
    check(`${label}: that point is not the start itself, or the start already needs it`, solve.moves > 0 || practiceStateNeedsTarget(start, settings, target))
    examineState(`${label}, at the point reached after ${solve.moves} moves`, solve.reached, settings, target)
  }
  check(`${label}: the generator's own replay agrees`, easiestFirstSolveReachesTarget(start.board, settings, target))
}

function testFromStart(all: boolean): void {
  const representative = [
    'hidden-single', 'locked-candidate/claiming', 'naked-pair', 'naked-triple', 'hidden-pair', 'unique-rectangle/type-1', 'unique-rectangle/type-7b',
    'bug-plus-n/1', 'x-wing', 'short-single-digit-aic/skyscraper', 'short-single-digit-aic/two-string-kite', 'short-aic/w-wing', 'short-aic/y-wing',
    'finned-swordfish', 'generic-aic', 'sue-de-coq',
  ]
  const ids = all ? PRACTICE_TARGETS.map((target) => target.id).filter((id) => !practiceTargetHasStock(id)) : representative
  for (const id of ids) {
    const target = practiceTargetById(id)!
    for (const [profile, settings] of [['all on', ALL_PRACTICE_TECHNIQUES_ON], ...(all ? [] : [['own switch only', ownSettings(id)]])] as [string, PracticeSolverSettings][]) {
      const started = Date.now()
      const result = generatePracticePuzzleBlocking({ targetId: id, settings, timeBudgetMs: 90_000, fromStart: true })
      check(`from start, ${id} [${profile}]: generated`, result.state !== null, `none in ${Date.now() - started} ms, ${result.puzzlesTried} puzzles`)
      if (result.state) {
        examineStart(`from start, ${id} [${profile}]`, result.state, settings, target)
      }
    }
  }

  // A puzzle that needs something harder before the pick is turned down.
  const target = practiceTargetById('naked-pair')!
  const hard = generatePracticePuzzleBlocking({ targetId: 'generic-aic', settings: ALL_PRACTICE_TECHNIQUES_ON, timeBudgetMs: 60_000, fromStart: true }).state
  if (hard) {
    // It needs a Generic AIC with nothing harder first; asked for a Naked
    // Pair, a walk of it either finds one earlier or stops at what is harder.
    const walked = walkPuzzleForTarget(hard.board, ALL_PRACTICE_TECHNIQUES_ON, target, Infinity, true)
    check('nothing-harder-first: a state returned really has nothing harder before it', walked === null || solveFromStart(hard.board, ALL_PRACTICE_TECHNIQUES_ON, target).reached !== null)
    check('the replay and the walk agree on it', (walked !== null) === easiestFirstSolveReachesTarget(hard.board, ALL_PRACTICE_TECHNIQUES_ON, target) || walked !== null)
  }
  const solved = solver.findSolutions(new SudokuGenerator().generate(), 1)[0]
  check('a solved grid reaches nothing', !easiestFirstSolveReachesTarget(solved, NOTHING_ON, target))

  // The stock, from the start: served only when the replay passes.
  for (const targetId of Object.keys(PRACTICE_PUZZLE_STOCK)) {
    const stockTarget = practiceTargetById(targetId)!
    const alone: PracticeSolverSettings = {
      ...ALL_PRACTICE_TECHNIQUES_ON,
      groupedAicEnabled: targetId === 'grouped-aic',
      alsXzEnabled: targetId === 'als-xz',
      urAicEnabled: targetId === 'ur-aic',
      alsAicEnabled: targetId === 'als-aic',
    }
    let served = 0
    for (let i = 0; i < 3; i++) {
      const start = pickStockPracticePuzzle(targetId, alone, Math.random, true)
      if (start) {
        served++
        if (i === 0) {
          examineStart(`stock from start, ${targetId}`, start, alone, stockTarget)
        }
      }
    }
    console.log(`  stock ${targetId} from the start: ${served}/3 picks served`)
  }
}

// ---------------------------------------------------------------- the stock

function testStock(): void {
  const sample = generatePracticePuzzleBlocking({ targetId: 'naked-pair', settings: NOTHING_ON, timeBudgetMs: 30_000 }).state!
  const text = encodePracticeState(sample)
  check('encode -> decode is the same state', same(decodePracticeState(text), sample))
  check('the encoding is 81 | 81 | 162 characters', /^[0-9]{81}\|[01]{81}\|[0-9a-v]{162}$/.test(text))
  for (const [name, bad] of [
    ['empty', ''],
    ['too short', text.slice(1)],
    ['a letter on the board', `x${text.slice(1)}`],
    ['two parts', text.split('|').slice(0, 2).join('|')],
    ['a mask over 511', `${text.slice(0, 164)}vv${text.slice(166)}`],
    ['a given with no digit', `${'0'.repeat(81)}|${'1'.repeat(81)}|${'00'.repeat(81)}`],
    ['marks in a filled cell', `${'1'.repeat(81)}|${'0'.repeat(81)}|${'0v'.repeat(81)}`],
  ] as const) {
    check(`decode rejects: ${name}`, decodePracticeState(bad) === null)
  }

  // A symmetry keeps the puzzle a puzzle and the technique the technique.
  const target = practiceTargetById('naked-pair')!
  let seed = 12345
  const random = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  for (let i = 0; i < 8; i++) {
    const moved = transformPracticeState(sample, random)
    check(`symmetry ${i}: same number of digits and marks`, moved.board.flat().filter(Boolean).length === sample.board.flat().filter(Boolean).length && moved.candidates.flat(2).filter(Boolean).length === sample.candidates.flat(2).filter(Boolean).length)
    examineState(`symmetry ${i} of a Naked Pair state`, moved, NOTHING_ON, target)
  }

  // Every entry: well-formed, a real puzzle, and needing its target with
  // every technique on or - for the entries mined for one Unfair technique
  // at a time - with the other techniques ranked above Dragon off.
  for (const [targetId, entries] of Object.entries(PRACTICE_PUZZLE_STOCK)) {
    const stockTarget = practiceTargetById(targetId)
    check(`stock target ${targetId} exists`, stockTarget !== null)
    if (!stockTarget) continue
    check(`stock ${targetId}: no duplicates`, new Set(entries).size === entries.length)
    const alone: PracticeSolverSettings = {
      ...ALL_PRACTICE_TECHNIQUES_ON,
      groupedAicEnabled: targetId === 'grouped-aic',
      alsXzEnabled: targetId === 'als-xz',
      urAicEnabled: targetId === 'ur-aic',
      alsAicEnabled: targetId === 'als-aic',
    }
    let holdsWithEverythingOn = 0
    entries.forEach((entry, index) => {
      const state = decodePracticeState(entry)
      check(`stock ${targetId} #${index}: decodes`, state !== null)
      if (!state) return
      const everythingOn = practiceStateNeedsTarget(state, ALL_PRACTICE_TECHNIQUES_ON, stockTarget)
      if (everythingOn) holdsWithEverythingOn++
      const settings = everythingOn ? ALL_PRACTICE_TECHNIQUES_ON : alone
      examineState(`stock ${targetId} #${index}${everythingOn ? '' : ' [own Unfair technique only]'}`, state, settings, stockTarget)
    })
    console.log(`  stock ${targetId}: ${entries.length} positions, ${holdsWithEverythingOn} of them with every technique on`)
    // Served: verified under the caller's settings, or nothing at all.
    for (const settings of [ALL_PRACTICE_TECHNIQUES_ON, alone, { ...alone, doubleDragonEnabled: true }]) {
      const served = pickStockPracticePuzzle(targetId, settings, random)
      check(`stock ${targetId}: what is served needs the target`, served === null || practiceStateNeedsTarget(served, settings, stockTarget))
    }
    check(`stock ${targetId}: served with its own technique alone`, pickStockPracticePuzzle(targetId, alone, random) !== null)
  }
  check('no stock for a common target', !practiceTargetHasStock('naked-pair') && pickStockPracticePuzzle('naked-pair', NOTHING_ON) === null)
  check('no stock for an unknown target', pickStockPracticePuzzle('nope', NOTHING_ON) === null)
  check('a stock target searches live for a short window only', Object.keys(PRACTICE_PUZZLE_STOCK).every((id) => practiceSearchWindowMs(id, 30_000) === STOCK_LIVE_SEARCH_MS))
  check('any other target gets the whole timeout', practiceSearchWindowMs('naked-pair', 30_000) === 30_000)
}

// ------------------------------------------------- the pool: stand-in workers

type Behaviour = 'find' | 'never' | 'crash' | 'throw-on-create' | 'real'

/** A Worker stand-in: answers a search as `behaviour` says, a stock request
 * with the real picker. `terminated` is how the tests see the pool clean up. */
function fakeWorkers(behaviours: Behaviour[], state: PracticePuzzleState | null) {
  const made: { terminated: boolean; requests: PracticeWorkerRequest[] }[] = []
  let next = 0
  const createWorker = (): PracticeWorkerLike => {
    const behaviour = behaviours[Math.min(next++, behaviours.length - 1)]
    if (behaviour === 'throw-on-create') {
      throw new Error('no workers here')
    }
    const record = { terminated: false, requests: [] as PracticeWorkerRequest[] }
    made.push(record)
    const worker: PracticeWorkerLike = {
      onmessage: null,
      onerror: null,
      terminate: () => {
        record.terminated = true
      },
      postMessage: (request) => {
        record.requests.push(request)
        const reply = (response: PracticeWorkerResponse) => setTimeout(() => !record.terminated && worker.onmessage?.({ data: response }), 5)
        if (request.kind === 'stock') {
          reply({ kind: 'done', state: pickStockPracticePuzzle(request.targetId, request.settings), puzzlesTried: 0 })
        } else if (behaviour === 'crash') {
          setTimeout(() => !record.terminated && worker.onerror?.({}), 5)
        } else if (behaviour === 'find') {
          reply({ kind: 'progress', puzzlesTried: 3 })
          setTimeout(() => !record.terminated && worker.onmessage?.({ data: { kind: 'done', state, puzzlesTried: 7 } }), 30)
        } else if (behaviour === 'real') {
          const result = generatePracticePuzzleBlocking(request.options)
          reply({ kind: 'done', state: result.state, puzzlesTried: result.puzzlesTried })
        } else {
          reply({ kind: 'progress', puzzlesTried: 5 })
          setTimeout(() => !record.terminated && worker.onmessage?.({ data: { kind: 'done', state: null, puzzlesTried: 9 } }), request.options.timeBudgetMs)
        }
      },
    }
    return worker
  }
  return { createWorker, made }
}

async function testPool(): Promise<void> {
  const settings = NOTHING_ON
  const sample = generatePracticePuzzleBlocking({ targetId: 'naked-pair', settings, timeBudgetMs: 30_000 }).state!
  const options = { targetId: 'naked-pair', settings, timeBudgetMs: 400 }

  {
    const { createWorker, made } = fakeWorkers(['never', 'find', 'never'], sample)
    const progress: number[] = []
    const outcome = await generatePracticePuzzleInParallel(options, { createWorker, workerCount: 3, onProgress: (n) => progress.push(n) })
    check('found: the first find wins', outcome.kind === 'found' && same(outcome.state, sample) && outcome.fromStock === false)
    check('found: every worker is terminated', made.length === 3 && made.every((w) => w.terminated))
    check('found: every worker got the same search', made.every((w) => same(w.requests, [{ kind: 'search', options }])))
    check('found: progress was reported, summed over the workers', progress.length > 0 && progress[progress.length - 1] >= 5)
    check('found: well inside the time limit', outcome.elapsedMs < 300)
  }
  {
    const { createWorker, made } = fakeWorkers(['never'], null)
    const outcome = await generatePracticePuzzleInParallel(options, { createWorker, workerCount: 4 })
    check('timeout: reported as a timeout', outcome.kind === 'timeout')
    check('timeout: counts what was tried', outcome.puzzlesTried === 4 * 9)
    check('timeout: ends at the time limit, not later', outcome.elapsedMs >= 350 && outcome.elapsedMs < 2500, `${outcome.elapsedMs} ms`)
    check('timeout: every worker is terminated', made.every((w) => w.terminated))
  }
  {
    const { createWorker, made } = fakeWorkers(['never'], null)
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 60)
    const outcome = await generatePracticePuzzleInParallel({ ...options, timeBudgetMs: 20_000 }, { createWorker, workerCount: 3, signal: controller.signal })
    check('cancel: reported as cancelled', outcome.kind === 'cancelled')
    check('cancel: stops at once, long before the time limit', outcome.elapsedMs < 1000, `${outcome.elapsedMs} ms`)
    check('cancel: every worker is terminated', made.length === 3 && made.every((w) => w.terminated))
  }
  {
    const { createWorker, made } = fakeWorkers(['never'], null)
    const controller = new AbortController()
    controller.abort()
    const outcome = await generatePracticePuzzleInParallel(options, { createWorker, workerCount: 3, signal: controller.signal })
    check('already cancelled: nothing is started', outcome.kind === 'cancelled' && made.length === 0)
  }
  {
    // One worker dies, the others carry on.
    const { createWorker } = fakeWorkers(['crash', 'find'], sample)
    const outcome = await generatePracticePuzzleInParallel(options, { createWorker, workerCount: 2 })
    check('one crash: the search still finds', outcome.kind === 'found')
  }
  {
    // Every worker dies: the main-thread search takes over with the time left.
    const { createWorker } = fakeWorkers(['crash'], null)
    const outcome = await generatePracticePuzzleInParallel({ ...options, timeBudgetMs: 30_000 }, { createWorker, workerCount: 2 })
    check('every worker crashed: found on the main thread instead', outcome.kind === 'found')
    if (outcome.kind === 'found') {
      examineState('main-thread fallback', outcome.state, settings, practiceTargetById('naked-pair')!)
    }
  }
  {
    const { createWorker } = fakeWorkers(['throw-on-create'], null)
    const outcome = await generatePracticePuzzleInParallel({ ...options, timeBudgetMs: 30_000 }, { createWorker, workerCount: 2 })
    check('no worker can be created: found on the main thread instead', outcome.kind === 'found')
  }
  {
    // The main-thread search itself: cancellable between puzzles, and it
    // times out like the pool does.
    const { createWorker } = fakeWorkers(['throw-on-create'], null)
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 150)
    const rare = { targetId: 'als-aic', settings: ALL_PRACTICE_TECHNIQUES_ON, timeBudgetMs: 20_000 }
    const cancelled = await generatePracticePuzzleInParallel(rare, { createWorker, signal: controller.signal })
    check('main-thread search: cancellable', cancelled.kind === 'cancelled' && cancelled.elapsedMs < 5000, `${cancelled.kind} after ${cancelled.elapsedMs} ms`)
    const timedOut = await generatePracticePuzzleInParallel({ ...rare, timeBudgetMs: 300 }, { createWorker })
    check('main-thread search: times out', timedOut.kind === 'timeout' || timedOut.kind === 'found', timedOut.kind)
  }
  {
    // The real generator behind the pool, end to end.
    const { createWorker } = fakeWorkers(['real'], null)
    const outcome = await generatePracticePuzzleInParallel({ targetId: 'unique-rectangle/type-1', settings, timeBudgetMs: 30_000 }, { createWorker, workerCount: 1 })
    check('real generator through the pool: found', outcome.kind === 'found')
    if (outcome.kind === 'found') {
      examineState('through the pool', outcome.state, settings, practiceTargetById('unique-rectangle/type-1')!)
    }
  }

  // The blocking generator's own limits.
  const none = generatePracticePuzzleBlocking({ targetId: 'als-aic', settings: ALL_PRACTICE_TECHNIQUES_ON, timeBudgetMs: 0 })
  check('no time: nothing, at once', none.state === null && none.puzzlesTried === 0)
  const one = generatePracticePuzzleBlocking({ targetId: 'als-aic', settings: ALL_PRACTICE_TECHNIQUES_ON, timeBudgetMs: 60_000, maxPuzzles: 1 })
  check('maxPuzzles stops the search', one.puzzlesTried === 1)
  let threw = false
  try {
    generatePracticePuzzleBlocking({ targetId: 'nope', settings, timeBudgetMs: 100 })
  } catch {
    threw = true
  }
  check('an unknown target is an error, not a silent timeout', threw)
  let reported = 0
  generatePracticePuzzleBlocking({ targetId: 'naked-pair', settings, timeBudgetMs: 30_000 }, () => reported++)
  check('progress is reported per puzzle', reported > 0)

  // Stock fallback: the live window ends empty, a stock position is served.
  const stocked = Object.keys(PRACTICE_PUZZLE_STOCK)[0]
  if (stocked) {
    const alone: PracticeSolverSettings = {
      ...ALL_PRACTICE_TECHNIQUES_ON,
      groupedAicEnabled: stocked === 'grouped-aic',
      alsXzEnabled: stocked === 'als-xz',
      urAicEnabled: stocked === 'ur-aic',
      alsAicEnabled: stocked === 'als-aic',
    }
    const { createWorker, made } = fakeWorkers(['never'], null)
    let fellBack = false
    const outcome = await generatePracticePuzzle({ targetId: stocked, settings: alone, timeBudgetMs: 30_000 }, { createWorker, workerCount: 2, onStockFallback: () => (fellBack = true) })
    check(`stock fallback (${stocked}): a stock position is served`, outcome.kind === 'found' && outcome.fromStock === true && fellBack)
    check('stock fallback: after the short live window, not the whole timeout', outcome.elapsedMs >= STOCK_LIVE_SEARCH_MS - 100 && outcome.elapsedMs < STOCK_LIVE_SEARCH_MS + 8000, `${outcome.elapsedMs} ms`)
    check('stock fallback: picked off the main thread, workers cleaned up', made.some((w) => w.requests.some((r) => r.kind === 'stock')) && made.every((w) => w.terminated))
    if (outcome.kind === 'found') {
      examineState('stock fallback', outcome.state, alone, practiceTargetById(stocked)!)
    }
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 80)
    const cancelled = await generatePracticePuzzle({ targetId: stocked, settings: alone, timeBudgetMs: 30_000 }, { createWorker: fakeWorkers(['never'], null).createWorker, workerCount: 2, signal: controller.signal })
    check('stock target: cancel during the live window serves nothing', cancelled.kind === 'cancelled')
  }
  {
    const { createWorker } = fakeWorkers(['never'], null)
    const outcome = await generatePracticePuzzle({ ...options, timeBudgetMs: 300 }, { createWorker, workerCount: 2 })
    check('no stock: a timeout stays a timeout', outcome.kind === 'timeout')
  }
}

// ------------------------------------------- what was there before (regression)

function testExistingGenerators(): void {
  // The random puzzle button.
  const random = new SudokuGenerator()
  for (let i = 0; i < 5; i++) {
    const puzzle = random.generate()
    const clues = puzzle.flat().filter(Boolean).length
    check(`random puzzle ${i}: one solution`, solver.findSolutions(puzzle, 2).length === 1)
    check(`random puzzle ${i}: 17 to 30 clues, as before`, clues >= 17 && clues <= 30, `${clues}`)
  }

  // The colouring buttons: untouched generator, same contract.
  const dragon = new SudokuDragonPuzzleGenerator()
  const defaults = (state: { board: Board; candidates: boolean[][][]; givens: boolean[][] }) => buildTechniqueInstances(state.board, state.candidates, 0, undefined, false, false, true, false, false, false, false, false, new Set(), false, Infinity, false, false, state.givens)
  for (const [target, rowPrefix] of [['simple-colouring', 'simple-color-'], ['medusa', 'medusa-']] as const) {
    const result = dragon.generateBlocking({ target, timeBudgetMs: 60_000 })
    check(`${target} puzzle: generated`, result !== null)
    if (!result) continue
    check(`${target} puzzle: one solution`, solver.findSolutions(result.board.map((r, i) => r.map((v, j) => (result.givens[i][j] ? v : 0))), 2).length === 1)
    check(`${target} puzzle: every filled cell is a given, as before`, result.board.every((r, i) => r.every((v, j) => (v !== 0) === result.givens[i][j])))
    const rows = defaults(result)
    const lowest = Math.min(...rows.map((r) => r.techniqueRank))
    const easiest = rows.filter((r) => r.techniqueRank === lowest)
    check(`${target} puzzle: its technique is the easiest one that applies`, easiest.length > 0 && easiest.every((r) => r.id.startsWith(rowPrefix)), easiest.map((r) => r.name).join(', '))
    check(`${target} puzzle: passes the generator's own re-check`, dragon.checkPuzzleState(result.board, { target }) !== null)
  }
  const options = { timeBudgetMs: 120_000, disregardSingleDigitAic: true, disregardAic: true, disregardGenericAic: true }
  const result = dragon.generateBlocking(options)
  check('Dragon puzzle: generated', result !== null)
  if (result) {
    check('Dragon puzzle: one solution', solver.findSolutions(result.board, 2).length === 1)
    const rows = defaults(result)
    check('Dragon puzzle: a Dragon applies and nothing easier does', rows.length > 0 && rows.every((r) => r.id.startsWith('dragon-')), [...new Set(rows.map((r) => r.name))].join(', '))
    check("Dragon puzzle: passes the generator's own re-check", dragon.checkPuzzleState(result.board, options) !== null)
  }
}

async function main(): Promise<void> {
  const all = process.argv.includes('--all')
  const started = Date.now()
  const section = async (name: string, run: () => void | Promise<void>) => {
    const before = [checks, failures]
    const t = Date.now()
    await run()
    console.log(`${name}: ${checks - before[0] - (failures - before[1])}/${checks - before[0]} checks, ${((Date.now() - t) / 1000).toFixed(1)}s`)
  }
  await section('technique list and sections', testTechniqueList)
  await section('row matchers', testMatchers)
  await section('walk', testWalk)
  await section(`generation (${all ? 'every live target' : 'representative targets'})`, () => testGeneration(all))
  await section(`start from beginning (${all ? 'every live target' : 'representative targets'})`, () => testFromStart(all))
  await section('stock', testStock)
  await section('worker pool: found / timeout / cancel / crash', testPool)
  await section('existing generators', testExistingGenerators)
  console.log(`${checks - failures}/${checks} checks passed in ${((Date.now() - started) / 1000).toFixed(0)}s`)
  process.exit(failures > 0 ? 1 : 0)
}

void main()
