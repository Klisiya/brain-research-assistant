import { useEffect, useId, useRef } from 'react'
export default function ResourceConfirmDialog({ title, description, confirmLabel, busy, error, onConfirm, onCancel }: {
  title: string; description: string; confirmLabel: string; busy: boolean; error: string | null
  onConfirm: () => void; onCancel: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId(), descriptionId = useId()
  useEffect(() => {
    const element = dialog.current
    const previous = document.activeElement
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    element?.showModal()
    return () => {
      element?.close()
      document.body.style.overflow = overflow
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus()
      else document.getElementById('attachment-manager-heading')?.focus()
    }
  }, [])
  useEffect(() => { if (busy) dialog.current?.focus() }, [busy])
  return <dialog ref={dialog} tabIndex={-1} className="resource-confirm-dialog" aria-labelledby={titleId} aria-describedby={descriptionId}
    onKeyDown={event => {
      if (event.key !== 'Tab') return
      const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
      const first = buttons[0], last = buttons[buttons.length - 1]
      if (!first) { event.preventDefault(); event.currentTarget.focus(); return }
      if (document.activeElement === event.currentTarget || (event.shiftKey && document.activeElement === first)) {
        event.preventDefault(); (event.shiftKey ? last : first).focus()
      } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }}
    onCancel={event => { event.preventDefault(); if (!busy) onCancel() }}>
    <h2 id={titleId}>{title}</h2>
    <p id={descriptionId}>{description}</p>
    {error ? <p role="alert" className="resource-error">{error}</p> : null}
    <div className="resource-actions">
      <button autoFocus disabled={busy} onClick={onCancel} type="button">Cancel</button>
      <button className="is-primary" disabled={busy} onClick={onConfirm} type="button">{busy ? 'Working...' : confirmLabel}</button>
    </div>
  </dialog>
}
