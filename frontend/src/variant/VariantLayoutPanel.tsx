import type { SudokuConstraints } from '../sudoku/SudokuConstraints'
import { REGION_TINTS, STANDARD_REGIONS, blankRegionDraft, regionSizes, variantName } from '../sudoku/VariantPuzzle'

/** The layout editor's state (App owns it; the grid reads it too, since a
 * click on a cell means something else while it is open).
 *  - 'cages': cells are picked one by one ("row,col" keys), then turned into
 *    a cage with the typed sum.
 *  - 'regions': a draft of the nine regions (NO_REGION for a cell not drawn
 *    yet), drawn by dragging across the grid with a region chosen (App's
 *    pointer handlers, drawRegionCell); it only becomes the puzzle's layout
 *    once every region has nine cells. */
export type LayoutEditor =
  | { mode: 'cages'; selection: string[]; sum: string }
  | { mode: 'regions'; draft: number[][]; region: number }

interface VariantLayoutPanelProps {
  constraints: SudokuConstraints
  editor: LayoutEditor | null
  busy: boolean
  /** A hardware keyboard is there: the region buttons mention their 1-9 keys. */
  hasKeyboard: boolean
  onEditorChange: (editor: LayoutEditor | null) => void
  onAddCage: () => void
  onRemoveCages: () => void
  onClearCages: () => void
  onApplyRegions: () => void
  onStandardRegions: () => void
}

/**
 * The "Puzzle layout" group of the Variant solver's controls: what kind of
 * puzzle is on the grid, and the editor for entering one by hand - a
 * Killer's cages and a Jigsaw's regions are the puzzle, the way the givens
 * are on a Classic grid. Built from the same control-group pieces as the
 * Solution / Candidates groups beside it.
 */
export function VariantLayoutPanel({
  constraints,
  editor,
  busy,
  hasKeyboard,
  onEditorChange,
  onAddCage,
  onRemoveCages,
  onClearCages,
  onApplyRegions,
  onStandardRegions,
}: VariantLayoutPanelProps) {
  const cageCount = constraints.cages.length
  const cagedCells = constraints.cages.reduce((total, cage) => total + cage.cells.length, 0)
  const summary = [
    constraints.regions ? 'Irregular regions' : '3x3 boxes',
    cageCount === 0 ? 'no cages' : `${cageCount} cage${cageCount === 1 ? '' : 's'} over ${cagedCells} of 81 cells`,
  ].join(', ')

  let body
  if (editor?.mode === 'cages') {
    const picked = editor.selection.length
    body = (
      <>
        <p className="paint-hint">Click the cells of a cage on the grid, type what they add up to, then add it. A new cage replaces any cage it overlaps.</p>
        <div className="variant-editor-row">
          <label className="variant-sum-field">
            Sum
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={45}
              value={editor.sum}
              onChange={(event) => onEditorChange({ ...editor, sum: event.target.value })}
              onKeyDown={(event) => {
                // Enter adds the cage; the digits typed here must not reach the grid.
                event.stopPropagation()
                if (event.key === 'Enter') {
                  onAddCage()
                }
              }}
            />
          </label>
          <button type="button" className="bulk-action-button" disabled={picked === 0 || editor.sum.trim() === ''} onClick={onAddCage}>
            Add cage ({picked} cell{picked === 1 ? '' : 's'})
          </button>
        </div>
        <div className="candidate-bulk-actions variant-actions-three">
          <button
            type="button"
            className="bulk-action-button"
            disabled={picked === 0}
            onClick={onRemoveCages}
            title="Remove every cage that holds one of the picked cells"
          >
            Remove cage
          </button>
          <button type="button" className="bulk-action-button" disabled={cageCount === 0} onClick={onClearCages} title="Remove every cage from the grid">
            Clear all cages
          </button>
          <button type="button" className="bulk-action-button variant-editor-done" onClick={() => onEditorChange(null)}>
            Done
          </button>
        </div>
      </>
    )
  } else if (editor?.mode === 'regions') {
    const sizes = regionSizes(editor.draft)
    const complete = sizes.every((size) => size === 9)
    const drawn = sizes.reduce((total, size) => total + size, 0)
    body = (
      <>
        <p className="paint-hint">
          {complete ? (
            <>All nine regions are drawn. Click <b>Use regions</b>, then enter the digits.</>
          ) : (
            <>
              <b>Drag across the grid</b> to draw region {editor.region + 1} ({sizes[editor.region]} of 9 cells). At nine cells it moves on to
              the next region by itself. Drag from a cell already in the region to rub it out.
            </>
          )}
        </p>
        <div className="variant-region-buttons" role="group" aria-label="Region to draw">
          {sizes.map((size, region) => (
            <button
              key={region}
              type="button"
              className={['variant-region-button', editor.region === region ? 'active' : '', size === 9 ? 'full' : ''].filter(Boolean).join(' ')}
              style={{ backgroundColor: REGION_TINTS[region] }}
              aria-pressed={editor.region === region}
              title={`Region ${region + 1}: ${size} of 9 cells${hasKeyboard ? ` (press ${region + 1})` : ''}`}
              onClick={() => onEditorChange({ ...editor, region })}
            >
              {region + 1}
              <span className="variant-region-size">{size === 9 ? '✓' : `${size}/9`}</span>
            </button>
          ))}
        </div>
        <div className="candidate-bulk-actions variant-actions-three">
          <button
            type="button"
            className="bulk-action-button"
            disabled={drawn === 0}
            title="Rub out every region and start again"
            onClick={() => onEditorChange({ ...editor, draft: blankRegionDraft(), region: 0 })}
          >
            Start blank
          </button>
          <button
            type="button"
            className="bulk-action-button"
            title="Fill in the standard 3x3 boxes, to reshape them"
            onClick={() => onEditorChange({ ...editor, draft: STANDARD_REGIONS.map((row) => [...row]) })}
          >
            3x3 boxes
          </button>
          <button type="button" className="bulk-action-button" onClick={() => onEditorChange(null)}>
            Cancel
          </button>
        </div>
        <button
          type="button"
          className="bulk-action-button variant-editor-done variant-use-regions"
          disabled={!complete}
          title={complete ? 'Use these regions' : 'Every region needs exactly 9 cells first'}
          onClick={onApplyRegions}
        >
          {complete ? 'Use regions' : `Use regions (${81 - drawn} cell${81 - drawn === 1 ? '' : 's'} left to draw)`}
        </button>
      </>
    )
  } else {
    body = (
      <>
        <p className="paint-hint">{summary}.</p>
        <div className="candidate-bulk-actions">
          <button
            type="button"
            className="bulk-action-button"
            disabled={busy}
            onClick={() => onEditorChange({ mode: 'cages', selection: [], sum: '' })}
            title="Add or remove Killer cages"
          >
            Edit cages
          </button>
          <button
            type="button"
            className="bulk-action-button"
            disabled={busy}
            onClick={() =>
              onEditorChange({ mode: 'regions', draft: (constraints.regions ?? STANDARD_REGIONS).map((row) => [...row]), region: 0 })
            }
            title="Draw a Jigsaw's irregular regions by dragging across the grid"
          >
            Draw regions
          </button>
        </div>
        {constraints.regions && (
          <div className="candidate-bulk-actions">
            <button type="button" className="bulk-action-button" disabled={busy} onClick={onStandardRegions} title="Put the regions back to the standard 3x3 boxes">
              Back to 3x3 boxes
            </button>
          </div>
        )}
      </>
    )
  }

  return (
    <section className={['control-group', 'variant-group', editor ? 'variant-group-editing' : ''].filter(Boolean).join(' ')}>
      <div className="control-header">
        <h2 className="control-label">Puzzle layout</h2>
        <span className="variant-kind-chip">{variantName(constraints)}</span>
      </div>
      {body}
    </section>
  )
}
