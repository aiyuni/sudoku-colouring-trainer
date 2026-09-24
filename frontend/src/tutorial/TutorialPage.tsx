import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import TutorialGrid from './TutorialGrid'
import {
  buildBasicsGroups,
  buildColourLessons,
  buildUniquenessGroups,
  type ColourTabId,
  type LessonGroup,
} from './tutorialExamples'
import type { TutorialColor, TutorialLesson } from './tutorialTypes'
import './tutorial.css'

type TabId = 'basics' | ColourTabId | 'uniqueness'

/** The tab bar and the one line under it. Edit the wording here. */
const TABS: Array<{ id: TabId; label: string; tagline: string }> = [
  { id: 'basics', label: 'Basics', tagline: 'The fundamental Sudoku solving techniques, that will work alongside Colouring techniques.' },
  {
    id: 'simple',
    label: 'Simple Colouring',
    tagline: 'Pick one candidate digit that appears exactly twice in a row, column or mini-grid, and give each candidate a different Colour.  Repeat this, and use the fact that exactly one colour must be true, to make deductions.',
  },
  {
    id: 'medusa',
    label: '3D Medusa',
    tagline: 'Simple Colouring has evolved.  Extends Simple Colouring into multiple digits by using cells that contain only 2 candidates.',
  },
  {
    id: 'dragon',
    label: 'Dragon Colouring',
    tagline: 'Take a stuck Medusa and assume a Medusa colour is true and follow what it forces. The extra colours can find what Medusa cannot.',
  },
  {
    id: 'dynamic',
    label: 'Dynamic Dragon',
    tagline: 'The strongest Colouring technique.  Dynamic Dragons are Dragons that can call on other techniques to keep the colouring going when regular Dragons get stuck.',
  },
  {
    id: 'uniqueness',
    label: 'Abusing Uniqueness',
    tagline:
      "Shortcuts (primarily Unique Rectangles) that rely on a proper puzzle having exactly one solution: a pattern that would allow two solutions can never happen, so whatever prevents it must be true. Uniqueness is never needed to solve a puzzle - you can always solve it without these - so this whole section can be skipped.",
  },
]

// What each look on the board means - shown under the player, and only the
// ones the current example actually uses.
type LegendKind = TutorialColor | 'eliminated' | 'solved' | 'link' | 'helper'
const LEGEND_TEXT: Record<LegendKind, { label: string; note?: string }> = {
  blue: { label: 'Blue' },
  yellow: { label: 'Yellow' },
  darkBlue: { label: 'Dark blue', note: 'true if light blue is' },
  orange: { label: 'Orange', note: 'true if yellow is' },
  eliminated: { label: 'Eliminated' },
  solved: { label: 'Answer' },
  link: { label: 'Link' },
  helper: { label: 'Helper technique' },
}

function legendFor(lesson: TutorialLesson): LegendKind[] {
  const used = new Set<LegendKind>()
  for (const frame of lesson.frames) {
    for (const c of frame.coloured ?? []) used.add(c.color)
    if (frame.eliminated?.length) used.add('eliminated')
    if (frame.solved?.length) used.add('solved')
    if (frame.links?.some((l) => l.kind === 'strong')) used.add('link')
    if (frame.greenCells?.length) used.add('helper')
  }
  const order: LegendKind[] = ['blue', 'yellow', 'darkBlue', 'orange', 'link', 'eliminated', 'solved', 'helper']
  return order.filter((kind) => used.has(kind))
}

function Legend({ lesson }: { lesson: TutorialLesson }) {
  // Dragon lessons talk about "light blue" next to "dark blue".
  const hasDragonColours = lesson.frames.some((f) => f.coloured?.some((c) => c.color === 'darkBlue' || c.color === 'orange'))
  const items = legendFor(lesson)
  if (items.length === 0) return null
  return (
    <ul className="tutorial-legend" aria-label="Colour key">
      {items.map((kind) => {
        const { label, note } = LEGEND_TEXT[kind]
        const text = kind === 'blue' && hasDragonColours ? 'Light blue' : label
        return (
          <li key={kind}>
            <span className={`tutorial-swatch tutorial-swatch-${kind}`} aria-hidden="true" />
            <span>
              {text}
              {note && <span className="tutorial-legend-note"> - {note}</span>}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

interface LessonPlayerProps {
  lesson: TutorialLesson
  initialStep?: number
}

/** One example, revealed a step at a time. Each step is a `TutorialFrame`
 * that lists exactly what to show, so Back/Next just swap which frame is on
 * screen - the newest candidate carries a ring so the eye lands on it. */
export function LessonPlayer({ lesson, initialStep = 0 }: LessonPlayerProps) {
  const total = lesson.frames.length
  const [step, setStep] = useState(Math.min(initialStep, total - 1))
  const frame = lesson.frames[step]
  const atEnd = step === total - 1

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.target as HTMLElement | null)?.closest('[role="tablist"]')) return
      if (event.key === 'ArrowRight') setStep((s) => Math.min(s + 1, total - 1))
      if (event.key === 'ArrowLeft') setStep((s) => Math.max(s - 1, 0))
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [total])

  return (
    <section className="tutorial-player" aria-label={lesson.title}>
      <div className="tutorial-player-board">
        <TutorialGrid state={lesson.state} frame={frame} size="lg" />
      </div>
      <div className="tutorial-player-side">
        <div className="tutorial-step-meta">
          {frame.badge && <span className="tutorial-badge">{frame.badge}</span>}
          <span className="tutorial-step-count">
            Step {step + 1} of {total}
          </span>
        </div>
        <p className="tutorial-caption" aria-live="polite">
          {frame.caption}
        </p>
        <div className="tutorial-dots" role="group" aria-label="Steps">
          {lesson.frames.map((_, index) => (
            <button
              key={index}
              type="button"
              className={['tutorial-dot', index === step ? 'active' : '', index < step ? 'done' : ''].filter(Boolean).join(' ')}
              aria-label={`Go to step ${index + 1}`}
              aria-current={index === step ? 'step' : undefined}
              onClick={() => setStep(index)}
            />
          ))}
        </div>
        <div className="tutorial-controls">
          <button type="button" onClick={() => setStep((s) => Math.max(s - 1, 0))} disabled={step === 0}>
            ← Back
          </button>
          {atEnd ? (
            <button type="button" className="primary" onClick={() => setStep(0)}>
              ↺ Replay
            </button>
          ) : (
            <button type="button" className="primary" onClick={() => setStep((s) => Math.min(s + 1, total - 1))}>
              Next →
            </button>
          )}
        </div>
        <Legend lesson={lesson} />
      </div>
    </section>
  )
}

/** A tab that teaches several techniques: one sub-tab per technique, so the
 * reader can jump straight to the one they want. A group whose every example
 * was skipped (see `safely` in tutorialExamples.ts) gets no sub-tab. */
function GroupTabs({ groups, label, render }: { groups: LessonGroup[]; label: string; render: (group: LessonGroup) => ReactNode }) {
  const shown = groups.filter((group) => group.lessons.length > 0)
  const [index, setIndex] = useState(0)
  const group = shown[Math.min(index, shown.length - 1)]
  if (!group) {
    return <p className="tutorial-empty">These examples aren't available right now.</p>
  }
  return (
    <div className="tutorial-grouped">
      <div className="tutorial-subtabs" role="tablist" aria-label={label}>
        {shown.map((candidate, i) => (
          <button
            key={candidate.title}
            type="button"
            role="tab"
            aria-selected={i === index}
            className={['tutorial-subtab', i === index ? 'active' : ''].filter(Boolean).join(' ')}
            onClick={() => setIndex(i)}
          >
            {candidate.title}
          </button>
        ))}
      </div>
      <p className="tutorial-subtab-blurb">{group.blurb}</p>
      <div role="tabpanel" aria-label={group.title}>
        {render(group)}
      </div>
    </div>
  )
}

/** Basics: every step of the technique's example(s) on screen at once, side by side. */
function BasicsView() {
  const groups = useMemo(() => buildBasicsGroups(), [])
  return (
    <GroupTabs
      groups={groups}
      label="Basic techniques"
      render={(group) => (
        <section className="tutorial-card">
          {group.lessons.map((lesson) => (
            <div key={lesson.id} className="tutorial-example">
              {group.lessons.length > 1 && (
                <h3>
                  {lesson.title} <span className="tutorial-example-hint">{lesson.hint}</span>
                </h3>
              )}
              <div className="tutorial-strip">
                {lesson.frames.map((frame, index) => (
                  <figure key={index} className="tutorial-figure">
                    <TutorialGrid state={lesson.state} frame={frame} size="md" />
                    <figcaption>
                      {frame.badge && <span className="tutorial-badge">{frame.badge}</span>}
                      {frame.caption}
                    </figcaption>
                  </figure>
                ))}
              </div>
            </div>
          ))}
        </section>
      )}
    />
  )
}

/** Abusing Uniqueness: a sub-tab per technique, each played step by step. */
function UniquenessView() {
  const groups = useMemo(() => buildUniquenessGroups(), [])
  return (
    <GroupTabs
      groups={groups}
      label="Uniqueness techniques"
      render={(group) => <LessonSwitcher key={group.title} lessons={group.lessons} />}
    />
  )
}

function ColourView({ tab }: { tab: ColourTabId }) {
  const lessons = useMemo(() => buildColourLessons(tab), [tab])
  return <LessonSwitcher lessons={lessons} />
}

/** One or more examples played step by step, with a pill per example when
 * there's more than one. */
function LessonSwitcher({ lessons }: { lessons: TutorialLesson[] }) {
  const [index, setIndex] = useState(0)
  const lesson = lessons[Math.min(index, lessons.length - 1)]
  if (!lesson) {
    return <p className="tutorial-empty">This example isn't available right now.</p>
  }
  return (
    <div className="tutorial-colour">
      {lessons.length > 1 && (
        <div className="tutorial-pills" role="group" aria-label="Examples">
          {lessons.map((candidate, i) => (
            <button
              key={candidate.id}
              type="button"
              className={['tutorial-pill', i === index ? 'active' : ''].filter(Boolean).join(' ')}
              aria-pressed={i === index}
              onClick={() => setIndex(i)}
            >
              {candidate.title}
            </button>
          ))}
        </div>
      )}
      {lesson.hint && <p className="tutorial-lesson-hint">{lesson.hint}</p>}
      <LessonPlayer key={lesson.id} lesson={lesson} />
    </div>
  )
}

interface TutorialPageProps {
  onClose: () => void
  initialTab?: TabId
}

/**
 * The "How It Works" page: a full-screen overlay over the solver (so closing
 * it lands you exactly where you were, board and settings untouched) with a
 * tab per technique. Everything on it is generated from real positions by the
 * app's own solver code - see tutorialExamples.ts to change what it teaches.
 */
export default function TutorialPage({ onClose, initialTab = 'basics' }: TutorialPageProps) {
  const [tab, setTab] = useState<TabId>(initialTab)
  const contentRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onCloseRef.current()
    }
    document.addEventListener('keydown', onKeyDown)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      previouslyFocused?.focus()
    }
  }, [])

  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 })
  }, [tab])

  const current = TABS.find((t) => t.id === tab)!

  return (
    <div className="tutorial-page" role="dialog" aria-modal="true" aria-labelledby="tutorial-title" ref={contentRef}>
      <header className="tutorial-header">
        <div className="tutorial-header-inner">
          <button type="button" className="tutorial-back" onClick={onClose}>
            ← Back to puzzle
          </button>
          <h1 id="tutorial-title">Colouring Techniques Explained</h1>
        </div>
        <div className="tutorial-tabs" role="tablist" aria-label="Techniques">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`tutorial-tab-${t.id}`}
              aria-selected={t.id === tab}
              aria-controls="tutorial-panel"
              className={['tutorial-tab', t.id === tab ? 'active' : ''].filter(Boolean).join(' ')}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </header>

      <div className="tutorial-content" role="tabpanel" id="tutorial-panel" aria-labelledby={`tutorial-tab-${tab}`}>
        <p className="tutorial-tagline">{current.tagline}</p>
        {tab === 'basics' ? <BasicsView /> : tab === 'uniqueness' ? <UniquenessView /> : <ColourView key={tab} tab={tab} />}
      </div>
    </div>
  )
}
