import { useEffect, useRef, useState } from 'react'
import { createPaperAttachmentLink, deletePaperAttachment, fetchManagedAttachments, replacePaperAttachment, uploadPaperAttachment } from '../../api/papers'
import type { AttachmentFileInput, AttachmentFileType, AttachmentLinkInput, ManagedPaperAttachment } from '../../types/paper'
import AttachmentForm from './AttachmentForm'
import ResourceConfirmDialog from './ResourceConfirmDialog'
import { ACCESS_LABELS, ATTACHMENT_LABELS, attachmentError, formatFileSize } from './attachmentPresentation'
import './PaperResources.css'
type FormMode = { kind: 'upload' | 'link' | 'replace'; existing?: ManagedPaperAttachment }
type Result = { key: string; items: ManagedPaperAttachment[] | null; error: string | null }
export default function AttachmentManager({ paperId }: { paperId: number }) {
  const [version, setVersion] = useState(0), [result, setResult] = useState<Result | null>(null)
  const [mode, setMode] = useState<FormMode | null>(null)
  const [replacement, setReplacement] = useState<AttachmentFileInput | AttachmentLinkInput | null>(null)
  const [removing, setRemoving] = useState<ManagedPaperAttachment | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null)
  const mutation = useRef(false), formRegion = useRef<HTMLDivElement>(null)
  const requestKey = `${paperId}:${version}`
  const current = result?.key === requestKey ? result : null
  useEffect(() => {
    const controller = new AbortController()
    fetchManagedAttachments(paperId, { signal: controller.signal }).then(items => {
      if (!controller.signal.aborted) setResult({ key: requestKey, items, error: null })
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setResult({ key: requestKey, items: null, error: attachmentError(error) })
    })
    return () => controller.abort()
  }, [paperId, requestKey])
  useEffect(() => { if (mode) formRegion.current?.focus() }, [mode])
  const items = current?.items ?? []
  const primaryTypes = items.filter(item => item.attachmentType === 'pdf' || item.attachmentType === 'cover').map(item => item.attachmentType as AttachmentFileType)
  const runMutation = async (operation: () => Promise<{ cleanupPending: boolean }>, message: string) => {
    if (mutation.current) return
    mutation.current = true; setBusy(true); setError(null); setNotice(null)
    try {
      await operation()
      setNotice(message)
      setMode(null); setReplacement(null); setRemoving(null); setVersion(value => value + 1)
    } catch (error: unknown) { setError(attachmentError(error)) }
    finally { mutation.current = false; setBusy(false) }
  }
  const submit = (input: AttachmentFileInput | AttachmentLinkInput) => {
    setError(null)
    if (mode?.existing) { setReplacement(input); return }
    void runMutation(() => input.attachmentType === 'external_link' ? createPaperAttachmentLink(paperId, input) : uploadPaperAttachment(paperId, input), 'Resource added.')
  }
  const openForm = (next: FormMode) => { setMode(next); setError(null); setNotice(null) }
  return <section className="paper-resources attachment-manager" aria-labelledby="attachment-manager-heading" aria-busy={busy}>
    <div className="resource-section-heading">
      <div><span>Paper Resources</span><h2 id="attachment-manager-heading" tabIndex={-1}>Resources / Attachments</h2><p>Manage files and links for this paper.</p></div>
      <div className="resource-actions">
        <button disabled={busy || !current?.items} onClick={() => openForm({ kind: 'upload' })} type="button">Upload File</button>
        <button disabled={busy || !current?.items} onClick={() => openForm({ kind: 'link' })} type="button">Add External Link</button>
      </div>
    </div>
    {notice ? <p className="resource-notice" role="status">{notice}</p> : null}
    {error && !replacement && !removing ? <p className="resource-error" role="alert">{error}</p> : null}
    {!current ? <p role="status">Loading resources...</p> : current.error ? <div role="alert"><p>{current.error}</p><button type="button" onClick={() => setVersion(value => value + 1)}>Retry Resources</button></div> : null}
    {mode ? <div ref={formRegion} tabIndex={-1} className="resource-form-region">
      <AttachmentForm key={mode.existing ? `replace:${mode.existing.id}` : mode.kind} existing={mode.existing} link={mode.kind === 'link' || mode.existing?.attachmentType === 'external_link'} busy={busy} primaryTypes={primaryTypes} onSubmit={submit} onCancel={() => { setMode(null); setError(null) }} />
    </div> : null}
    {current?.items ? items.length ? <ul className="resource-list">
      {items.map(item => <li className="resource-card" key={item.id}>
        <div className="resource-card-copy"><div className="resource-badges"><span>{ATTACHMENT_LABELS[item.attachmentType]}</span><span>{ACCESS_LABELS[item.accessLevel]}</span><span>Version {item.version}</span>{item.fileSize !== null ? <span>{formatFileSize(item.fileSize)}</span> : null}</div>
          <h3>{item.displayName}</h3>{item.description ? <p>{item.description}</p> : null}
          {item.originalFilename ? <p className="resource-filename">{item.originalFilename}</p> : null}
          {item.externalUrl ? <p className="resource-url">{item.externalUrl}</p> : null}
        </div>
        <div className="resource-actions">
          <button aria-label={`Replace ${item.displayName}`} disabled={busy} type="button" onClick={() => openForm({ kind: 'replace', existing: item })}>{item.attachmentType === 'external_link' ? 'Edit / Replace Link' : 'Replace File / Metadata'}</button>
          <button aria-label={`Delete ${item.displayName}`} className="is-danger" disabled={busy} type="button" onClick={() => { setRemoving(item); setError(null) }}>Delete</button>
        </div>
      </li>)}
    </ul> : <p className="resource-empty">No resources yet. Upload a file or add an external link.</p> : null}
    {replacement && mode?.existing ? <ResourceConfirmDialog busy={busy} error={error} title="Replace this resource?" description={`Update ${mode.existing.displayName} from version ${mode.existing.version} to version ${mode.existing.version + 1}? Other papers using the previous resource are unaffected.`} confirmLabel="Replace Resource" onCancel={() => { setReplacement(null); setError(null) }} onConfirm={() => {
      if (mode.existing) void runMutation(() => replacePaperAttachment(paperId, mode.existing!.id, replacement), 'Resource replaced.')
    }} /> : null}
    {removing ? <ResourceConfirmDialog busy={busy} error={error} title="Remove this resource from this paper?" description={`Remove ${removing.displayName} from this paper? Shared underlying assets may remain referenced elsewhere.`} confirmLabel="Remove Resource" onCancel={() => { setRemoving(null); setError(null) }} onConfirm={() => void runMutation(() => deletePaperAttachment(paperId, removing.id), 'Resource removed from this paper.')} /> : null}
  </section>
}
