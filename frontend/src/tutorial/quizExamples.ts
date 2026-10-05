import { decodePuzzleState } from './puzzleState'
import {
  buildBilocalQuestions,
  buildBivalueQuestions,
  buildLockedCandidatesQuestions,
  buildMedusaQuestions,
  buildNakedPairQuestions,
  buildSimpleColouringQuestions,
  buildSinglesQuestions,
  conceptQuestion,
  dragonColourQuestion,
  dragonResultQuestion,
  patternCellsQuestion,
  promotionQuestion,
  quizCellName,
  quizDigitsAt,
  quizList,
  whatGoesQuestion,
} from './quizBuilders'
import type { Quiz, QuizFrame, QuizOption, QuizQuestion } from './quizTypes'
import type { ColourTabId, LessonGroup } from './tutorialExamples'
import type { TutorialLesson } from './tutorialTypes'

/**
 * The practice quiz of every How It Works lesson: three or four easy
 * questions each, for someone who has just read the lesson and met the
 * technique for the first time (earlier tabs are assumed known).
 *
 * Basics, Simple Colouring and 3D Medusa are asked on fresh positions - the
 * boards below, mined by dragon-research/quiz/mine.ts in the same
 * board + removed-marks form tutorialExamples.ts uses. Every other quiz is
 * asked on its lesson's own position: a hand-written concept question (the
 * tables below), then questions read off the lesson's frames. Dragon,
 * Dynamic and Double Dragon are deliberately kept to quick picks, by request.
 *
 * To quiz a different position, change the board string (and the digit or
 * seed that says where to look). Like a lesson, a question whose position
 * stops matching is dropped with a console warning.
 * dragon-research/quiz/check.ts prints every quiz for a read-through.
 *
 * **A quiz id must never change once shipped**: completion is remembered in
 * the browser by it, and the analytics rows (quiz_answers) are keyed by it.
 * Ids of group quizzes come from the sub-tab's title (`quizIdFor`), so
 * renaming a sub-tab renames its quiz too.
 */

// ---- fresh positions (Basics, Simple Colouring, 3D Medusa) ----

const SINGLES = () => decodePuzzleState('000000004003070098400000051000902400000760000010003005000024000305000000009000680')
const LOCKED_CANDIDATES = () => decodePuzzleState('608900000001740500040061000410070000060410285080006714800007000100684930000030000')
const NAKED_PAIR = () =>
  decodePuzzleState('040003008090825010080000000070300050000100003130900002003001090719200605864509020', 'r3c7-4 r3c8-4 r3c9-4')
/** Bilocals and Bivalues share one mid-solve position, as their lessons do. */
const BILOCAL_BIVALUE = () =>
  decodePuzzleState('120060070007010620000372001000035000004020000050049008481050009039080740670493000', 'r1c4-8 r2c4-8 r5c6-8')
const SIMPLE_ELIMINATE = () => ({
  state: decodePuzzleState(
    '600000950057946308003000070005002700000080100070010005406371502730000400500004037',
    'r4c5-6 r4c9-4 r5c4-4 r5c4-6 r5c6-3 r5c6-9 r5c9-4 r8c3-1 r8c4-6 r9c4-6',
  ),
  digit: 2,
})
const SIMPLE_COLLIDE = () => ({
  state: decodePuzzleState(
    '374658291060409387908700465000870936709046812080900574092100703000007129007290608',
    'r6c3-1 r7c1-4 r7c1-5 r8c3-5 r9c1-4 r9c2-4',
  ),
  digit: 3,
})
const MEDUSA_SEES_BOTH = () => ({
  state: decodePuzzleState(
    '507230064040675802260001375825000000670092508900050027002000400706004209400520706',
    'r7c2-1 r7c2-3 r7c4-1 r7c4-3 r7c5-1 r7c6-3 r7c8-1 r7c8-3 r8c2-1 r8c8-1',
  ),
  seed: { row: 0, col: 1, digit: 8 },
})
const MEDUSA_CLASH = () => ({
  state: decodePuzzleState(
    '700342165352861947146957832600020570200030080400009210530200790960000320827093051',
    'r4c3-1 r5c3-1 r6c3-8 r6c4-7 r8c4-1',
  ),
  seed: { row: 8, col: 3, digit: 4 },
})

// ---- assembling ----

/** Runs one question builder; a position that no longer matches costs that
 * one question, not the quiz. */
function safely(build: () => QuizQuestion | QuizQuestion[]): QuizQuestion[] {
  try {
    const built = build()
    return Array.isArray(built) ? built : [built]
  } catch (error) {
    console.warn('[tutorial] skipped a practice question:', error)
    return []
  }
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/** The quiz id of a tab's sub-tab (a `LessonGroup.title`), or of a colouring
 * tab itself. */
export function quizIdFor(tab: string, groupTitle?: string): string {
  return groupTitle ? `${tab}/${slug(groupTitle)}` : tab
}

function quiz(id: string, title: string, questions: QuizQuestion[]): Quiz | null {
  // One question isn't a quiz; a lesson whose position broke gets none.
  return questions.length >= 2 ? { id, title, questions } : null
}

// ---- Basics ----

const BASICS: Record<string, () => QuizQuestion[]> = {
  Singles: () => buildSinglesQuestions(SINGLES()),
  'Locked Candidates': () => buildLockedCandidatesQuestions(LOCKED_CANDIDATES()),
  'Locked Sets': () => buildNakedPairQuestions(NAKED_PAIR()),
  Bilocals: () => buildBilocalQuestions(BILOCAL_BIVALUE()),
  Bivalues: () => buildBivalueQuestions(BILOCAL_BIVALUE()),
}

// ---- Abusing Uniqueness: one concept question and one "where to look" hint
// per sub-tab, then questions read off the lesson. ----

type SpotKind = 'corners' | 'tri-cells' | 'loop-extras' | 'pattern-extras' | 'solved-corners'

interface UniquenessSpec {
  prompt: string
  options: QuizOption[]
  /** Which lesson frame the concept question is shown over (0 = the first). */
  conceptFrame?: number
  spot: SpotKind
  /** Said after a wrong tap on "what goes?". */
  hint: string
  /** The reason behind "what goes?", where the lesson's own conclusion frame
   * is only the bare result (see whatGoesQuestion). */
  why?: string
}

const SUPPOSE_WHY = 'Suppose it were true: the links (red) would force every other corner onto the pair, and all four corners would be the deadly pattern.'


const SUPPOSE_OPTIONS: QuizOption[] = [
  {
    label: 'It forces all four corners to be just the pair',
    correct: true,
    why: 'That is the deadly pattern: the two digits could swap, giving two solutions. So the candidate we supposed can\'t be true.',
  },
  { label: 'It leaves a cell with no candidates', why: 'No cell runs dry here. The rectangle fills up legally - just in a way that could be swapped.' },
  { label: 'It puts a digit twice in a row', why: 'Nothing breaks a Sudoku rule here. The trouble is two solutions, not zero.' },
]

const LINK_OPTIONS: QuizOption[] = [
  {
    label: 'A digit with only two places left in a row, column or box',
    correct: true,
    why: 'That is a strong link (the red line): if one of the two cells isn\'t the digit, the other must be. It is what carries "suppose" from corner to corner.',
  },
  { label: 'A cell with three candidates', why: 'Three candidates force nothing. The links here are digits with exactly two places left.' },
  { label: 'A naked pair', why: 'No locked set is needed - just digits that have only two places left in a unit.' },
]

const UNIQUENESS: Record<string, UniquenessSpec> = {
  'UR Type 1': {
    prompt: 'Suppose all four corners ended up holding just these two digits, as coloured. Why can that never happen in a proper puzzle?',
    conceptFrame: 1,
    options: [
      {
        label: 'The two digits could swap, giving two solutions',
        correct: true,
        why: 'Nothing outside the rectangle could tell the two fillings apart, and a proper puzzle has exactly one solution.',
      },
      { label: 'A row would hold the same digit twice', why: 'Each row, column and box of the rectangle holds each digit once. It is legal - just not unique.' },
      { label: 'The corners would have no candidates left', why: 'Each corner gets a digit. The trouble is that there are two ways to do it.' },
    ],
    spot: 'corners',
    hint: 'Look at the one corner that holds more than the pair: which of its candidates would complete the deadly pattern?',
  },
  'UR Type 2': {
    prompt: 'Two corners hold the pair plus the same one extra digit (yellow). What do we know about those two corners?',
    conceptFrame: 2,
    options: [
      { label: 'At least one of them is the extra digit', correct: true, why: 'If neither were, all four corners would be just the pair: the deadly pattern.' },
      { label: 'Both are the extra digit', why: 'They share a row or column, so they can\'t both be it - and one is enough to break the pattern.' },
      { label: 'Neither is the extra digit', why: 'Then all four corners would be just the pair: the deadly pattern.' },
    ],
    spot: 'corners',
    hint: 'One of the two yellow candidates is true. Look for the same digit in a cell that sees both of them.',
  },
  'UR Type 3': {
    prompt: 'Two side-by-side corners hold extra digits (yellow). How does Type 3 treat those two corners?',
    conceptFrame: 2,
    options: [
      {
        label: 'As one merged cell holding their extra digits',
        correct: true,
        why: 'They can\'t both be pair digits, so one of them is an extra digit - together they act like a single cell that can join a naked subset.',
      },
      { label: 'As two solved cells', why: 'Neither is solved yet. We only know one of them takes an extra digit.' },
      { label: 'As a naked pair on the rectangle\'s own two digits', why: 'The rectangle\'s two digits are exactly what must not fill both corners.' },
    ],
    spot: 'corners',
    hint: 'The merged cell and its green partners use up their digits. Look for those digits elsewhere in the tinted unit.',
  },
  'UR Type 4': {
    prompt: 'One pair digit fits only in the two extra corners of its unit (the red line). What can be removed from those two corners?',
    conceptFrame: 2,
    options: [
      {
        label: 'The other pair digit',
        correct: true,
        why: 'One of the two corners takes the locked digit. If the other took the second pair digit, all four corners would be just the pair.',
      },
      { label: 'The locked digit', why: 'The locked digit has nowhere else to go in that unit, so it must stay in these two corners.' },
      { label: 'Every extra candidate', why: 'The extras are what keep the rectangle from being deadly. They stay.' },
    ],
    spot: 'corners',
    hint: 'The red line locks one pair digit into those two corners. It is the other pair digit that leaves them.',
  },
  'UR Type 5': {
    prompt: 'The same extra digit (yellow) sits in diagonal corners, or in three corners. One of those corners must be it - so where is that digit removed?',
    conceptFrame: 2,
    options: [
      { label: 'From any cell that sees all of those corners', correct: true, why: 'Whichever corner turns out to be the extra digit, a cell seeing them all sees it.' },
      { label: 'From the corners themselves', why: 'One of the corners must be the extra digit, so it stays there.' },
      { label: 'From every cell of the rectangle\'s rows', why: 'Only cells that see every one of those corners are sure to see the true one.' },
    ],
    spot: 'corners',
    hint: 'Find the corners holding the extra digit, then a cell that sees every one of them.',
  },
  'UR Type 7a': {
    why: SUPPOSE_WHY,
    prompt: 'Types 7a to 7d are shown by supposing a candidate were true and following what it forces. What shows the supposition was wrong?',
    options: SUPPOSE_OPTIONS,
    spot: 'corners',
    hint: 'Look for the corner candidate that, if true, would push every other corner onto the pair.',
  },
  'UR Type 7b': {
    why: SUPPOSE_WHY,
    prompt: 'What kind of link does this type follow round the rectangle?',
    conceptFrame: 2,
    options: LINK_OPTIONS,
    spot: 'corners',
    hint: 'It is in the corner the two red links don\'t start from: the one that sees both ends of the chain.',
  },
  'UR Type 7c': {
    why: SUPPOSE_WHY,
    prompt: 'This type is shown by supposing a candidate were true and following what it forces. What shows the supposition was wrong?',
    options: SUPPOSE_OPTIONS,
    spot: 'corners',
    hint: 'Look for the corner candidate that, if true, would push every other corner onto the pair.',
  },
  'UR Type 7d': {
    why: SUPPOSE_WHY,
    prompt: 'What kind of link does a Hidden Rectangle rest on?',
    conceptFrame: 2,
    options: LINK_OPTIONS,
    spot: 'corners',
    hint: 'It is in the corner where the two red links meet: the pair digit they are not about.',
  },
  'BUG+1': {
    why: "It is the digit that appears three times in the cell's row, column or box. Without it every digit would pair up everywhere: two solutions.",
    prompt: 'Every unsolved cell has two candidates, except one with three. Which of its digits does that cell take?',
    options: [
      {
        label: 'The one that appears three times in its row, column or box',
        correct: true,
        why: 'Take that digit away and every digit pairs up everywhere: a pattern with two solutions. So it must be the true one.',
      },
      { label: 'Its smallest candidate', why: 'The size of the digit has nothing to do with it. Count how often each one appears in the cell\'s row, column or box.' },
      { label: 'Either of the other two', why: 'With the extra digit gone the whole grid would have two solutions, so the extra digit is the true one.' },
    ],
    spot: 'tri-cells',
    hint: 'Count each of the cell\'s digits in its row, column or box. The answer is the one that appears three times.',
  },
  'BUG+2': {
    prompt: 'Two cells have three candidates each. What do we know about their two extra digits?',
    options: [
      { label: 'At least one of them is true', correct: true, why: 'If neither were, taking both out would leave the two-solution pattern.' },
      { label: 'Both are true', why: 'One is enough to break the pattern, so nothing forces both.' },
      { label: 'Neither is true', why: 'Then every cell would be down to two candidates: the two-solution pattern.' },
    ],
    spot: 'tri-cells',
    hint: 'One of the two extra digits (yellow) is true. Look for that digit in a cell that sees both.',
  },
  'BUG+3': {
    prompt: 'A cell sees all of the three-candidate cells. Which digit can it lose?',
    options: [
      { label: 'Their shared extra digit', correct: true, why: 'One of the extra digits is true, and this cell sees them all.' },
      {
        label: 'Any digit all three cells hold',
        why: 'Only the extra digit counts. Another digit they share isn\'t what breaks the pattern, so a cell seeing them can still be that digit.',
      },
      { label: 'Every one of its candidates', why: 'Only the extra digit is known to be true in one of those cells.' },
    ],
    spot: 'tri-cells',
    hint: 'One of the extra digits (yellow) is true. Look for that digit in a cell that sees all of them.',
  },
  'Bivalue Oddagon': {
    prompt: 'Why can\'t an odd loop of cells be filled with just two digits?',
    conceptFrame: 1,
    options: [
      {
        label: 'Neighbours must differ, and an odd loop can\'t alternate all the way round',
        correct: true,
        why: 'Going round, the digits alternate - and with an odd number of cells the last one ends up next to the first with the same digit.',
      },
      { label: 'It would have two solutions', why: 'This one isn\'t about uniqueness: such a loop has no solution at all.' },
      { label: 'Two digits can never fill more than four cells', why: 'They can, in an even loop. It is the odd length that breaks the alternation.' },
    ],
    spot: 'loop-extras',
    hint: 'Some loop cell must be something other than the loop\'s two digits. Look at the cell (or cells) with an extra candidate.',
  },
  'Avoidable Rectangle': {
    prompt: 'An Avoidable Rectangle is built on solved corners. Why must none of them be a given?',
    options: [
      {
        label: 'A given can\'t be swapped, so there would be no second solution',
        correct: true,
        why: 'The pattern is only deadly if the two digits could swap places. A given pins its digit down, and the swap is off.',
      },
      { label: 'Givens can\'t be part of any pattern', why: 'Givens take part in plenty of patterns. Here the point is that they can\'t be swapped.' },
      { label: 'Solved cells have candidates and givens don\'t', why: 'Neither has candidates. What matters is whether the digit was fixed by the puzzle.' },
    ],
    spot: 'solved-corners',
    hint: 'Which candidate in the open corner would complete the two-digit pattern round the rectangle?',
  },
  'Extended UR': {
    prompt: 'Five of the six pattern cells hold only the pattern\'s digits. What does that say about the sixth?',
    options: [
      { label: 'It must be one of its other candidates', correct: true, why: 'If it were a pattern digit too, the six cells could be filled two ways and nothing else would notice.' },
      { label: 'It must be a pattern digit', why: 'That would complete the deadly pattern: two solutions.' },
      { label: 'Nothing yet', why: 'It is the only cell that can break the pattern, so it has to.' },
    ],
    spot: 'pattern-extras',
    hint: 'Look at the one cell with other candidates: its pattern digits are what go.',
  },
}

function spotQuestion(lesson: TutorialLesson, kind: SpotKind): QuizQuestion {
  const filled = (cell: readonly [number, number], state: TutorialLesson['state']) => state.board[cell[0]][cell[1]] !== 0
  switch (kind) {
    case 'corners':
      return patternCellsQuestion(lesson, 'corners', {
        prompt: ({ digits }) => `This rectangle is built on ${quizList(digits)}. Tap its four corners.`,
        showOutline: false,
        wrong: (cell, { digits, state }) => {
          const name = quizCellName(cell[0], cell[1])
          if (filled(cell, state)) return `${name} is already filled in.`
          const held = quizDigitsAt(state, cell)
          return digits.some((d) => !held.includes(d))
            ? `${name} can't hold both ${quizList(digits)}.`
            : `${name} can hold both, but it isn't a corner: the four must sit in exactly 2 rows, 2 columns and 2 boxes.`
        },
        explain: 'Four cells in two rows, two columns and two boxes, each able to hold both digits: the rectangle every Unique Rectangle starts from.',
      })
    case 'tri-cells':
      return patternCellsQuestion(lesson, 'three-candidates', {
        prompt: ({ count }) =>
          count === 1
            ? 'Every unsolved cell has exactly two candidates, except one. Tap it.'
            : `Every unsolved cell has exactly two candidates, except ${count === 2 ? 'two' : 'three'}. Tap them.`,
        showOutline: false,
        wrong: (cell, { state }) => {
          const name = quizCellName(cell[0], cell[1])
          return filled(cell, state) ? `${name} is already filled in.` : `${name} has two candidates, like nearly every other cell.`
        },
        explain: 'Without the extra digits here, every cell would have two candidates: a grid with two solutions.',
      })
    case 'loop-extras':
      return patternCellsQuestion(lesson, 'loop-extras', {
        prompt: ({ count }) =>
          count === 1
            ? 'Every cell of the outlined loop holds the same two digits, except one with an extra candidate. Tap it.'
            : `Every cell of the outlined loop holds the same two digits, except ${count} that share an extra candidate. Tap them.`,
        pick: (cell, { state }) => quizDigitsAt(state, cell).length > 2,
        showOutline: true,
        wrong: (cell, { outlined }) =>
          outlined ? `${quizCellName(cell[0], cell[1])} holds only the loop's two digits.` : 'Stay on the outlined loop.',
        explain: 'An odd loop can\'t be just two digits, so the extra candidate is what has to break it.',
      })
    case 'pattern-extras':
      return patternCellsQuestion(lesson, 'odd-cell', {
        prompt: ({ digits }) => `Five of the six outlined cells hold only ${quizList(digits)}. Tap the odd one out.`,
        pick: (cell, { digits, state }) => quizDigitsAt(state, cell).some((d) => !digits.includes(d)),
        showOutline: true,
        wrong: (cell, { outlined, digits }) =>
          outlined ? `${quizCellName(cell[0], cell[1])} holds only ${quizList(digits)}.` : 'Pick one of the six outlined cells.',
        explain: 'It is the only cell that can keep the six from being filled two ways.',
      })
    case 'solved-corners':
      return patternCellsQuestion(lesson, 'solved-corners', {
        prompt: ({ count }) => `Tap the ${count === 1 ? 'corner' : `${count} corners`} of the outlined rectangle that ${count === 1 ? 'is' : 'are'} already solved.`,
        pick: (cell, { state }) => filled(cell, state),
        showOutline: true,
        wrong: (_cell, { outlined }) => (outlined ? 'That corner is still open.' : 'Pick from the outlined corners.'),
        explain: 'These corners were solved along the way, not given - which is what would let the rectangle\'s two digits swap.',
      })
  }
}

function uniquenessQuestions(group: LessonGroup): QuizQuestion[] {
  const spec = UNIQUENESS[group.title]
  const [first, ...rest] = group.lessons
  if (!spec || !first) return []
  const conceptFrame = first.frames[Math.min(spec.conceptFrame ?? 0, first.frames.length - 1)]
  const { caption: _caption, badge: _badge, ...shown } = conceptFrame
  // The concept picture must not give the conclusion away.
  const frame: QuizFrame = { ...shown, eliminated: undefined, solved: undefined, fresh: undefined, applied: false, links: shown.links?.filter((l) => l.kind === 'strong') }
  return [
    // Finding the pattern comes first: the concept picture outlines it.
    ...safely(() => spotQuestion(first, spec.spot)),
    ...safely(() => conceptQuestion(first, 'concept', spec.prompt, spec.options, frame)),
    ...safely(() => whatGoesQuestion(first, `what-goes-${first.id}`, spec.hint, { why: spec.why })),
    // A second example of the same technique gets a "what goes?" of its own.
    ...rest.slice(0, 1).flatMap((lesson) => safely(() => whatGoesQuestion(lesson, `what-goes-${lesson.id}`, spec.hint, { why: spec.why }))),
  ]
}

// ---- Dragons: quick picks only, by request ----

const NOTHING_GUESSED =
  'Nothing is guessed: each side is followed on its own, and only a contradiction, or something both sides agree on, is ever used.'

const DOUBLE: Record<string, { prompt: string; options: QuizOption[] }> = {
  'Double Plain Dragon Colouring': {
    prompt: 'A second Dragon (pink and lime green) joins the first. What is a Dragon link between them?',
    options: [
      {
        label: 'A second-Dragon candidate and a first-Dragon candidate that can\'t both be true',
        correct: true,
        why: 'So if the second Dragon\'s side is true, that first-Dragon side is false - which makes the first Dragon\'s other side true.',
      },
      { label: 'Two candidates that must both be true', why: 'A link is the opposite: two candidates that can\'t both be true (same cell, or the same digit in one unit).' },
      { label: 'A strong link inside one Medusa', why: 'That is ordinary colouring. A Dragon link joins the two Dragons to each other.' },
    ],
  },
  'Double Dynamic Dragon Colouring example 1': {
    prompt: 'Pink is linked against light blue: a pink candidate and a light blue one can\'t both be true. Which first-Dragon candidates does pink absorb?',
    options: [
      {
        label: 'The yellow and orange ones',
        swatch: 'yellow',
        correct: true,
        why: 'If pink is true, light blue is false, so yellow is true - and so is everything that follows from yellow (orange). They get purple, pink\'s dragon colour.',
      },
      { label: 'The light blue and dark blue ones', swatch: 'blue', why: 'Those are the side pink rules out, not the side it implies.' },
      { label: 'None', why: 'With light blue ruled out, the first Dragon\'s other side must be true whenever pink is.' },
    ],
  },
  'Double Dynamic Dragon Colouring example 2': {
    prompt: 'What may a Double Dynamic Dragon use that a plain Double Dragon may not?',
    options: [
      {
        label: 'Other techniques, with a colour assumed true, to keep either Dragon going',
        correct: true,
        why: 'Exactly as in a single Dynamic Dragon: a naked pair, a locked candidate and the like appear once a side is assumed true, and force the next candidate.',
      },
      { label: 'A third Medusa', why: 'It is still two Dragons. What changes is what each one may use to extend.' },
      { label: 'A guess when it gets stuck', why: NOTHING_GUESSED },
    ],
  },
}

function dragonQuestions(lessons: TutorialLesson[]): QuizQuestion[] {
  const [first, second] = lessons
  if (!first) return []
  return [
    ...safely(() =>
      conceptQuestion(first, 'concept', 'This Medusa is stuck: light blue and yellow alone prove nothing. What does Dragon Colouring do next?', [
        {
          label: 'Assumes a colour is true and colours what that forces',
          correct: true,
          why: 'Whatever follows if light blue is true becomes dark blue; whatever follows if yellow is true becomes orange. Those are the dragon colours.',
        },
        { label: 'Guesses a digit and backtracks if it fails', why: NOTHING_GUESSED },
        { label: 'Starts a new Medusa somewhere else', why: 'It keeps this Medusa and grows it: each side is followed further than its strong links reach.' },
      ]),
    ),
    ...safely(() => dragonColourQuestion(first, 'which-colour', ['darkBlue', 'orange'])),
    ...safely(() => dragonResultQuestion(first, `result-${first.id}`)),
    ...(second ? safely(() => promotionQuestion(second, 'promotion')) : []),
  ]
}

function dynamicQuestions(lessons: TutorialLesson[]): QuizQuestion[] {
  const [first] = lessons
  if (!first) return []
  return [
    ...safely(() =>
      conceptQuestion(first, 'concept', 'Plain Dragon Colouring is stuck here. What does Dynamic Dragon Colouring add?', [
        {
          label: 'With a colour assumed true, other techniques may find the next forced candidate',
          correct: true,
          why: 'Assuming a side is true removes candidates, and that can make a naked pair, a locked candidate or the like appear - which then forces a digit.',
        },
        { label: 'A second Medusa coloured at the same time', why: 'That is Double Dragon Colouring. Dynamic keeps one Dragon and gives it more ways to extend.' },
        { label: 'A guess when it gets stuck', why: NOTHING_GUESSED },
      ]),
    ),
    ...safely(() => dragonColourQuestion(first, 'which-colour', ['darkBlue', 'orange'], 'Dynamic')),
    ...safely(() => dragonResultQuestion(first, `result-${first.id}`)),
  ]
}

function doubleQuestions(group: LessonGroup): QuizQuestion[] {
  const spec = DOUBLE[group.title]
  const [lesson] = group.lessons
  if (!spec || !lesson) return []
  // Shown over the picture with both Dragons coloured.
  const { caption: _caption, badge: _badge, ...shown } = lesson.frames[Math.min(1, lesson.frames.length - 1)]
  return [
    ...safely(() => conceptQuestion(lesson, 'concept', spec.prompt, spec.options, { ...shown, fresh: undefined })),
    ...safely(() => dragonColourQuestion(lesson, 'which-colour', ['purple', 'darkGreen'])),
    ...safely(() => dragonResultQuestion(lesson, `result-${lesson.id}`)),
  ]
}

// ---- the page's entry points ----

/** The practice quiz of a sub-tab (Basics, Abusing Uniqueness, Double
 * Dragons), or null if it has none. */
export function buildGroupQuiz(tab: 'basics' | 'uniqueness' | 'double', group: LessonGroup): Quiz | null {
  const questions =
    tab === 'basics' ? safely(BASICS[group.title] ?? (() => [])) : tab === 'uniqueness' ? uniquenessQuestions(group) : doubleQuestions(group)
  return quiz(quizIdFor(tab, group.title), group.title, questions)
}

const COLOUR_TITLES: Record<ColourTabId, string> = {
  simple: 'Simple Colouring',
  medusa: '3D Medusa',
  dragon: 'Dragon Colouring',
  dynamic: 'Dynamic Dragon Colouring',
}

/** The practice quiz of a colouring tab; `lessons` are that tab's own
 * (Dragon and Dynamic Dragon are asked on them). */
export function buildColourQuiz(tab: ColourTabId, lessons: TutorialLesson[]): Quiz | null {
  const questions =
    tab === 'simple'
      ? safely(() => buildSimpleColouringQuestions(SIMPLE_ELIMINATE(), SIMPLE_COLLIDE()))
      : tab === 'medusa'
        ? safely(() => buildMedusaQuestions(MEDUSA_SEES_BOTH(), MEDUSA_CLASH()))
        : tab === 'dragon'
          ? dragonQuestions(lessons)
          : dynamicQuestions(lessons)
  return quiz(quizIdFor(tab), COLOUR_TITLES[tab], questions)
}
