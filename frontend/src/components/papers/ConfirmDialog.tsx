import { useEffect, useId, useRef, useState } from 'react'

type ConfirmDialogProps = {
  busy?: boolean
  confirmLabel: string
  confirmationText?: string
  description: string
  error?: string | null
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
  error,
  onCancel,
  onConfirm,
  title,
  tone = 'neutral',
}: ConfirmDialogProps) {
  const titleId = useId()
  const descriptionId = useId()
  const [confirmation, setConfirmation] = useState('')
  const dialog = useRef<HTMLDialogElement>(null)
  const canConfirm = !confirmationText || confirmation === confirmationText

  useEffect(() => {
    const previous = document.activeElement
    const element = dialog.current
    element?.showModal()
    return () => {
      element?.close()
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus()
    }
  }, [])

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [])

  return (
    <div className="confirm-dialog-backdrop">
      <dialog
        ref={dialog}
        onCancel={event => { event.preventDefault(); if (!busy) onCancel() }}
        onKeyDown={event => {
          if (event.key !== 'Tab') return
          const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)'))
          const first = controls[0], last = controls[controls.length - 1]
          if (!first) { event.preventDefault(); event.currentTarget.focus() }
          else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
        }}
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        className="confirm-dialog"
        role="dialog"
      >
        <span>Confirmation Required</span>
        <h2 id={titleId}>{title}</h2>
        <p id={descriptionId}>{description}</p>
        {error ? <p className="paper-form-summary-error" role="alert">{error}</p> : null}

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
      </dialog>
    </div>
  )
}

export default ConfirmDialog
