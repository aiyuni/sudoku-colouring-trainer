import type { CandRef, PuzzleState, TutorialCell, TutorialColor, TutorialFrame } from './tutorialTypes'

/** What the board shows for a question - a lesson frame without its words
 * (the question's own prompt and feedback take their place). */
export type QuizFrame = Omit<TutorialFrame, 'caption' | 'badge'>

export interface QuizOption {
  label: string
  correct?: boolean
  /** One sentence shown when this option is picked: why it is right, or why
   * it is not. */
  why: string
  /** A colour dot before the label, for "which colour?" questions. */
  swatch?: TutorialColor
}

interface QuizQuestionBase {
  /** Unique within its quiz and stable across builds - it is what the
   * analytics rows are keyed by. */
  id: string
  /** The small label above the prompt ("Spot it", "Quick pick"...). */
  badge: string
  prompt: string
  state: PuzzleState
  /** The board while the question is open. */
  frame: QuizFrame
  /** One or two sentences once it is answered. */
  explain: string
  /** The board once it is answered: the answer lit up the way the lessons
   * light it (red = removed, green = true, colours). */
  doneFrame: QuizFrame
}

/** Pick one of two or three buttons. */
export interface ChoiceQuestion extends QuizQuestionBase {
  kind: 'choice'
  options: QuizOption[]
}

/** Tap `need` of the `answers` cells. */
export interface CellsQuestion extends QuizQuestionBase {
  kind: 'cells'
  answers: TutorialCell[]
  need: number
  /** Why a tapped cell isn't an answer. */
  wrong: (cell: TutorialCell) => string
}

/** Tap `need` of the `answers` candidates. */
export interface CandidatesQuestion extends QuizQuestionBase {
  kind: 'candidates'
  answers: CandRef[]
  need: number
  /** How a found answer is drawn while the rest are still to find. */
  pickLook: 'eliminated' | 'solved' | 'basis'
  wrong: (ref: CandRef) => string
}

/** Carry a colouring on: tap `need` candidates that are strongly linked to an
 * already coloured one. Each right tap is coloured at once, so later taps can
 * build on it - any order the links allow is accepted. */
export interface ColourQuestion extends QuizQuestionBase {
  kind: 'colour'
  /** Every candidate of the chain with its colour. */
  chain: Array<CandRef & { color: TutorialColor }>
  /** The ones coloured from the start. */
  start: CandRef[]
  /** Strong links inside the chain, as "key|key" both ways round (candKey). */
  edges: ReadonlySet<string>
  need: number
  /** Said after a right tap: which link it followed. */
  pickNote: (ref: CandRef, colouredKeys: ReadonlySet<string>) => string
  wrong: (ref: CandRef, colouredKeys: ReadonlySet<string>) => string
}

export type QuizQuestion = ChoiceQuestion | CellsQuestion | CandidatesQuestion | ColourQuestion

export interface Quiz {
  /** Stable id ("basics/singles", "uniqueness/ur-type-1", "medusa"...): what
   * completion is remembered by and what the analytics rows carry. */
  id: string
  title: string
  questions: QuizQuestion[]
}
