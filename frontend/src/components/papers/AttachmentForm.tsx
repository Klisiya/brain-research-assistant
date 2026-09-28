import { useId, useRef, useState, type FormEvent } from 'react'
import type { AttachmentAccessLevel, AttachmentFileInput, AttachmentFileType, AttachmentLinkInput, ManagedPaperAttachment } from '../../types/paper'
import { ACCESS_HELP, ACCESS_LABELS, ATTACHMENT_LABELS, FILE_ACCEPT } from './attachmentPresentation'
type Input = AttachmentFileInput | AttachmentLinkInput
export default function AttachmentForm({ existing, link, busy, primaryTypes, onSubmit, onCancel }: {
  existing?: ManagedPaperAttachment; link: boolean; busy: boolean; primaryTypes: AttachmentFileType[]
  onSubmit: (input: Input) => void; onCancel: () => void
}) {
  const id = useId(), fileInput = useRef<HTMLInputElement>(null)
  const [kind, setKind] = useState<AttachmentFileType>(existing && existing.attachmentType !== 'external_link' ? existing.attachmentType : 'pdf')
  const [name, setName] = useState(existing?.displayName ?? '')
  const [description, setDescription] = useState(existing?.description ?? '')
  const [access, setAccess] = useState<AttachmentAccessLevel>(existing?.accessLevel ?? 'public')
  const [order, setOrder] = useState(String(existing?.sortOrder ?? 0))
  const [url, setUrl] = useState(existing?.externalUrl ?? '')
  const [error, setError] = useState<string | null>(null)
  const primaryExists = !existing && primaryTypes.includes(kind)
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy || (!link && primaryExists)) return
    const sortOrder = Number(order)
    if (!Number.isInteger(sortOrder) || sortOrder < -2147483648 || sortOrder > 2147483647) { setError('Sort order must be a whole number within the supported range.'); return }
    const metadata = { displayName: name.trim(), description: description.trim() || null, accessLevel: access, sortOrder }
    if (link) onSubmit({ ...metadata, attachmentType: 'external_link', externalUrl: url.trim() })
    else {
      const file = fileInput.current?.files?.[0]
      if (!file) { setError('Choose a file to continue.'); return }
      onSubmit({ ...metadata, attachmentType: kind, file })
    }
  }
  return <form className="resource-form" onSubmit={submit} aria-label={existing ? 'Replace resource' : link ? 'Add external link' : 'Upload resource'}>
    <h3>{existing ? `Update ${existing.displayName}` : link ? 'Add External Link' : 'Upload File'}</h3>
    {existing ? <p id={`${id}-replace-help`}>Replace updates the current resource to version {existing.version + 1}. {link ? 'Edit the link and its metadata below.' : 'Choose a new file of the same type to update the file and its metadata.'}</p> : null}
    <fieldset disabled={busy}>
      <div className="resource-form-grid">
        {!link ? <>
          <div className="resource-field"><label htmlFor={`${id}-type`}>Attachment Type</label>
            <select id={`${id}-type`} value={kind} disabled={Boolean(existing)} onChange={event => { setKind(event.target.value as AttachmentFileType); setError(null) }}>
              {(Object.keys(FILE_ACCEPT) as AttachmentFileType[]).map(type => <option value={type} key={type}>{ATTACHMENT_LABELS[type]}</option>)}
            </select>
          </div>
          <div className="resource-field"><label htmlFor={`${id}-file`}>File</label>
            <input key={kind} ref={fileInput} id={`${id}-file`} type="file" accept={FILE_ACCEPT[kind]} required aria-describedby={`${id}-file-help`} />
            <small id={`${id}-file-help`}>{kind === 'cover' ? 'JPG, JPEG, PNG or WEBP · up to 8 MB' : kind === 'document' ? 'DOCX · up to 30 MB' : kind === 'slides' ? 'PPTX · up to 50 MB' : 'PDF · up to 50 MB'}. Files are validated on upload.</small>
          </div>
        </> : <div className="resource-field is-wide"><label htmlFor={`${id}-url`}>External URL</label>
          <input id={`${id}-url`} type="url" maxLength={1500} required value={url} onChange={event => setUrl(event.target.value)} placeholder="https://" />
        </div>}
        <div className="resource-field"><label htmlFor={`${id}-name`}>Display Name</label>
          <input id={`${id}-name`} required maxLength={300} value={name} onChange={event => setName(event.target.value)} />
        </div>
        <div className="resource-field"><label htmlFor={`${id}-access`}>Access Level</label>
          <select id={`${id}-access`} value={access} aria-describedby={`${id}-access-help`} onChange={event => setAccess(event.target.value as AttachmentAccessLevel)}>
            {(Object.keys(ACCESS_LABELS) as AttachmentAccessLevel[]).map(level => <option value={level} key={level}>{ACCESS_LABELS[level]}</option>)}
          </select>
          <small id={`${id}-access-help`}>{ACCESS_HELP[access]}</small>
        </div>
        <div className="resource-field is-wide"><label htmlFor={`${id}-description`}>Description</label>
          <textarea id={`${id}-description`} maxLength={1000} rows={3} value={description} onChange={event => setDescription(event.target.value)} />
        </div>
        <div className="resource-field"><label htmlFor={`${id}-order`}>Sort Order</label>
          <input id={`${id}-order`} type="number" min={-2147483648} max={2147483647} step={1} required value={order} onChange={event => setOrder(event.target.value)} />
          <small>Lower numbers appear first.</small>
        </div>
      </div>
      {!link && primaryExists ? <p role="status">This paper already has a {ATTACHMENT_LABELS[kind]}. Use Replace on the existing resource below.</p> : null}
      {error ? <p className="resource-error" role="alert">{error}</p> : null}
      <div className="resource-actions">
        <button onClick={onCancel} type="button">Cancel</button>
        <button className="is-primary" disabled={!link && primaryExists} type="submit">{busy ? 'Working...' : existing ? 'Review Replacement' : link ? 'Add Link' : 'Upload Resource'}</button>
      </div>
    </fieldset>
  </form>
}
