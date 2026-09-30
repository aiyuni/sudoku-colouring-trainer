import type { Rule3Technique } from '../sudoku/SudokuDragonFinder'
import { SAMPLE_PUZZLE } from '../sudoku/types'
import {
  buildBivalueOddagonLesson,
  buildAvoidableRectangleLesson,
  buildBugPlusNLesson,
  buildDoubleDragonLesson,
  buildDragonLesson,
  buildHiddenSingleLesson,
  buildLockedCandidatesLesson,
  buildMedusaLesson,
  buildNakedPairLesson,
  buildNakedSingleLesson,
  buildSimpleColouringLesson,
  buildUniqueRectangleLesson,
} from './lessonBuilders'
import { decodePuzzleState } from './puzzleState'
import type { TutorialLesson } from './tutorialTypes'

/**
 * The positions the How It Works tutorial teaches from - all real positions,
 * mined from actual solves, not drawn by hand. Each is an 81-character board
 * ('0' = empty) plus, where the position is mid-solve, the pencil marks
 * already removed from a plain autofill ("r3c4-5" = 5 removed from r3c4, the
 * same notation the app uses). The lessons themselves (every colour, arrow
 * and caption) are then worked out by the app's own solver code, so to teach
 * from a different position, swap the board string and the digit/cell that
 * says where to look.
 */

const SAMPLE_BOARD = SAMPLE_PUZZLE.map((row) => row.join('')).join('')

/** One mid-solve position (from a Sudoku.Coach state) taught twice: Simple
 * Colouring of 3 gets only one elimination out of it, then 3D Medusa grows
 * that same colouring into a chain whose yellow side clashes. */
const PRELUDE_TO_MEDUSA_TITLE = 'Prelude to 3D Medusa'
const preludeToMedusa = () =>
  decodePuzzleState(
    '000908430004702680081054002005003129000520308000090560000079810017005006400106050',
    'r1c1-2 r1c2-5 r1c9-7 r3c1-7 r3c1-9 r4c1-6 r4c2-6 r4c4-4 r4c5-8 r5c1-7 r5c2-7 r6c1-3 r6c1-7 r6c1-8 ' +
      'r6c2-4 r6c2-7 r6c3-2 r7c1-3 r7c2-2 r7c2-3 r7c3-2 r7c4-3 r8c1-2 r8c1-9 r8c4-4 r8c4-8 r8c5-3 r9c2-3 ' +
      'r9c3-3 r9c7-9',
  )

/** One sub-tab of a tab that has several techniques (Basics, Abusing
 * Uniqueness): its label, one line about it, and its example(s). */
export interface LessonGroup {
  title: string
  blurb: string
  lessons: TutorialLesson[]
}

/** Runs a builder, and if the position ever stops matching what the builder
 * expects (say a finder changes), drops that one lesson instead of breaking
 * the whole page. */
function safely(build: () => TutorialLesson): TutorialLesson[] {
  try {
    return [build()]
  } catch (error) {
    console.warn('[tutorial] skipped a lesson:', error)
    return []
  }
}

export function buildBasicsGroups(): LessonGroup[] {
  const sample = decodePuzzleState(SAMPLE_BOARD)
  return [
    {
      title: 'Singles',
      blurb: 'The moment a cell has only one option, it is solved.',
      lessons: [
        ...safely(() => buildNakedSingleLesson('naked-single', sample, [4, 4])),
        // box 2 (index 1), 8 - only r1c6 can hold it
        ...safely(() => buildHiddenSingleLesson('hidden-single', sample, 8, 'box', 1)),
      ],
    },
    {
      title: 'Locked Candidates',
      blurb: 'A digit stuck inside one box-and-line overlap can be cleared from the rest of that line or box.',
      lessons: safely(() =>
        buildLockedCandidatesLesson(
          'locked-candidates',
          decodePuzzleState('000382010182600354300154028436005180800461500001830460708506200003018000900003800'),
          2,
        ),
      ),
    },
    {
      title: 'Locked Sets',
      blurb: 'Two cells sharing the same two candidates lock those digits in: naked triples, quads and hidden sets work the same way.',
      lessons: safely(() =>
        buildNakedPairLesson(
          'naked-pair',
          decodePuzzleState('602340019040005623003000074406000735530000142217453968004936251361582497925174386'),
          [0, 5],
          [1, 3],
        ),
      ),
    },
  ]
}

/** Abusing Uniqueness: one sub-tab per technique. Most positions here were
 * mined from real solves as the first stuck point after the Basics, and need
 * no pencil marks removed - a plain autofill of the board shows them. UR
 * Types 2, 3 and 5 are mid-solve positions (from Sudoku.Coach states), so
 * they list the marks already removed. */
export function buildUniquenessGroups(): LessonGroup[] {
  return [
    {
      title: 'UR Type 1',
      blurb: 'Three corners hold only the pair, so the fourth must be something else.',
      lessons: safely(() =>
        buildUniqueRectangleLesson({
          id: 'ur-1',
          title: 'UR Type 1',
          state: decodePuzzleState('408025761206071508157608320589164273621537000743002156870019635315706902960053017'),
          type: 'Type 1',
          corner: [8, 3],
        }),
      ),
    },
    {
      title: 'UR Type 2',
      blurb: 'Two side-by-side corners share one extra candidate, so one of them is it.',
      lessons: safely(() =>
        buildUniqueRectangleLesson({
          id: 'ur-2',
          title: 'UR Type 2',
          state: decodePuzzleState(
            '200901600000006003000405000036000509504093800900050370381562497000849135459317200',
            'r1c3-8 r2c2-7 r2c8-1 r2c8-2 r3c1-1 r3c2-1 r3c2-7 r3c5-2 r3c8-8 r3c9-8 r4c5-8 r6c4-2',
          ),
          type: 'Type 2',
          corner: [4, 7],
        }),
      ),
    },
    {
      title: 'UR Type 3',
      blurb: 'Two side-by-side extra corners act as one cell in a naked subset.',
      lessons: safely(() =>
        buildUniqueRectangleLesson({
          id: 'ur-3',
          title: 'UR Type 3',
          state: decodePuzzleState(
            '000730504035800060040105300060001030403000000050090000974010852582900613316582007',
            'r2c1-1 r3c1-2 r4c5-2 r4c5-4 r5c5-2 r6c6-4 r6c7-1 r6c9-1',
          ),
          type: 'Type 3',
          corner: [5, 3],
        }),
      ),
    },
    {
      title: 'UR Type 4',
      blurb: 'One pair digit is locked into the two extra corners, so the other pair digit leaves them.',
      lessons: safely(() =>
        buildUniqueRectangleLesson({
          id: 'ur-4',
          title: 'UR Type 4',
          state: decodePuzzleState('754001000183726945962854371047589103510043097300017450000008514435162789801405632'),
          type: 'Type 4',
          corner: [6, 1],
        }),
      ),
    },
    {
      title: 'UR Type 5',
      blurb: 'Type 2 with the shared extra candidate in diagonal corners, or in three corners.',
      lessons: [
        ...safely(() =>
          buildUniqueRectangleLesson({
            id: 'ur-5-diagonal',
            title: 'UR Type 5 (diagonal)',
            hint: 'The extra candidate is in two diagonal corners.',
            state: decodePuzzleState(
              '980510460502640918461089070795008146148006320326104800854061030600400081210800604',
              'r5c5-9 r6c9-9 r7c4-2 r7c9-7 r8c5-5 r8c6-7 r8c7-2 r9c5-5 r9c6-7',
            ),
            type: 'Type 5',
            corner: [4, 4],
          }),
        ),
        ...safely(() =>
          buildUniqueRectangleLesson({
            id: 'ur-5-three',
            title: 'UR Type 5 (three corners)',
            hint: 'The extra candidate is in three corners.',
            state: decodePuzzleState(
              '002037004903401287407092310005086400708320001000900008209048100004003800830009040',
              'r1c2-6 r1c4-5 r1c7-5 r3c2-6 r4c2-1 r5c2-6 r6c2-1 r6c2-6 r6c5-5 r6c7-6 r6c8-6 r8c5-5 r8c9-5 r9c4-1 r9c4-7',
            ),
            type: 'Type 5',
            corner: [0, 6],
          }),
        ),
      ],
    },
    {
      title: 'UR Type 7a',
      blurb: 'Two pair-only corners sit diagonally, and one of them is linked to a neighbour.',
      lessons: safely(() =>
        buildUniqueRectangleLesson({
          id: 'ur-7a',
          title: 'UR Type 7a',
          state: decodePuzzleState('430706520785492613020305007548671392000520000072840165217954836004238001803167200'),
          type: 'Type 7a',
          corner: [4, 0],
        }),
      ),
    },
    {
      title: 'UR Type 7b',
      blurb: 'Two links chain round the rectangle from a pair-only corner.',
      lessons: safely(() =>
        buildUniqueRectangleLesson({
          id: 'ur-7b',
          title: 'UR Type 7b',
          state: decodePuzzleState('100548007500763200070291504050176948417859002006432175700305406000904703000627800'),
          type: 'Type 7b',
          corner: [8, 7],
        }),
      ),
    },
    {
      title: 'UR Type 7c',
      blurb: 'Each side of the rectangle is locked to a different pair digit.',
      lessons: safely(() =>
        buildUniqueRectangleLesson({
          id: 'ur-7c',
          title: 'UR Type 7c',
          state: decodePuzzleState('010052047034010952527490160783249615152060094040501270498125736075906401061074509'),
          type: 'Type 7c',
          corner: [1, 3],
        }),
      ),
    },
    {
      title: 'UR Type 7d',
      blurb: 'Hidden Rectangle: the corner opposite a pair-only cell is linked to both its neighbours.',
      lessons: safely(() =>
        buildUniqueRectangleLesson({
          id: 'ur-7d',
          title: 'UR Type 7d',
          state: decodePuzzleState('504769803839152467607483095046530900098240536352690040981306054473905680265804309'),
          type: 'Type 7d',
          corner: [3, 5],
        }),
      ),
    },
    {
      title: 'BUG+1',
      blurb: 'Every cell has two candidates except one: that cell holds the digit that breaks the pattern.',
      lessons: safely(() =>
        buildBugPlusNLesson(
          'bug-plus-one',
          'BUG+1',
          'BUG+1 (avoiding a Bivalue Universal Grave)',
          decodePuzzleState('086307250205608703734521869802736500053284607647915382561473928328169475479852136'),
          1,
        ),
      ),
    },
    {
      // The user's own example (a Sudoku.Coach state; its removed marks
      // reproduce the state's candidates). Nothing easier applies there.
      title: 'BUG+2',
      blurb: 'Two cells have three candidates: one of their extra digits is true, so a cell seeing both loses that digit.',
      lessons: safely(() =>
        buildBugPlusNLesson(
          'bug-plus-two',
          'BUG+2',
          'BUG+2: two cells hold the way out',
          decodePuzzleState(
            '000397040309504607047806039700983465435672918896145273054730090903450700178269354',
            'r1c1-2 r1c2-1 r1c2-2 r1c7-1 r7c9-1',
          ),
          2,
        ),
      ),
    },
    {
      // Mined by dragon-research/bug-n/mine.ts: a plain autofill (no marks
      // removed) where BUG+3 is the easiest technique.
      title: 'BUG+3',
      blurb: 'Three cells have three candidates: one of their extra digits is true, so a cell seeing all three loses that digit.',
      lessons: safely(() =>
        buildBugPlusNLesson(
          'bug-plus-three',
          'BUG+3',
          'BUG+3: three cells hold the way out',
          decodePuzzleState('271463800395718624648529371539246718460801003180390460913680040754932186826104030'),
          3,
        ),
      ),
    },
    {
      title: 'Bivalue Oddagon',
      blurb:
        "An odd loop of cells can't be filled with just two digits. Strictly, this one doesn't need uniqueness - such a loop has no solution at all - but it's a close cousin of the patterns here.",
      lessons: [
        ...safely(() =>
          buildBivalueOddagonLesson({
            id: 'oddagon-1',
            title: 'One way out',
            hint: 'Type 1: a single cell can break the loop.',
            state: decodePuzzleState('815006024427850601936421857183945762592637418674218500058060140041500086369184275'),
            type: 1,
            cell: [7, 5],
          }),
        ),
        ...safely(() =>
          buildBivalueOddagonLesson({
            id: 'oddagon-2',
            title: 'Several ways out',
            hint: 'Type 2: the loop is broken by one of a few cells, all with the same extra digit.',
            state: decodePuzzleState('285090763103500492094002581501009826029050134408200957917625348842973615356000279'),
            type: 2,
            cell: [1, 5],
          }),
        ),
      ],
    },
    {
      // Mined from real solves (dragon-research/avoidable-rectangle): at each
      // position nothing easier than an Avoidable Rectangle applies. The third
      // string is the original puzzle, so the solved cells aren't givens.
      title: 'Avoidable Rectangle',
      blurb: 'A Unique Rectangle made partly of solved cells: none of them is a given, so they must not end up as two digits that could swap.',
      lessons: [
        ...safely(() =>
          buildAvoidableRectangleLesson({
            id: 'avoidable-rectangle-1',
            title: 'Three corners solved',
            hint: 'Type 1: the fourth corner must not complete the pattern.',
            state: decodePuzzleState(
              '000400809043008251081200000800005007030067000090004000009082415408500302052040086',
              '',
              '000000809043008050001200000800005007030067000090004000000000015400000300052040080',
            ),
            type: 1,
            cell: [7, 4],
          }),
        ),
        ...safely(() =>
          buildAvoidableRectangleLesson({
            id: 'avoidable-rectangle-2',
            title: 'Two corners solved',
            hint: 'Type 2: one of the two open corners must take its extra digit.',
            state: decodePuzzleState(
              '300104006000020070065800001130500900600291000009000000006900704843702000000460032',
              'r6c6-3 r6c7-3 r6c8-8 r6c9-3 r7c8-5',
              '300004006000020070065800001130500900600201000009000000000900704800000000000460032',
            ),
            type: 2,
            cell: [6, 4],
          }),
        ),
      ],
    },
  ]
}

/** Double Dragons: one sub-tab each for the plain and the Dynamic version.
 * Both assume single Dragons are understood. The plain position is a fresh
 * autofill from the Double Dragon practice stock (plain Dragon is stuck on
 * all 14 of its Medusas; the second Dragon's link absorbs one light blue 3
 * that then forces a 6). The Dynamic one is a mid-solve position from the
 * Double Dynamic research (frontend/double-dynamic-dragon-examples.txt, S5 -
 * app defaults): single Dynamic Dragon, with the default techniques, is
 * stuck on every Medusa and plain Double Dragon finds nothing, and the only
 * helper techniques it uses are a naked pair and a locked candidate - so the
 * lesson stays on the colouring. */
export function buildDoubleDragonGroups(): LessonGroup[] {
  return [
    {
      title: 'Double Plain Dragon Colouring',
      blurb:
        "This is the easiest Double Dragon to spot, and so we are using this example to demonstrate the concept of Double Dragons, but often times a single Dynamic Dragon is still stronger.",
      lessons: safely(() =>
        buildDoubleDragonLesson({
          id: 'double-dragon',
          title: 'Two stuck Dragons make progress',
          hint: 'Every single normal Dragon is stuck here - a Double Dragon is not.',
          state: decodePuzzleState('002001050900053000054600700080000100000030090700020000010500406500000810007010005'),
          firstSeed: { row: 7, col: 3, digit: 3 },
          secondSeed: { row: 0, col: 6, digit: 9 },
        }),
      ),
    },
    {
      title: 'Double Dynamic Dragon Colouring example 1',
      blurb:
        'Dynamic Dragons reach a whole other level with Double Dynamic Dragons. Either Dragon may call on other techniques to keep colouring - and the colours the second Dragon absorbs can be exactly what those techniques need.',
      lessons: safely(() =>
        buildDoubleDragonLesson({
          id: 'double-dynamic-dragon',
          title: 'Two stuck Dynamic Dragons make progress',
          hint: 'There are no easy single Dynamic Dragons that can progress this puzzle.  However, a short and sweet Double Dynamic Dragon can!',
          state: decodePuzzleState(
            '030050082002090000004026700000043000010002500700605020090200006006500209000069310',
            'r2c8-6 r3c8-5 r4c1-9 r4c7-6 r5c8-9 r7c3-5',
          ),
          firstSeed: { row: 2, col: 1, digit: 5 },
          secondSeed: { row: 0, col: 0, digit: 6 },
          dynamic: true,
        }),
      ),
    },
    {
      // Found by dragon-research/ddd-light-hunt.ts (a correct extra clue on a
      // famous hard puzzle; also in DOUBLE_DYNAMIC_DRAGON_PUZZLE_STOCK). At
      // this position nothing in the app progresses with every setting maxed -
      // every technique, no AIC limit, no cap, Exhaustive, so not even a
      // single Dynamic Dragon - until Double Dynamic is on. It is taught with
      // the smallest technique set that works (no AIC limit either way), so
      // the only helpers shown are a single-digit AIC, a locked candidate and
      // a naked triple.
      title: 'Double Dynamic Dragon Colouring example 2',
      blurb:
        'Another example showcasing the true power of Double Dynamic Dragons. In this puzzle, even the strongest single Dynamic Dragon (every technique available, with no AIC/technique limitations) is stuck. However, a Double Dynamic Dragon solves this puzzle with only a few easy helper techniques.',
      lessons: safely(() =>
        buildDoubleDragonLesson({
          id: 'double-dynamic-dragon-strongest',
          title: 'Beyond every single Dragon',
          hint: 'Every single Dynamic Dragon is stuck here (this is already extremely rare!).  However, a relatively straightforward Double Dynamic Dragon can crack the puzzle!',
          state: decodePuzzleState('120300004350000100004000050005400200600070000000008090003180500000009070000060008'),
          firstSeed: { row: 0, col: 4, digit: 5 },
          secondSeed: { row: 1, col: 4, digit: 4 },
          dynamic: true,
          techniques: new Set<Rule3Technique>([
            'hidden single',
            'naked pair',
            'locked candidate',
            'hidden pair',
            'naked triple',
            'naked quad',
            'x-wing',
            'short single-digit aic',
          ]),
        }),
      ),
    },
  ]
}

export type ColourTabId = 'simple' | 'medusa' | 'dragon' | 'dynamic'

export function buildColourLessons(tab: ColourTabId): TutorialLesson[] {
  switch (tab) {
    case 'simple':
      return [
        ...safely(() =>
          buildSimpleColouringLesson({
            id: 'simple-eliminate',
            title: 'A cell that sees both colours',
            hint: 'Colouring finds an elimination.',
            state: decodePuzzleState('002001700018000590700803412604002100130540200280100940840015329503000871901000654'),
            digit: 7,
            outcome: 'eliminate',
          }),
        ),
        ...safely(() =>
          buildSimpleColouringLesson({
            id: 'simple-solve',
            title: 'Two of one colour collide',
            hint: 'Colouring finds the answers.',
            state: decodePuzzleState('471603500365240017982571463153924006849716235726835100230150600598460301610300050'),
            digit: 9,
            outcome: 'solve',
          }),
        ),
        ...safely(() =>
          buildSimpleColouringLesson({
            id: 'simple-prelude',
            title: PRELUDE_TO_MEDUSA_TITLE,
            hint: 'One elimination here - and the start of something bigger.',
            state: preludeToMedusa(),
            digit: 3,
            outcome: 'eliminate',
            noLines: true,
            closingNote:
              'That is all Simple Colouring can do with 3 here. The 3D Medusa tutorial uses this same puzzle to show how Simple Colouring can evolve.',
          }),
        ),
      ]
    case 'medusa':
      return [
        ...safely(() =>
          buildMedusaLesson({
            id: 'medusa',
            title: 'Colouring across digits',
            hint: 'One candidate can be eliminated.',
            state: decodePuzzleState(
              '200589064604132800900746002100027000745918623000065000510874030407090580009050040',
              'r6c8-9 r8c4-3 r9c2-6 r9c4-3',
            ),
            seed: { row: 3, col: 7, digit: 5 },
          }),
        ),
        ...safely(() =>
          buildMedusaLesson({
            id: 'medusa-evolved',
            title: 'One colour is true',
            hint: `The "${PRELUDE_TO_MEDUSA_TITLE}" puzzle from Simple Colouring: one colour is false, so the other is true.`,
            state: preludeToMedusa(),
            seed: { row: 2, col: 0, digit: 3 },
            fromSimpleColouring: { lessonTitle: PRELUDE_TO_MEDUSA_TITLE },
            noLines: true,
          }),
        ),
      ]
    case 'dragon':
      return [
        ...safely(() =>
          buildDragonLesson({
            id: 'dragon-contradiction',
            title: 'Extend until a colour breaks',
            hint: 'Assume a colour is true and follow what it forces.',
            state: decodePuzzleState('358467192061892005029135000103059040504086000602341750915604080847503000236908504'),
            seed: { row: 1, col: 6, digit: 3 },
          }),
        ),
        ...safely(() =>
          buildDragonLesson({
            id: 'dragon-promotion',
            title: 'Dragon colours become real',
            hint: 'When opposite colours meet, both are promoted.',
            // Starting Medusa: 6 coloured candidates, one joined through a bivalue cell.
            state: decodePuzzleState('827030000601008300503062000962000831784391000315826749136289457258010693479653000'),
            seed: { row: 0, col: 7, digit: 6 },
          }),
        ),
      ]
    case 'dynamic':
      return [
        ...safely(() =>
          buildDragonLesson({
            id: 'dynamic-a',
            title: 'Other techniques keep the colouring going',
            hint: 'Plain Dragon is stuck here - Dynamic Dragon is not.',
            // Starting Medusa: 5 coloured candidates, one joined through a bivalue cell.
            state: decodePuzzleState('140953760760812540000647010231769485070420931004130276410506027000301654050204190'),
            seed: { row: 5, col: 0, digit: 5 },
            dynamic: true,
          }),
        ),
        ...safely(() =>
          buildDragonLesson({
            id: 'dynamic-b',
            title: 'A second example',
            hint: 'The same idea on a different position.',
            state: decodePuzzleState('458267139719004652326159007294610070507002001801705290082070003043020700075000020'),
            seed: { row: 2, col: 6, digit: 4 },
            dynamic: true,
          }),
        ),
      ]
  }
}
