import { SAMPLE_PUZZLE } from '../sudoku/types'
import {
  buildBivalueOddagonLesson,
  buildBugPlusOneLesson,
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

/** Abusing Uniqueness: one sub-tab per technique. Every position here was
 * mined from real solves as the first stuck point after the Basics, and each
 * needs no pencil marks removed - a plain autofill of the board shows it. */
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
        buildBugPlusOneLesson(
          'bug-plus-one',
          'BUG+1',
          'Bivalue Universal Grave, plus one.',
          decodePuzzleState('086307250205608703734521869802736500053284607647915382561473928328169475479852136'),
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
      ]
    case 'medusa':
      return safely(() =>
        buildMedusaLesson({
          id: 'medusa',
          title: 'Colouring across digits',
          state: decodePuzzleState(
            '200589064604132800900746002100027000745918623000065000510874030407090580009050040',
            'r6c8-9 r8c4-3 r9c2-6 r9c4-3',
          ),
          seed: { row: 3, col: 7, digit: 5 },
        }),
      )
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
