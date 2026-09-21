import { useId } from 'react'
import { markedCandidateDigits } from '../sudoku/boardUtils'
import { candKey, stateForFrame } from './puzzleState'
import type { CandRef, PuzzleState, TutorialFrame } from './tutorialTypes'

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
} as const

interface TutorialGridProps {
  state: PuzzleState
  frame: TutorialFrame
  /** 'md' fits two side by side; 'lg' is the main picture of a stepper. */
  size?: 'md' | 'lg'
  ariaLabel?: string
}

/**
 * A read-only Sudoku board for the tutorial. It deliberately renders the same
 * `.grid > .box > .cell > .candidates > .candidate` structure, with the same
 * technique-* colour classes, as the main board in App.tsx - so a coloured
 * candidate here looks exactly like one in the Techniques panel - and adds a
 * few `tutorial-*` classes (dimming, a ring on the newest candidate, a tint
 * over a unit) on top.
 */
export default function TutorialGrid({ state, frame, size = 'md', ariaLabel }: TutorialGridProps) {
  const markerId = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const { board, candidates, placed } = stateForFrame(state, frame)

  const keys = (refs: CandRef[] | undefined) => new Set((refs ?? []).map(candKey))
  const eliminated = keys(frame.eliminated)
  const solved = keys(frame.solved)
  const basis = keys(frame.basis)
  const fresh = keys(frame.fresh)
  const colourByKey = new Map((frame.coloured ?? []).map((c) => [candKey(c), c.color]))
  const cellSet = (cells: readonly (readonly [number, number])[] | undefined) =>
    new Set((cells ?? []).map(([r, c]) => `${r},${c}`))
  const outline = cellSet(frame.outlineCells)
  const green = cellSet(frame.greenCells)
  const tint = cellSet(frame.unitCells)

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
      className={['grid', 'grid-white-mode', 'tutorial-grid', `tutorial-grid-${size}`].join(' ')}
      role="img"
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
              ]
                .filter(Boolean)
                .join(' ')
              const hasCandidates = value === 0 && markedCandidateDigits(candidates[r][c]).length > 0
              return (
                <div key={cellKey} className={classes}>
                  {value !== 0 ? (
                    value
                  ) : hasCandidates ? (
                    <span className="candidates" aria-hidden="true">
                      {DIGITS.map((digit) => {
                        const active = candidates[r][c][digit - 1]
                        const key = `${r},${c},${digit}`
                        const colour = colourByKey.get(key)
                        // One look per pip, most meaningful first: gone (red),
                        // the answer (green), a colour, a technique's basis.
                        const look = !active
                          ? ''
                          : eliminated.has(key)
                            ? 'technique-eliminated'
                            : solved.has(key)
                              ? 'technique-solved'
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
                            ]
                              .filter(Boolean)
                              .join(' ')}
                          >
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
