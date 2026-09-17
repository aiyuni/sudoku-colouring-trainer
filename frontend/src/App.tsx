import { useMemo, useState, type KeyboardEvent } from 'react'
import {
  cloneBoard,
  cloneCandidates,
  computeGivenMask,
  createEmptyBoard,
  createEmptyCandidates,
} from './sudoku/boardUtils'
import { SudokuGenerator } from './sudoku/SudokuGenerator'
import { SudokuRules } from './sudoku/SudokuRules'
import { SudokuSolver } from './sudoku/SudokuSolver'
import { SAMPLE_PUZZLE, type Board, type CandidateGrid } from './sudoku/types'
import './App.css'

const solver = new SudokuSolver()
const generator = new SudokuGenerator()

// A 3x3 grid of 3x3 boxes; reused for both the box index and the cell
// index within a box, since both range over the same nine values.
const NINE = [0, 1, 2, 3, 4, 5, 6, 7, 8]
const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9]

interface DigitPadProps {
  variant: 'solution' | 'candidate' | 'highlight'
  isActive?: (digit: number) => boolean
  isDisabled?: (digit: number) => boolean
  onSelect: (digit: number) => void
}

/** A 3x3 pad of digit buttons, laid out the same way candidates are (1-3
 * top, 4-6 middle, 7-9 bottom) so its position matches the in-cell marks. */
function DigitPad({ variant, isActive, isDisabled, onSelect }: DigitPadProps) {
  return (
    <div className="control-pad">
      {DIGITS.map((digit) => (
        <button
          key={digit}
          type="button"
          className={['pad-button', `${variant}-button`, isActive?.(digit) ? 'active' : '']
            .filter(Boolean)
            .join(' ')}
          disabled={isDisabled?.(digit) ?? false}
          onClick={() => onSelect(digit)}
        >
          {digit}
        </button>
      ))}
    </div>
  )
}

export default function App() {
  const [board, setBoard] = useState<Board>(() => cloneBoard(SAMPLE_PUZZLE))
  const [givens, setGivens] = useState<boolean[][]>(() => computeGivenMask(SAMPLE_PUZZLE))
  const [candidates, setCandidates] = useState<CandidateGrid>(() => createEmptyCandidates())
  const [selected, setSelected] = useState<{ row: number; col: number } | null>({
    row: 0,
    col: 2,
  })
  const [highlightedDigit, setHighlightedDigit] = useState<number | null>(null)
  const [keyboardMode, setKeyboardMode] = useState<'solution' | 'candidate'>('solution')
  const [solving, setSolving] = useState(false)
  const [generating, setGenerating] = useState(false)
  const busy = solving || generating
  const [status, setStatus] = useState('Enter digits, then click Solve.')

  const filled = useMemo(
    () => board.flat().filter((value) => value !== 0).length,
    [board],
  )

  const hasAnyCandidates = useMemo(
    () => candidates.some((row) => row.some((cell) => cell.some(Boolean))),
    [candidates],
  )

  const selectedIsLocked = selected !== null && givens[selected.row][selected.col]
  const selectedIsSolved = selected !== null && board[selected.row][selected.col] !== 0

  function setCellValue(row: number, col: number, value: number) {
    if (givens[row][col]) {
      // Puzzle clues are locked; only your own entries can be edited.
      return
    }
    setBoard((current) => {
      const next = cloneBoard(current)
      next[row][col] = value
      return next
    })
    // A solved cell doesn't need pencil marks any more.
    setCandidates((current) => {
      const next = cloneCandidates(current)
      next[row][col] = Array(9).fill(false)
      return next
    })
  }

  function clearCell(row: number, col: number) {
    if (givens[row][col]) {
      return
    }
    setBoard((current) => {
      const next = cloneBoard(current)
      next[row][col] = 0
      return next
    })
    setCandidates((current) => {
      const next = cloneCandidates(current)
      next[row][col] = Array(9).fill(false)
      return next
    })
  }

  function toggleCandidate(row: number, col: number, digit: number) {
    if (givens[row][col] || board[row][col] !== 0) {
      // Candidates only make sense on a cell that isn't solved yet.
      return
    }
    setCandidates((current) => {
      const next = cloneCandidates(current)
      const cell = [...next[row][col]]
      cell[digit - 1] = !cell[digit - 1]
      next[row][col] = cell
      return next
    })
  }

  function clearCandidates(row: number, col: number) {
    if (givens[row][col]) {
      return
    }
    setCandidates((current) => {
      const next = cloneCandidates(current)
      next[row][col] = Array(9).fill(false)
      return next
    })
  }

  function onAutofillCandidates() {
    setCandidates((current) => {
      const next = cloneCandidates(current)
      for (const r of NINE) {
        for (const c of NINE) {
          if (board[r][c] !== 0) {
            continue
          }
          next[r][c] = DIGITS.map((digit) => SudokuRules.isSafe(board, r, c, digit))
        }
      }
      return next
    })
  }

  function onClearAllCandidates() {
    setCandidates((current) =>
      current.map((row, r) =>
        row.map((cell, c) => (board[r][c] === 0 ? Array(9).fill(false) : cell)),
      ),
    )
  }

  function toggleKeyboardMode() {
    setKeyboardMode((current) => (current === 'solution' ? 'candidate' : 'solution'))
  }

  function onCellClick(row: number, col: number) {
    setSelected({ row, col })
    const value = board[row][col]
    if (value !== 0) {
      setHighlightedDigit(value)
    }
  }

  function onHighlightDigit(digit: number) {
    setHighlightedDigit((current) => (current === digit ? null : digit))
  }

  function cellAriaLabel(row: number, col: number, value: number): string {
    const position = `row ${row + 1}, column ${col + 1}`
    if (value !== 0) {
      return `${value}, ${position}${givens[row][col] ? ', given' : ''}`
    }
    const marks = candidates[row][col]
      .map((active, i) => (active ? i + 1 : null))
      .filter((digit): digit is number => digit !== null)
    return marks.length > 0
      ? `Empty, ${position}, candidates ${marks.join(', ')}`
      : `Empty, ${position}`
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!selected) {
      return
    }

    const { row, col } = selected
    if (event.key >= '1' && event.key <= '9') {
      const digit = Number(event.key)
      if (keyboardMode === 'candidate') {
        toggleCandidate(row, col, digit)
      } else {
        setCellValue(row, col, digit)
      }
      return
    }
    if (event.key === 'Backspace' || event.key === 'Delete' || event.key === '0') {
      if (keyboardMode === 'candidate') {
        clearCandidates(row, col)
      } else {
        clearCell(row, col)
      }
      return
    }

    const move: Record<string, [number, number]> = {
      ArrowUp: [row - 1, col],
      ArrowDown: [row + 1, col],
      ArrowLeft: [row, col - 1],
      ArrowRight: [row, col + 1],
    }
    const next = move[event.key]
    if (!next) {
      return
    }
    event.preventDefault()
    setSelected({
      row: Math.min(8, Math.max(0, next[0])),
      col: Math.min(8, Math.max(0, next[1])),
    })
  }

  function onSolve() {
    setSolving(true)
    setStatus('Solving…')

    // Defer to the next tick so the "Solving…" status paints before the
    // (synchronous) solve runs.
    window.setTimeout(() => {
      const response = solver.solve(board)
      if (response.solved && response.board) {
        setBoard(response.board)
        setCandidates(createEmptyCandidates())
      }
      setStatus(response.message)
      setSolving(false)
    }, 0)
  }

  function onClear() {
    const empty = createEmptyBoard()
    setBoard(empty)
    setGivens(computeGivenMask(empty))
    setCandidates(createEmptyCandidates())
    setHighlightedDigit(null)
    setStatus('Board cleared.')
  }

  function onNewPuzzle() {
    setGenerating(true)
    setStatus('Generating a new puzzle…')

    // Defer to the next tick so the status paints before the (synchronous,
    // and heavier than solving) generation work runs.
    window.setTimeout(() => {
      const puzzle = generator.generate()
      setBoard(puzzle)
      setGivens(computeGivenMask(puzzle))
      setCandidates(createEmptyCandidates())
      setHighlightedDigit(null)
      setStatus('New puzzle loaded. Click Solve to check it.')
      setGenerating(false)
    }, 0)
  }

  return (
    <main className="page" onKeyDown={onKeyDown}>
      <header className="header">
        <h1>Sudoku Solver</h1>
        <p>
          Select a cell, then use Solution or Candidates on the right to fill it in. Click any
          filled cell (or a Highlight button) to spotlight a digit.
        </p>
        <button
          type="button"
          className={['mode-toggle', keyboardMode].join(' ')}
          aria-pressed={keyboardMode === 'candidate'}
          onClick={toggleKeyboardMode}
        >
          Keyboard enters: <strong>{keyboardMode === 'solution' ? 'Solution' : 'Candidates'}</strong>
        </button>
      </header>

      <div className="board-area">
        <div className="grid" role="grid" aria-label="Sudoku board" tabIndex={0}>
          {NINE.map((boxIndex) => {
            const boxRow = Math.floor(boxIndex / 3)
            const boxCol = boxIndex % 3

            return (
              <div key={boxIndex} className="box" role="rowgroup">
                {NINE.map((cellIndex) => {
                  const r = boxRow * 3 + Math.floor(cellIndex / 3)
                  const c = boxCol * 3 + (cellIndex % 3)
                  const value = board[r][c]
                  const isSelected = selected?.row === r && selected?.col === c
                  const isDigitHighlighted = value !== 0 && highlightedDigit === value
                  const cellHasCandidates = candidates[r][c].some(Boolean)
                  const classes = [
                    'cell',
                    givens[r][c] ? 'given' : value ? 'filled' : '',
                    isSelected ? 'selected' : '',
                    isDigitHighlighted ? 'digit-highlighted' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')

                  return (
                    <button
                      key={`${r}-${c}`}
                      type="button"
                      role="gridcell"
                      aria-selected={isSelected}
                      aria-readonly={givens[r][c]}
                      aria-label={cellAriaLabel(r, c, value)}
                      className={classes}
                      onClick={() => onCellClick(r, c)}
                    >
                      {value !== 0 ? (
                        value
                      ) : cellHasCandidates ? (
                        <span className="candidates" aria-hidden="true">
                          {DIGITS.map((digit) => {
                            const active = candidates[r][c][digit - 1]
                            const isHighlighted = active && highlightedDigit === digit
                            return (
                              <span
                                key={digit}
                                className={[
                                  'candidate',
                                  active ? 'active' : '',
                                  isHighlighted ? 'highlighted' : '',
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
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>

        <div className="controls">
          <section className="control-group solution-group">
            <h2 className="control-label">Solution</h2>
            <DigitPad
              variant="solution"
              isDisabled={() => !selected || selectedIsLocked}
              onSelect={(digit) => selected && setCellValue(selected.row, selected.col, digit)}
            />
            <button
              type="button"
              className="pad-button erase-button"
              disabled={!selected || selectedIsLocked}
              onClick={() => selected && clearCell(selected.row, selected.col)}
            >
              Erase
            </button>
          </section>

          <section className="control-group candidate-group">
            <h2 className="control-label">Candidates</h2>
            <DigitPad
              variant="candidate"
              isDisabled={() => !selected || selectedIsLocked || selectedIsSolved}
              onSelect={(digit) => selected && toggleCandidate(selected.row, selected.col, digit)}
            />
            <button
              type="button"
              className="pad-button erase-button"
              disabled={!selected || selectedIsLocked || selectedIsSolved}
              onClick={() => selected && clearCandidates(selected.row, selected.col)}
            >
              Clear marks
            </button>
            <div className="candidate-bulk-actions">
              <button
                type="button"
                className="pad-button"
                disabled={busy || filled === 81}
                onClick={onAutofillCandidates}
              >
                Autofill all
              </button>
              <button
                type="button"
                className="pad-button"
                disabled={busy || !hasAnyCandidates}
                onClick={onClearAllCandidates}
              >
                Clear all
              </button>
            </div>
          </section>

          <section className="control-group highlight-group">
            <h2 className="control-label">Highlight digit</h2>
            <DigitPad
              variant="highlight"
              isActive={(digit) => highlightedDigit === digit}
              onSelect={onHighlightDigit}
            />
            <button
              type="button"
              className="pad-button erase-button"
              disabled={highlightedDigit === null}
              onClick={() => setHighlightedDigit(null)}
            >
              Clear highlight
            </button>
          </section>
        </div>
      </div>

      <div className="actions">
        <button type="button" className="primary" onClick={onSolve} disabled={busy}>
          {solving ? 'Solving…' : 'Solve'}
        </button>
        <button type="button" onClick={onNewPuzzle} disabled={busy}>
          {generating ? 'Generating…' : 'New puzzle'}
        </button>
        <button type="button" onClick={onClear} disabled={busy}>
          Clear
        </button>
      </div>

      <p className="status" role="status">
        {status} <span className="muted">({filled}/81 filled)</span>
      </p>
    </main>
  )
}
