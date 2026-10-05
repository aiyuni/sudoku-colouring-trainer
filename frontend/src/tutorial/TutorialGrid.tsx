import { useId, type KeyboardEvent } from 'react'
import { markedCandidateDigits } from '../sudoku/boardUtils'
import { candKey, stateForFrame } from './puzzleState'
import {
  TUTORIAL_COLOUR_HEX,
  type CandRef,
  type PuzzleState,
  type TutorialCell,
  type TutorialColor,
  type TutorialFrame,
} from './tutorialTypes'

const NINE = [0, 1, 2, 3, 4, 5, 6, 7, 8]
const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9]

// Same 900x900 drawing space (9 cells x 100) the app's own link overlays use.
const CELL_SIZE = 100
const PIP_SIZE = CELL_SIZE / 3

function pipCenter(ref: CandRef) {
  const pipRow = Math.floor((ref.digit - 1) / 3)
  const pipCol = (ref.digit - 1) % 3
  return {
    x: ref.col * CELL_SIZE + (pipCol + 0.5) * PIP_SIZE,
    y: ref.row * CELL_SIZE + (pipRow + 0.5) * PIP_SIZE,
  }
}

const COLOUR_CLASS = {
  blue: 'technique-blue',
  yellow: 'technique-yellow',
  darkBlue: 'technique-darkblue',
  orange: 'technique-orange',
  pink: 'technique-pink',
  purple: 'technique-purple',
  limeGreen: 'technique-limegreen',
  darkGreen: 'technique-darkgreen',
} as const


/** What makes a tutorial board tappable - the practice quizzes (QuizPlayer).
 * The board stays a picture of a `frame`; this only reports taps and marks
 * the cells the quiz is talking about. */
export interface TutorialGridInteraction {
  onCell: (cell: TutorialCell) => void
  /** A tap on one pencil mark. Left out where pips are too small to hit (a
   * touch screen): every tap is then a cell tap, and the quiz asks which
   * digit was meant. */
  onCandidate?: (ref: CandRef) => void
  /** The cell whose digit is being asked for. */
  selected?: TutorialCell | null
  /** The last wrong tap - "row,col" or candKey - shaken once. */
  wrong?: string | null
  /** Cells already found (green), and a cell given away after misses (ringed). */
  hitCells?: readonly TutorialCell[]
  revealCells?: readonly TutorialCell[]
}

interface TutorialGridProps {
  state: PuzzleState
  frame: Omit<TutorialFrame, 'caption'> & { caption?: string }
  /** 'md' fits two side by side; 'lg' is the main picture of a stepper. */
  size?: 'md' | 'lg'
  ariaLabel?: string
  interaction?: TutorialGridInteraction
}

/**
 * A read-only Sudoku board for the tutorial. It deliberately renders the same
 * `.grid > .box > .cell > .candidates > .candidate` structure, with the same
 * technique-* colour classes, as the main board in App.tsx - so a coloured
 * candidate here looks exactly like one in the Techniques panel - and adds a
 * few `tutorial-*` classes (dimming, a ring on the newest candidate, a tint
 * over a unit) on top.
 */
export default function TutorialGrid({ state, frame, size = 'md', ariaLabel, interaction }: TutorialGridProps) {
  const markerId = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const { board, candidates, placed } = stateForFrame(state, frame)

  const keys = (refs: CandRef[] | undefined) => new Set((refs ?? []).map(candKey))
  const eliminated = keys(frame.eliminated)
  const solved = keys(frame.solved)
  const basis = keys(frame.basis)
  const fresh = keys(frame.fresh)
  // A Double Dragon candidate both Dragons colour has two entries here.
  const coloursByKey = new Map<string, TutorialColor[]>()
  for (const c of frame.coloured ?? []) {
    const key = candKey(c)
    coloursByKey.set(key, [...(coloursByKey.get(key) ?? []), c.color])
  }
  const cellSet = (cells: readonly (readonly [number, number])[] | undefined) =>
    new Set((cells ?? []).map(([r, c]) => `${r},${c}`))
  const outline = cellSet(frame.outlineCells)
  const green = cellSet(frame.greenCells)
  const tint = cellSet(frame.unitCells)
  const hit = cellSet(interaction?.hitCells)
  const reveal = cellSet(interaction?.revealCells)
  const selectedKey = interaction?.selected ? `${interaction.selected[0]},${interaction.selected[1]}` : null

  const spotlight = frame.spotlight
  const spotCells = cellSet(spotlight?.cells)
  const isDim = (row: number, col: number, digit: number): boolean => {
    if (!spotlight) return false
    if (spotlight.digits?.includes(digit)) return false
    if (spotCells.has(`${row},${col}`)) return false
    return true
  }

  // Each link is drawn a little short of both ends so the digit under it
  // stays readable, and so an arrowhead lands beside the target, not on it.
  const links = (frame.links ?? []).map((link) => {
    const a = pipCenter(link.from)
    const b = pipCenter(link.to)
    const dx = b.x - a.x
    const dy = b.y - a.y
    const length = Math.hypot(dx, dy) || 1
    const trimStart = Math.min(16, length * 0.25)
    const trimEnd = Math.min(link.arrow ? 24 : 16, length * 0.3)
    return {
      link,
      x1: a.x + (dx / length) * trimStart,
      y1: a.y + (dy / length) * trimStart,
      x2: b.x - (dx / length) * trimEnd,
      y2: b.y - (dy / length) * trimEnd,
    }
  })

  return (
    <div
      className={['grid', 'grid-white-mode', 'tutorial-grid', `tutorial-grid-${size}`, interaction ? 'tutorial-grid-interactive' : '', interaction?.onCandidate ? 'tutorial-grid-pips' : '']
        .filter(Boolean)
        .join(' ')}
      role={interaction ? 'group' : 'img'}
      aria-label={ariaLabel ?? frame.caption}
    >
      {NINE.map((boxIndex) => {
        const boxRow = Math.floor(boxIndex / 3)
        const boxCol = boxIndex % 3
        return (
          <div key={boxIndex} className="box">
            {NINE.map((cellIndex) => {
              const r = boxRow * 3 + Math.floor(cellIndex / 3)
              const c = boxCol * 3 + (cellIndex % 3)
              const value = board[r][c]
              const cellKey = `${r},${c}`
              const classes = [
                'cell',
                state.givens[r][c] ? 'given' : value ? 'filled' : '',
                placed.has(cellKey) ? 'tutorial-placed' : '',
                outline.has(cellKey) ? 'technique-used' : '',
                green.has(cellKey) ? 'dragon-technique-cell' : '',
                tint.has(cellKey) ? 'tutorial-unit' : '',
                hit.has(cellKey) ? 'tutorial-quiz-hit' : '',
                reveal.has(cellKey) ? 'tutorial-quiz-reveal' : '',
                selectedKey === cellKey ? 'tutorial-quiz-selected' : '',
                interaction?.wrong === cellKey ? 'tutorial-quiz-wrong' : '',
              ]
                .filter(Boolean)
                .join(' ')
              const hasCandidates = value === 0 && markedCandidateDigits(candidates[r][c]).length > 0
              const cellDigits = value === 0 ? markedCandidateDigits(candidates[r][c]) : []
              const tappable = interaction
                ? {
                    role: 'button',
                    tabIndex: 0,
                    'aria-label': `r${r + 1}c${c + 1}: ${value !== 0 ? value : cellDigits.length > 0 ? `candidates ${cellDigits.join(' ')}` : 'empty'}`,
                    onClick: () => interaction.onCell([r, c]),
                    onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        interaction.onCell([r, c])
                      }
                    },
                  }
                : {}
              return (
                <div key={cellKey} className={classes} {...tappable}>
                  {value !== 0 ? (
                    value
                  ) : hasCandidates ? (
                    <span className="candidates" aria-hidden="true">
                      {DIGITS.map((digit) => {
                        const active = candidates[r][c][digit - 1]
                        const key = `${r},${c},${digit}`
                        const colours = coloursByKey.get(key) ?? []
                        const colour = colours[0]
                        const split = colours.length > 1 ? colours : null
                        // One look per pip, most meaningful first: gone (red),
                        // the answer (green), a colour, a technique's basis.
                        const look = !active
                          ? ''
                          : eliminated.has(key)
                            ? 'technique-eliminated'
                            : solved.has(key)
                              ? 'technique-solved'
                              : split
                                ? 'candidate-painted technique-dragon-split'
                                : colour
                                  ? COLOUR_CLASS[colour]
                                  : basis.has(key)
                                    ? 'technique-used'
                                    : ''
                        const dim = active && !look && isDim(r, c, digit)
                        return (
                          <span
                            key={digit}
                            className={[
                              'candidate',
                              active ? 'active' : '',
                              look,
                              active && fresh.has(key) ? 'tutorial-fresh' : '',
                              dim ? 'tutorial-dim' : '',
                              interaction?.wrong === key ? 'tutorial-quiz-wrong' : '',
                            ]
                              .filter(Boolean)
                              .join(' ')}
                            onClick={
                              active && interaction?.onCandidate
                                ? (event) => {
                                    event.stopPropagation()
                                    interaction.onCandidate!({ row: r, col: c, digit })
                                  }
                                : undefined
                            }
                          >
                            {active && split && look.includes('technique-dragon-split') && (
                              <>
                                <span className="paint-layer paint-layer-bottom-left">
                                  <span className="paint-shape paint-shape-circle" style={{ backgroundColor: TUTORIAL_COLOUR_HEX[split[0]] }} />
                                </span>
                                <span className="paint-layer paint-layer-top-right">
                                  <span className="paint-shape paint-shape-circle" style={{ backgroundColor: TUTORIAL_COLOUR_HEX[split[1]] }} />
                                </span>
                              </>
                            )}
                            {active ? digit : ''}
                          </span>
                        )
                      })}
                    </span>
                  ) : null}
                </div>
              )
            })}
          </div>
        )
      })}

      {links.length > 0 && (
        <svg className="tutorial-links" viewBox="0 0 900 900" aria-hidden="true">
          <defs>
            <marker id={`${markerId}-arrow`} viewBox="0 0 10 10" refX="7" refY="5" markerWidth="4.5" markerHeight="4.5" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" className="tutorial-arrowhead" />
            </marker>
          </defs>
          {links.map(({ link, x1, y1, x2, y2 }, index) => (
            <line
              key={index}
              className={link.kind === 'strong' ? 'tutorial-link-strong' : 'tutorial-link-sees'}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              markerEnd={link.arrow ? `url(#${markerId}-arrow)` : undefined}
            />
          ))}
        </svg>
      )}
    </div>
  )
}
