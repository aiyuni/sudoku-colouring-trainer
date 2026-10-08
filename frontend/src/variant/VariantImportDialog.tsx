import { useEffect, useId, useRef, useState } from 'react'
import { normalizeConstraints, type SudokuConstraints } from '../sudoku/SudokuConstraints'
import { variantName } from '../sudoku/VariantPuzzle'

/** What the user settled on in the dialog. `drawRegions` / `addCages`: the
 * puzzle is a Jigsaw / Killer but the import carried no regions / cages, so
 * they have to be put in by hand next. */
export interface VariantImportChoice {
  constraints: SudokuConstraints
  drawRegions: boolean
  addCages: boolean
}

interface VariantImportDialogProps {
  /** Where the puzzle came from - only changes the wording. */
  source: 'text' | 'screenshot'
  /** What the text or screenshot itself says about the puzzle's rules;
   * CLASSIC_CONSTRAINTS when it says nothing (plain digits). */
  detected: SudokuConstraints
  onConfirm: (choice: VariantImportChoice) => void
  onCancel: () => void
}

/**
 * The Variant page's "what kind of puzzle is this?" step, shown for every
 * string or screenshot import before anything is put on the grid (by
 * request). Plain digits can't say whether they are a Classic, X-Sudoku or
 * Anti-Knight puzzle - and a puzzle loaded under the wrong rules just reads
 * as "multiple solutions" - so the user picks; when the import does carry
 * its rules (regions, cages, the JSON's flags, a sudokux link) the same
 * dialog opens with them ticked and asks for a yes instead of assuming.
 *
 * One list of rules rather than a list of named variants: they mix
 * freely (a Killer Jigsaw, an Anti-Knight X-Sudoku), and none ticked is a
 * Classic Sudoku. Same backdrop and card as ConfirmDialog.
 */
export function VariantImportDialog({ source, detected, onConfirm, onCancel }: VariantImportDialogProps) {
  const titleId = useId()
  const confirmButtonRef = useRef<HTMLButtonElement>(null)
  const hasRegions = detected.regions !== null
  const hasCages = detected.cages.length > 0
  const determined = hasRegions || hasCages || detected.diagonals === true || detected.antiKnight === true || detected.entropy === true
  const [diagonals, setDiagonals] = useState(detected.diagonals === true)
  const [antiKnight, setAntiKnight] = useState(detected.antiKnight === true)
  const [entropy, setEntropy] = useState(detected.entropy === true)
  const [jigsaw, setJigsaw] = useState(hasRegions)
  const [killer, setKiller] = useState(hasCages)

  const onCancelRef = useRef(onCancel)
  useEffect(() => {
    onCancelRef.current = onCancel
  }, [onCancel])
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    confirmButtonRef.current?.focus()
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onCancelRef.current()
      }
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

  const from = source === 'screenshot' ? 'screenshot' : 'text'
  const detectedName = variantName(detected)
  // The name of what is ticked, whether or not its regions / cages exist yet.
  const chosenName =
    [antiKnight ? 'Anti-Knight' : '', entropy ? 'Entropy' : '', killer ? 'Killer' : '', jigsaw ? 'Jigsaw' : '', diagonals ? 'X-Sudoku' : ''].filter((part) => part !== '').join(' ') ||
    'Classic Sudoku'
  const drawRegions = jigsaw && !hasRegions
  const addCages = killer && !hasCages

  function confirm() {
    onConfirm({
      constraints: normalizeConstraints({
        regions: jigsaw ? detected.regions : null,
        cages: killer ? detected.cages : [],
        diagonals,
        antiKnight,
        entropy,
      }),
      drawRegions,
      addCages,
    })
  }

  const options: { key: string; checked: boolean; toggle: (on: boolean) => void; name: string; rule: string; note?: string }[] = [
    {
      key: 'diagonals',
      checked: diagonals,
      toggle: setDiagonals,
      name: 'X-Sudoku (diagonals)',
      rule: 'Each of the two long diagonals also holds every digit once.',
    },
    {
      key: 'antiKnight',
      checked: antiKnight,
      toggle: setAntiKnight,
      name: 'Anti-Knight',
      rule: "Two cells a chess knight's move apart can't hold the same digit.",
    },
    {
      key: 'entropy',
      checked: entropy,
      toggle: setEntropy,
      name: 'Entropy',
      rule: 'Every 2x2 square of cells holds a low (1-3), a middle (4-6) and a high (7-9) digit.',
    },
    {
      key: 'jigsaw',
      checked: jigsaw,
      toggle: setJigsaw,
      name: 'Jigsaw',
      rule: 'Nine irregular regions take the place of the 3x3 boxes.',
      note: hasRegions
        ? jigsaw
          ? `The regions were read from the ${from}.`
          : `The regions read from the ${from} will be dropped.`
        : jigsaw
          ? "The regions aren't in the " + from + ' - you draw them right after this.'
          : undefined,
    },
    {
      key: 'killer',
      checked: killer,
      toggle: setKiller,
      name: 'Killer',
      rule: 'Cages of cells that add up to a given sum, with no digit twice in a cage.',
      note: hasCages
        ? killer
          ? `${detected.cages.length} cage${detected.cages.length === 1 ? ' was' : 's were'} read from the ${from}.`
          : `The cages read from the ${from} will be dropped.`
        : killer
          ? source === 'screenshot'
            ? "Cages and their sums aren't read from a screenshot - you add them after this."
            : "The cages aren't in the text - you add them after this."
          : undefined,
    },
  ]

  return (
    <div
      className="confirm-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onCancel()
        }
      }}
    >
      <div className="confirm-dialog variant-import-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="confirm-header">
          <span className="confirm-icon" aria-hidden="true">
            ?
          </span>
          <h2 id={titleId}>{determined ? `Is this ${/^[AEIOX]/.test(detectedName) ? 'an' : 'a'} ${detectedName} puzzle?` : 'What kind of puzzle is this?'}</h2>
        </div>
        <div className="confirm-body">
          {determined ? (
            <p>
              The {from} looks like {/^[AEIOX]/.test(detectedName) ? 'an' : 'a'} <b>{detectedName}</b> puzzle. If that's right, just import it. If not, change
              the rules below first.
            </p>
          ) : (
            <p>
              {source === 'screenshot'
                ? "The screenshot shows the digits, but not which rules the puzzle uses."
                : "The text has the digits, but doesn't say which rules the puzzle uses."}{' '}
              Tick every rule it has, or leave them all off for a Classic Sudoku.
            </p>
          )}
          <div className="variant-import-options">
            {options.map((option) => (
              <label key={option.key} className={option.checked ? 'variant-import-option variant-import-option-on' : 'variant-import-option'}>
                <input type="checkbox" checked={option.checked} onChange={(event) => option.toggle(event.target.checked)} />
                <span>
                  <b>{option.name}</b>
                  <span className="variant-import-rule">{option.rule}</span>
                  {option.note && <span className="variant-import-note">{option.note}</span>}
                </span>
              </label>
            ))}
          </div>
          <p className="confirm-tip">
            Importing as: <b>{chosenName}</b>
            {source === 'screenshot' ? '. You can still correct the digits before locking them as givens.' : ''}
          </p>
        </div>
        <div className="confirm-actions">
          <button type="button" onClick={onCancel}>
            Cancel import
          </button>
          <button type="button" className="confirm-accept variant-import-accept" ref={confirmButtonRef} onClick={confirm}>
            Import as {chosenName}
          </button>
        </div>
      </div>
    </div>
  )
}
