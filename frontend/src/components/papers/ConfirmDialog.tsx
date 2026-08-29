import { useEffect, useId, useState } from 'react'

type ConfirmDialogProps = {
  busy?: boolean
  confirmLabel: string
  confirmationText?: string
  description: string
  onCancel: () => void
  onConfirm: () => void
  title: string
  tone?: 'danger' | 'neutral'
}

function ConfirmDialog({
  busy = false,
  confirmLabel,
  confirmationText,
  description,
  onCancel,
  onConfirm,
  title,
  tone = 'neutral',
}: ConfirmDialogProps) {
  const titleId = useId()
  const descriptionId = useId()
  const [confirmation, setConfirmation] = useState('')
  const canConfirm = !confirmationText || confirmation === confirmationText

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onCancel()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [busy, onCancel])

  return (
    <div className="confirm-dialog-backdrop">
      <section
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        className="confirm-dialog"
        role="dialog"
      >
        <span>Confirmation Required</span>
        <h2 id={titleId}>{title}</h2>
        <p id={descriptionId}>{description}</p>

        {confirmationText ? (
          <label className="confirm-dialog-input">
            <span>Type {confirmationText} to continue</span>
            <input
              autoComplete="off"
              autoFocus
              disabled={busy}
              onChange={(event) => setConfirmation(event.target.value)}
              value={confirmation}
            />
          </label>
        ) : null}

        <div className="confirm-dialog-actions">
          <button disabled={busy} onClick={onCancel} type="button">Cancel</button>
          <button
            className={tone === 'danger' ? 'is-danger' : 'is-primary'}
            disabled={busy || !canConfirm}
            onClick={onConfirm}
            type="button"
          >
            {busy ? 'Working...' : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  )
}

export default ConfirmDialog
