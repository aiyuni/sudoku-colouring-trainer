import { useEffect, useMemo, useRef, useState } from 'react'
import { markedCandidateDigits } from '../sudoku/boardUtils'
import { AREA_LAYER, trackEvent, trackQuizAnswer, useAnalyticsArea } from '../usageTracking'
import ColourKey from './ColourKey'
import { candKey } from './puzzleState'
import { markQuizDone } from './quizProgress'
import type { Quiz, QuizFrame, QuizQuestion } from './quizTypes'
import TutorialGrid, { type TutorialGridInteraction } from './TutorialGrid'
import type { CandRef, TutorialCell } from './tutorialTypes'

/** Two wrong taps and the answer is ringed: the quiz is practice for someone
 * who met the technique a minute ago, not a test to get stuck in. */
const MISSES_BEFORE_REVEAL = 2
const SHAKE_MS = 450

interface QuestionResult {
  misses: number
  revealed: boolean
}

interface Feedback {
  tone: 'good' | 'bad' | 'note'
  text: string
}

function cellKeyOf(cell: TutorialCell): string {
  return `${cell[0]},${cell[1]}`
}

function cellName(cell: TutorialCell): string {
  return `r${cell[0] + 1}c${cell[1] + 1}`
}

function now(): number {
  return Date.now()
}

function randomId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`
  }
}

/** Pencil marks are a third of a cell wide - fine for a mouse, too small for
 * a finger. On a touch screen a tap picks the cell and the quiz asks which
 * digit was meant. */
function pipsAreTappable(): boolean {
  try {
    return !window.matchMedia('(pointer: coarse)').matches
  } catch {
    return true
  }
}

interface QuestionViewProps {
  question: QuizQuestion
  number: number
  total: number
  /** How the earlier questions went, for the progress dots. */
  earlier: QuestionResult[]
  onAnswered: (result: QuestionResult, ms: number) => void
  onNext: () => void
}

/** One question, start to finish. Remounted (keyed) per question, so its
 * state needs no resetting. */
function QuestionView({ question, number, total, earlier, onAnswered, onNext }: QuestionViewProps) {
  const [picked, setPicked] = useState<string[]>([])
  const [wrongOptions, setWrongOptions] = useState<number[]>([])
  const [misses, setMisses] = useState(0)
  const [done, setDone] = useState(false)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [selected, setSelected] = useState<TutorialCell | null>(null)
  const [wrongKey, setWrongKey] = useState<string | null>(null)
  const startedAt = useRef(0)
  const shakeTimer = useRef<number | undefined>(undefined)
  const nextButton = useRef<HTMLButtonElement>(null)
  const directPips = useMemo(() => pipsAreTappable(), [])

  useEffect(() => {
    startedAt.current = now()
    return () => window.clearTimeout(shakeTimer.current)
  }, [])
  // Enter carries on once the explanation is up.
  useEffect(() => {
    if (done) nextButton.current?.focus()
  }, [done])

  // A choice question has nothing to ring: its wrong options just go grey.
  const reveals = question.kind !== 'choice'
  const revealed = reveals && misses >= MISSES_BEFORE_REVEAL
  const { state } = question

  const colouredKeys = useMemo(
    () => (question.kind === 'colour' ? new Set([...question.start.map(candKey), ...picked]) : new Set<string>()),
    [question, picked],
  )

  function finish(missesNow: number) {
    setDone(true)
    setSelected(null)
    setFeedback({ tone: 'good', text: question.explain })
    onAnswered({ misses: missesNow, revealed: reveals && missesNow >= MISSES_BEFORE_REVEAL }, now() - startedAt.current)
  }

  function miss(text: string, key: string | null) {
    const missesNow = misses + 1
    setMisses(missesNow)
    setSelected(null)
    setFeedback({
      tone: 'bad',
      text: missesNow === MISSES_BEFORE_REVEAL && reveals ? `${text} The answer is ringed for you.` : text,
    })
    setWrongKey(key)
    window.clearTimeout(shakeTimer.current)
    shakeTimer.current = window.setTimeout(() => setWrongKey(null), SHAKE_MS)
  }

  /** A right tap: the last one needed ends the question. */
  function hit(key: string, note: string, need: number) {
    const next = [...picked, key]
    setPicked(next)
    setSelected(null)
    if (next.length >= need) {
      finish(misses)
    } else {
      setFeedback({ tone: 'good', text: note })
    }
  }

  function onCell(cell: TutorialCell) {
    if (done) return
    if (question.kind === 'cells') {
      const key = cellKeyOf(cell)
      if (picked.includes(key)) {
        setFeedback({ tone: 'note', text: `${cellName(cell)} is already found.` })
      } else if (question.answers.some((a) => cellKeyOf(a) === key)) {
        hit(key, `Yes, ${cellName(cell)}. ${question.need - picked.length - 1} more to find.`, question.need)
      } else {
        miss(question.wrong(cell), key)
      }
      return
    }
    if (question.kind === 'choice') return
    // A candidate question, tapped on a cell rather than on a pencil mark:
    // ask which of the cell's candidates is meant.
    const digits = state.board[cell[0]][cell[1]] === 0 ? markedCandidateDigits(state.candidates[cell[0]][cell[1]]) : []
    if (digits.length === 0) {
      setSelected(null)
      setFeedback({ tone: 'note', text: `${cellName(cell)} is already filled in. Tap a candidate - one of the small digits.` })
    } else if (digits.length === 1) {
      onCandidate({ row: cell[0], col: cell[1], digit: digits[0] })
    } else {
      setSelected(cell)
      setFeedback(null)
    }
  }

  function onCandidate(pick: CandRef) {
    if (done || question.kind === 'choice' || question.kind === 'cells') return
    const key = candKey(pick)
    if (question.kind === 'candidates') {
      if (picked.includes(key)) {
        setSelected(null)
        setFeedback({ tone: 'note', text: 'You have already found that one.' })
      } else if (question.answers.some((a) => candKey(a) === key)) {
        hit(key, `Yes. ${question.need - picked.length - 1} more to find.`, question.need)
      } else {
        miss(question.wrong(pick), key)
      }
      return
    }
    if (colouredKeys.has(key)) {
      setSelected(null)
      setFeedback({ tone: 'note', text: 'That one is already coloured.' })
      return
    }
    const inChain = question.chain.some((c) => candKey(c) === key)
    const linked = inChain && [...colouredKeys].some((coloured) => question.edges.has(`${coloured}|${key}`))
    if (linked) {
      hit(key, question.pickNote(pick, colouredKeys), question.need)
    } else {
      miss(question.wrong(pick, colouredKeys), key)
    }
  }

  function onOption(index: number) {
    if (done || question.kind !== 'choice' || wrongOptions.includes(index)) return
    const option = question.options[index]
    if (option.correct) {
      finish(misses)
    } else {
      setWrongOptions([...wrongOptions, index])
      miss(option.why, null)
    }
  }

  // What the board shows: the question's picture plus what has been found so
  // far (and, after two misses, one answer ringed); the answer once done.
  let frame: QuizFrame = question.frame
  let hitCells: TutorialCell[] = []
  let revealCells: TutorialCell[] = []
  if (done) {
    frame = question.doneFrame
  } else if (question.kind === 'cells') {
    hitCells = question.answers.filter((a) => picked.includes(cellKeyOf(a)))
    const next = question.answers.find((a) => !picked.includes(cellKeyOf(a)))
    if (revealed && next) revealCells = [next]
  } else if (question.kind === 'candidates') {
    const found = question.answers.filter((a) => picked.includes(candKey(a)))
    const next = question.answers.find((a) => !picked.includes(candKey(a)))
    frame = {
      ...frame,
      [question.pickLook]: [...(frame[question.pickLook] ?? []), ...found],
      fresh: revealed && next ? [next] : undefined,
    }
  } else if (question.kind === 'colour') {
    const next = question.chain.find(
      (c) => !colouredKeys.has(candKey(c)) && [...colouredKeys].some((coloured) => question.edges.has(`${coloured}|${candKey(c)}`)),
    )
    frame = {
      ...frame,
      coloured: question.chain.filter((c) => colouredKeys.has(candKey(c))),
      fresh: revealed && next ? [next] : undefined,
    }
  }

  const interaction: TutorialGridInteraction | undefined =
    done || question.kind === 'choice'
      ? undefined
      : {
          onCell,
          onCandidate: question.kind !== 'cells' && directPips ? onCandidate : undefined,
          selected,
          wrong: wrongKey,
          hitCells,
          revealCells,
        }

  const selectedDigits = selected ? markedCandidateDigits(state.candidates[selected[0]][selected[1]]) : []
  const tapHint =
    question.kind === 'cells'
      ? 'Tap a cell on the board.'
      : question.kind === 'choice'
        ? null
        : directPips
          ? 'Tap a candidate (a small digit) on the board.'
          : 'Tap a cell on the board, then pick its candidate.'
  const need = question.kind === 'choice' ? 1 : question.need
  // The key covers the answer picture too (and a colouring question's whole
  // chain), so it doesn't change the moment the question is answered.
  const keyFrames = useMemo(
    () => [question.frame, question.doneFrame, ...(question.kind === 'colour' ? [{ coloured: question.chain }] : [])],
    [question],
  )

  return (
    <section className="tutorial-player tutorial-quiz" aria-label={`Practice question ${number} of ${total}`}>
      <div className="tutorial-player-board">
        <TutorialGrid state={state} frame={frame} size="lg" ariaLabel={question.prompt} interaction={interaction} />
      </div>
      <div className="tutorial-player-side">
        <div className="tutorial-step-meta">
          <span className="tutorial-badge">{question.badge}</span>
          <span className="tutorial-step-count">
            Question {number} of {total}
          </span>
          {!done && need > 1 && (
            <span className="tutorial-quiz-count">
              {picked.length} of {need} {question.kind === 'colour' ? 'coloured' : 'found'}
            </span>
          )}
        </div>
        <p className="tutorial-caption tutorial-quiz-prompt">{question.prompt}</p>

        {question.kind === 'choice' && (
          <div className="tutorial-quiz-options" role="group" aria-label="Answers">
            {question.options.map((option, index) => {
              const wrong = wrongOptions.includes(index)
              const right = done && option.correct
              return (
                <button
                  key={option.label}
                  type="button"
                  className={['tutorial-quiz-option', wrong ? 'wrong' : '', right ? 'right' : ''].filter(Boolean).join(' ')}
                  disabled={wrong || (done && !right)}
                  aria-disabled={done || undefined}
                  data-track="Practice answer"
                  onClick={() => onOption(index)}
                >
                  {option.swatch && <span className={`tutorial-swatch tutorial-swatch-${option.swatch}`} aria-hidden="true" />}
                  <span className="tutorial-quiz-option-label">{option.label}</span>
                  {(wrong || right) && (
                    <span className="tutorial-quiz-option-mark" aria-hidden="true">
                      {right ? '✓' : '✗'}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        )}

        {selected && !done && (
          <div className="tutorial-quiz-picker" role="group" aria-label={`Candidates of ${cellName(selected)}`}>
            <span className="tutorial-quiz-picker-label">Which candidate of {cellName(selected)}?</span>
            {selectedDigits.map((digit) => (
              <button
                key={digit}
                type="button"
                className="tutorial-quiz-digit"
                data-track="Practice digit"
                onClick={() => onCandidate({ row: selected[0], col: selected[1], digit })}
              >
                {digit}
              </button>
            ))}
          </div>
        )}

        <p className={['tutorial-quiz-feedback', feedback ? feedback.tone : 'idle'].join(' ')} aria-live="polite">
          {feedback ? (
            <>
              {feedback.tone !== 'note' && (
                <span className="tutorial-quiz-feedback-mark" aria-hidden="true">
                  {feedback.tone === 'good' ? '✓' : '✗'}
                </span>
              )}
              {feedback.text}
            </>
          ) : (
            tapHint
          )}
        </p>

        <div className="tutorial-dots tutorial-quiz-dots" role="img" aria-label={`Question ${number} of ${total}`}>
          {Array.from({ length: total }, (_, index) => {
            const result = index < earlier.length ? earlier[index] : index === number - 1 && done ? { misses, revealed } : null
            const look = result ? (result.misses === 0 ? 'first-try' : 'missed') : index === number - 1 ? 'active' : ''
            return <span key={index} className={['tutorial-dot', look].filter(Boolean).join(' ')} />
          })}
        </div>
        <div className="tutorial-controls">
          <button ref={nextButton} type="button" className="primary" disabled={!done} data-track="Practice next" onClick={onNext}>
            {number === total ? 'Finish ✓' : 'Next →'}
          </button>
        </div>
        <ColourKey frames={keyFrames} coloursOnly />
      </div>
    </section>
  )
}

interface QuizPlayerProps {
  quiz: Quiz
  /** Where this quiz sits, for usage analytics ("How It Works › Basics ›
   * Singles › Practice"). */
  areaName: string
  /** Back to the lesson. */
  onExit: () => void
}

/**
 * A lesson's practice quiz: a few easy questions answered on the board
 * itself, each with an explanation the moment it is answered. Nothing is
 * scored and nothing can be failed - a wrong tap says why and lets you try
 * again, and two of them ring the answer.
 */
export default function QuizPlayer({ quiz, areaName, onExit }: QuizPlayerProps) {
  const [index, setIndex] = useState(0)
  const [results, setResults] = useState<QuestionResult[]>([])
  // One pass through the quiz; "Practise again" starts a new one.
  const [run, setRun] = useState(randomId)
  const total = quiz.questions.length
  const finished = index >= total
  useAnalyticsArea(areaName, AREA_LAYER.tutorialPractice)

  useEffect(() => {
    trackEvent('quiz', 'Started', quiz.id)
  }, [quiz.id, run])

  function onAnswered(result: QuestionResult, ms: number) {
    const question = quiz.questions[index]
    setResults((earlier) => [...earlier.slice(0, index), result])
    trackQuizAnswer({
      quiz: quiz.id,
      run,
      question: question.id,
      kind: question.kind,
      index,
      total,
      misses: result.misses,
      revealed: result.revealed,
      ms,
    })
  }

  function onNext() {
    if (index === total - 1) {
      markQuizDone(quiz.id)
      trackEvent('quiz', 'Completed', quiz.id)
    }
    setIndex(index + 1)
  }

  function restart() {
    setResults([])
    setIndex(0)
    setRun(randomId())
  }

  if (finished) {
    const flawless = results.every((r) => r.misses === 0)
    return (
      <section className="tutorial-card tutorial-quiz-summary" aria-label="Practice complete">
        <div className="tutorial-quiz-summary-mark" aria-hidden="true">
          ✓
        </div>
        <h3>Practice complete</h3>
        <p>
          {flawless
            ? `Every answer right first time. ${quiz.title} is yours.`
            : 'Done. The ones that took a second try are the ones worth another look at the lesson.'}
        </p>
        <div className="tutorial-dots tutorial-quiz-dots" role="img" aria-label="How each question went">
          {results.map((result, i) => (
            <span key={i} className={['tutorial-dot', result.misses === 0 ? 'first-try' : 'missed'].join(' ')} />
          ))}
        </div>
        <div className="tutorial-controls">
          <button type="button" onClick={restart}>
            ↺ Practise again
          </button>
          <button type="button" className="primary" onClick={onExit}>
            Back to the lesson
          </button>
        </div>
      </section>
    )
  }

  return (
    <QuestionView
      key={`${run}-${index}`}
      question={quiz.questions[index]}
      number={index + 1}
      total={total}
      earlier={results.slice(0, index)}
      onAnswered={onAnswered}
      onNext={onNext}
    />
  )
}
