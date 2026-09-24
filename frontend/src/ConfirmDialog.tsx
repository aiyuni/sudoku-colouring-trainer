import { useEffect, useId, useRef, type ReactNode } from 'react'

interface ConfirmDialogProps {
  title: string
  children: ReactNode
  confirmLabel: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
}

/** The app's own replacement for `window.confirm`, which renders as a plain
 * browser box ("localhost says…") that doesn't match the rest of the UI.
 * Centred over a dimmed backdrop, same look as the Settings guide. Cancel is
 * focused first, so a stray Enter never opts into the risky choice; Escape
 * or a click on the backdrop also cancel. */
export default function ConfirmDialog({
  title,
  children,
  confirmLabel,
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId()
  const cancelButtonRef = useRef<HTMLButtonElement>(null)
  // Read through a ref so the setup effect runs once, on open, rather than
  // re-grabbing focus whenever the parent passes a new function identity.
  const onCancelRef = useRef(onCancel)
  useEffect(() => {
    onCancelRef.current = onCancel
  }, [onCancel])

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    cancelButtonRef.current?.focus()

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

  return (
    <div
      className="confirm-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onCancel()
        }
      }}
    >
      <div className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="confirm-header">
          <span className="confirm-icon" aria-hidden="true">
            !
          </span>
          <h2 id={titleId}>{title}</h2>
        </div>
        <div className="confirm-body">{children}</div>
        <div className="confirm-actions">
          <button type="button" ref={cancelButtonRef} onClick={onCancel}>
            {cancelLabel}
          </button>
          <button type="button" className="confirm-accept" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
