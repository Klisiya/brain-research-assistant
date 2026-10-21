import { useCallback, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { hubLabels, hubManagePath, hubMutation, hubPath, hubRequest, type HubEntry, type HubFields, type HubList, type HubRevision } from '../../api/hub'
import type { AuthUser } from '../../types/auth'
import { useManagementRead } from '../management/useManagementRead'
import { makeManagementOrigin, managementReturn, withManagementOrigin, listPage } from '../management/managementOrigin'
import { useManagementOrigin, useManagementListPosition } from '../management/useManagementOrigin'
import { useSearchReturn } from '../search/useSearchReturn'
import { useUnsavedChanges, useEditorMounted } from '../management/useUnsavedChanges'
import ConfirmDialog from '../papers/ConfirmDialog'
import './FacultyWorkspace.css'

function RevisionView({ revision }: { revision: HubRevision }) {
  return <div className="faculty-content">
    <h2>{revision.title}</h2>
    {revision.body && <p className="faculty-body">{revision.body}</p>}
    {(revision.sourceName || revision.sourceUrl) && <p>Source: {revision.sourceName}{revision.sourceUrl && <> <a href={revision.sourceUrl} target="_blank" rel="noopener noreferrer">Open source ↗</a></>}</p>}
    {revision.attachments.length > 0 && <section aria-label="Attachments"><h3>Attachments</h3><ul className="faculty-attachments">{revision.attachments.map(item => <li key={item.id}>
      <span>{item.displayName}{item.attachmentType !== 'external_link' && <small>Download available · In-page preview unavailable</small>}</span>
      {item.externalUrl ? <a href={item.externalUrl} target="_blank" rel="noopener noreferrer">Open link ↗</a> : item.downloadUrl && <a href={item.downloadUrl} target="_blank" rel="noopener noreferrer">Download</a>}
    </li>)}</ul></section>}
  </div>
}

function Fields({ values, setValues, disabled }: { values: HubFields; setValues: (values: HubFields) => void; disabled: boolean }) {
  return <fieldset disabled={disabled} className="faculty-fields"><legend>Resource details</legend>
    <label>Title<input required maxLength={200} value={values.title} onChange={e => setValues({ ...values, title: e.target.value })} /></label>
    <label>Short description<textarea maxLength={10000} rows={6} value={values.body} onChange={e => setValues({ ...values, body: e.target.value })} /></label>
    <label>Source name (optional)<input maxLength={300} value={values.sourceName} onChange={e => setValues({ ...values, sourceName: e.target.value })} /></label>
    <label>Source URL (optional)<input type="url" maxLength={1500} value={values.sourceUrl} onChange={e => setValues({ ...values, sourceUrl: e.target.value })} /></label>
  </fieldset>
}
const fields = (revision?: HubRevision | null): HubFields => ({ title: revision?.title ?? '', body: revision?.body ?? '', sourceName: revision?.sourceName ?? '', sourceUrl: revision?.sourceUrl ?? '' })

function NewResource({ user }: { user: AuthUser }) {
  const origin = useManagementOrigin(user, ['faculty']), back = origin ? managementReturn(origin) : { path: '/manage/hub', label: 'Faculty Resources' }
  const navigate = useNavigate(), controller = useRef<AbortController | null>(null)
  const [values, setValues] = useState(fields()), [busy, setBusy] = useState(false), [error, setError] = useState('')
  useUnsavedChanges(JSON.stringify(values) !== JSON.stringify(fields()), busy)
  const isMounted = useEditorMounted()
  async function create(event: FormEvent) {
    event.preventDefault(); if (controller.current) return; setBusy(true); setError('')
    const request = new AbortController(); controller.current = request
    try {
      const result = await hubMutation('/api/hub/entries', 'POST', values, request.signal)
      if (isMounted() && !request.signal.aborted) navigate(withManagementOrigin(hubManagePath(result.entry.id), origin), { replace: true })
    } catch (reason) { if (isMounted() && !request.signal.aborted) setError(reason instanceof Error ? reason.message : 'Unable to save.') }
    finally { controller.current = null; if (isMounted() && !request.signal.aborted) setBusy(false) }
  }
  return <section className="faculty-workspace"><Link className="management-return" to={back.path}>← {back.label}</Link><h1>Create Faculty Resource</h1><p>Save a draft, add materials, and submit it for administrator review.</p>
    {error && <p role="alert">{error}</p>}<form onSubmit={event => void create(event)}><Fields values={values} setValues={setValues} disabled={busy} /><button className="faculty-primary" disabled={busy} type="submit">{busy ? 'Saving…' : 'Save Draft'}</button></form>
  </section>
}

type Action = 'submit' | 'withdraw' | 'approve' | 'reject' | 'archive' | 'draft' | 'discard-revision'
function ResourceEditor({ initial, user, refresh }: { initial: HubEntry; user: AuthUser; refresh: () => void }) {
  const origin = useManagementOrigin(user, ['faculty']), back = origin ? managementReturn(origin) : { path: '/manage/hub', label: 'Faculty Resources' }
  const [entry, setEntry] = useState(initial), [values, setValues] = useState(fields(initial.working))
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [confirm, setConfirm] = useState<Action | 'delete' | null>(null), [reason, setReason] = useState('')
  const [attachmentName, setAttachmentName] = useState(''), [attachmentType, setAttachmentType] = useState('pdf'), [url, setUrl] = useState('')
  const file = useRef<HTMLInputElement>(null), controller = useRef<AbortController | null>(null)
  const isMounted = useEditorMounted(), navigate = useNavigate()
  const revision = entry.working, draft = revision?.state === 'draft' && entry.status !== 'archived'
  const canDeleteDraft = !entry.published && Boolean(revision && ['draft','rejected'].includes(revision.state ?? ''))
  const canDiscard = entry.published && entry.status !== 'archived' && revision && ['draft','rejected'].includes(revision.state ?? '')
  const dirty = JSON.stringify(values) !== JSON.stringify(fields(revision))
  const [fileSelected, setFileSelected] = useState(false)
  const requestExit = useUnsavedChanges((draft && dirty) || Boolean(reason), busy)
  const materialExit = useUnsavedChanges(Boolean(attachmentName || url || fileSelected), busy, 'hub-material')
  async function run(operation: (signal: AbortSignal) => Promise<{ entry: HubEntry }>, message: string, resetMaterials = false) {
    if (controller.current) return
    const request = new AbortController(); controller.current = request; setBusy(true); setError(''); setNotice('')
    try {
      const result = await operation(request.signal)
      if (isMounted() && !request.signal.aborted) {
        setEntry(result.entry); setValues(fields(result.entry.working)); setNotice(message); setConfirm(null)
        setReason(''); if (resetMaterials) { setAttachmentName(''); setUrl(''); setFileSelected(false); if (file.current) file.current.value = '' }
      }
    } catch (failure) { if (isMounted() && !request.signal.aborted) setError(failure instanceof Error ? failure.message : 'Unable to save.') }
    finally { controller.current = null; if (isMounted() && !request.signal.aborted) setBusy(false) }
  }
  function save(event: FormEvent) {
    event.preventDefault()
    void run(signal => hubMutation(`/api/hub/entries/${entry.id}`, 'PATCH', { ...values, expectedVersion: entry.version }, signal), 'Draft saved.')
  }
  function action(value: Action) {
    void run(signal => hubMutation(`/api/hub/entries/${entry.id}/${value}`, 'POST', { expectedVersion: entry.version, ...(value === 'discard-revision' ? { confirmation: 'DISCARD' } : {}), ...(value === 'reject' ? { reviewNote: reason } : {}) }, signal), value === 'discard-revision' ? 'Revision discarded. The published version is unchanged.' : value === 'approve' ? 'Approved and published.' : 'Resource updated.', value === 'discard-revision')
  }
  async function deleteDraft() {
    if (controller.current) return
    const request = new AbortController(); controller.current = request; setBusy(true); setError('')
    try {
      const result = await hubRequest<{deleted:boolean;cleanupPending:boolean}>(`/api/hub/entries/${entry.id}`, {method:'DELETE', signal:request.signal, headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedVersion:entry.version,confirmation:'DELETE'})})
      if (isMounted()) { if (!result.deleted) throw new Error('Deletion could not be confirmed. Refresh before retrying.'); navigate(back.path, {replace:true}) }
    } catch (failure) { if (isMounted()) setError(failure instanceof Error ? failure.message : 'Unable to delete draft.') }
    finally { controller.current = null; if (isMounted()) setBusy(false) }
  }
  function upload(event: FormEvent) {
    event.preventDefault()
    if (attachmentType === 'external_link') {
      void run(signal => hubMutation(`/api/hub/entries/${entry.id}/attachments`, 'POST', { expectedVersion: entry.version, displayName: attachmentName, externalUrl: url }, signal), 'Link added.', true)
    } else if (file.current?.files?.[0]) {
      const form = new FormData()
      form.set('expectedVersion', String(entry.version)); form.set('displayName', attachmentName); form.set('attachmentType', attachmentType); form.set('file', file.current.files[0])
      void run(signal => hubRequest(`/api/hub/entries/${entry.id}/attachments`, { method: 'POST', body: form, signal }), 'Attachment added.', true)
    }
  }
  return <section className="faculty-workspace"><Link className="management-return" to={back.path}>← {back.label}</Link><h1>Manage Faculty Resource</h1>
    <p className="faculty-status">{hubLabels[entry.status]}{entry.published && revision && <> · Revision {revision.number}: {hubLabels[revision.state ?? 'draft']}</>}</p>
    {error && <div role="alert"><p>{error}</p><button disabled={busy} type="button" onClick={() => requestExit(refresh)}>Refresh resource</button><p>Refresh loads the saved version and clears unsaved changes.</p></div>}
    {notice && <p role="status">{notice}</p>}
    {revision?.reviewNote && <p>Review feedback: {revision.reviewNote}</p>}
    {draft ? <><form onSubmit={save}><Fields values={values} setValues={setValues} disabled={busy} /><button type="submit" disabled={busy} className="faculty-primary">Save Draft</button></form>
      {dirty && <p>Save changes before adding materials or submitting for review.</p>}
      <form onSubmit={upload} className="faculty-upload"><fieldset disabled={busy || dirty}><legend>Add material</legend>
        <label>Material name<input required maxLength={300} value={attachmentName} onChange={e => setAttachmentName(e.target.value)} /></label>
        <label>Material type<select value={attachmentType} onChange={e => {const next = e.target.value; const change = () => { setAttachmentType(next); setUrl(''); setFileSelected(false); if (file.current) file.current.value = '' }; if (url || fileSelected) materialExit(change, 'hub-material'); else change()}}><option value="pdf">PDF</option><option value="slides">PPT / PPTX</option><option value="document">Word (DOC / DOCX)</option><option value="cover">Image (PNG / JPEG / WebP)</option><option value="external_link">External link</option></select></label>
        {attachmentType === 'external_link' ? <label>Link URL<input key="material-url" required type="url" maxLength={1500} value={url} onChange={e => setUrl(e.target.value)} /></label>
          : <label>File<input key="material-file" required type="file" ref={file} onChange={event => setFileSelected(Boolean(event.target.files?.length))} accept={{ pdf: '.pdf', slides: '.ppt,.pptx', document: '.doc,.docx', cover: '.png,.jpg,.jpeg,.webp' }[attachmentType]} /></label>}
        <p>PDF/PPT: up to 50 MB; Word: 30 MB; images: 8 MB. No video, encrypted files, or macros. In-page preview is unavailable.</p>
        <button type="submit">Add material</button>
      </fieldset></form></> : revision && <RevisionView revision={revision} />}
    {draft && revision && revision.attachments.length > 0 && <ul className="faculty-attachments" aria-label="Draft materials">{revision.attachments.map(item => <li key={item.id}><span>{item.displayName}</span><button disabled={busy || dirty} type="button" onClick={() => void run(signal => hubMutation(`/api/hub/entries/${entry.id}/attachments/${item.id}`, 'DELETE', { expectedVersion: entry.version }, signal), 'Attachment removed from draft.')} aria-label={`Remove ${item.displayName}`}>Remove</button></li>)}</ul>}
    <div className="faculty-actions">
      {draft && <button type="button" disabled={busy || dirty} onClick={() => materialExit(() => { setAttachmentName(''); setUrl(''); setFileSelected(false); if (file.current) file.current.value = ''; setConfirm('submit') }, 'hub-material')} className="faculty-primary">Submit for Review</button>}
      {revision?.state === 'pending' && entry.status !== 'archived' && <><button type="button" disabled={busy} onClick={() => setConfirm('withdraw')}>Withdraw to Draft</button>{user.role === 'admin' && <><button type="button" disabled={busy} onClick={() => setConfirm('approve')}>Approve & Publish</button><label>Rejection reason<textarea maxLength={2000} value={reason} disabled={busy} onChange={e => setReason(e.target.value)} /></label><button type="button" disabled={busy || !reason.trim()} onClick={() => setConfirm('reject')}>Reject</button></>}</>}
      {entry.status !== 'archived' && (revision?.state === 'rejected' || !revision && entry.published) && <button type="button" disabled={busy} onClick={() => action('draft')}>{revision?.state === 'rejected' ? 'Revise rejected resource' : 'Create editing draft'}</button>}
      {user.role === 'admin' && entry.status !== 'archived' && <button type="button" disabled={busy || dirty} onClick={() => materialExit(() => { setAttachmentName(''); setUrl(''); setFileSelected(false); if (file.current) file.current.value = ''; setConfirm('archive') }, 'hub-material')}>Archive resource</button>}
      {entry.published && entry.status !== 'archived' && <Link to={withManagementOrigin(hubPath(entry.id), origin)}>View published resource →</Link>}
    </div>
    {entry.published && <section><h2>Published version</h2>{revision && <p>The published version remains visible while changes are reviewed.</p>}<RevisionView revision={entry.published} /></section>}
    {(canDeleteDraft || canDiscard || revision?.state === 'pending') && <section className="faculty-danger"><h2>Danger zone</h2><p>{canDiscard ? 'Discard the working revision while keeping the current published version.' : revision?.state === 'pending' ? 'Withdraw the pending revision to Draft before removing it.' : 'Permanently remove this saved, never-published draft.'}</p><div className="faculty-actions">
      {canDeleteDraft && <button type="button" disabled={busy} onClick={()=>{setError('');setConfirm('delete')}}>Delete draft</button>}
      {canDiscard && <button type="button" disabled={busy} onClick={()=>{setError('');setConfirm('discard-revision')}}>Discard revision</button>}
    </div></section>}
    <History id={entry.id} version={entry.version} />
    {confirm === 'delete' ? <ConfirmDialog title="Delete this draft?" description="This permanently removes the saved draft. This action cannot be undone. Any unsaved local changes will also be discarded." confirmLabel="Delete draft" tone="danger" busy={busy} error={error} onCancel={()=>setConfirm(null)} onConfirm={()=>void deleteDraft()} /> : confirm === 'discard-revision' ? <ConfirmDialog title="Discard this revision?" description="The current published version will remain available. Only this draft revision will be removed. Any unsaved local changes will also be discarded." cancelLabel="Keep revision" confirmLabel="Discard revision" tone="danger" busy={busy} error={error} onCancel={()=>setConfirm(null)} onConfirm={()=>action('discard-revision')} /> : confirm && <ConfirmDialog title={`${confirm === 'approve' ? 'Approve and publish' : confirm[0].toUpperCase()+confirm.slice(1)} resource?`} confirmLabel={confirm === 'approve' ? 'Approve & Publish' : 'Confirm'} description={confirm === 'archive' ? 'The resource will no longer be visible to learners or in search. Review history is retained.' : 'This action applies to the saved revision.'} confirmationText={confirm === 'archive' ? 'ARCHIVE' : undefined} tone={confirm === 'archive' ? 'danger' : 'neutral'} busy={busy} error={error} onCancel={() => setConfirm(null)} onConfirm={() => action(confirm)} />}
  </section>
}

function History({ id, version }: { id: number; version?: number }) {
  const reader = useCallback((signal: AbortSignal) => hubRequest<{ events: { id: number; action: string; createdAt: string; actorId: number }[] }>(`/api/hub/entries/${id}/history`, { signal }), [id])
  const state = useManagementRead(`${id}:${version}:history`, reader)
  return <details className="faculty-history"><summary>Review history</summary>{state.loading ? <p role="status">Loading history…</p> : state.error ? <p role="alert">History unavailable. <button onClick={state.retry}>Retry</button></p> : <ul>{state.data?.events.map(event => <li key={event.id}>{event.action.replaceAll('_', ' ')} · Account {event.actorId} · <time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleString()}</time></li>)}</ul>}</details>
}

export default function FacultyWorkspace({ user, managed = false, create = false }: { user: AuthUser; managed?: boolean; create?: boolean }) {
  const { entryId } = useParams(), [query] = useSearchParams()
  const scope = managed ? user.role === 'admin' && query.get('scope') === 'review' ? 'review' : 'mine' : 'published'
  const page = String(listPage(query.get('page')))
  const origin = useManagementOrigin(user, ['faculty'])
  const searchBack = useSearchReturn(Boolean(entryId) && !managed && !create && !origin)
  const back = origin ? managementReturn(origin) : searchBack ?? { path: managed ? '/manage/hub' : '/innovation-hub?view=faculty', label: 'Faculty Resources' }
  const source = new URLSearchParams({ scope, page })
  const path = entryId ? `/api/hub/entries/${encodeURIComponent(entryId)}${managed ? '/manage' : ''}` : `/api/hub/entries?${new URLSearchParams({ scope, page })}`
  const reader = useCallback((signal: AbortSignal) => create ? Promise.resolve(null) : hubRequest<HubList | { entry: HubEntry }>(path, { signal }), [path, create])
  const state = useManagementRead(`${user.id}:${user.role}:${path}`, reader)
  useManagementListPosition(state.data && 'entries' in state.data ? state.data : null, !entryId && !create)
  if (create) return <NewResource user={user} />
  if (state.loading) return <p role="status" className="faculty-workspace">Loading Faculty Resources…</p>
  if (state.error) return <section className="faculty-workspace" role="alert"><h2>{state.error === 'not-found' ? 'Resource not available' : state.error === 'forbidden' ? 'Access denied' : 'Faculty Resources unavailable'}</h2><p>{state.error === 'not-found' ? 'This resource may be unpublished, archived, or unavailable to your account.' : 'We could not load this workspace.'}</p><button type="button" onClick={state.retry}>Retry</button><Link className="management-return" to={back.path}>{origin || searchBack ? back.label : 'Back to Faculty Resources'}</Link></section>
  const data = state.data
  if (!data) return null
  if ('entry' in data) {
    if (managed) return <ResourceEditor key={`${data.entry.id}:${data.entry.version}`} initial={data.entry} user={user} refresh={state.retry} />
    return <article className="faculty-workspace"><Link className="management-return" to={back.path}>← {back.label}</Link><h1>{data.entry.published?.title}</h1>{data.entry.published && <RevisionView revision={data.entry.published} />}</article>
  }
  return <section className="faculty-workspace"><div className="faculty-list-header">{managed ? <h1>Faculty Resources</h1> : <h2>Faculty Resources</h2>}<div className="faculty-actions">{managed ? <><Link className="faculty-primary" to={withManagementOrigin('/manage/hub/new', makeManagementOrigin(user, 'faculty', source))}>Create resource</Link><Link to="/manage/hub">My resources</Link>{user.role === 'admin' && <Link to="/manage/hub?scope=review">All resources / Review</Link>}<Link to="/innovation-hub?view=faculty">Published resources</Link></> : user.role !== 'student' && <Link to="/manage/hub">Manage Faculty Resources →</Link>}</div></div>
    {!data.entries.length ? <p>{managed ? 'No resources in this view.' : 'No faculty resources have been published yet.'}</p> : <ul className="faculty-list">{data.entries.map(entry => {
      const revision = managed ? entry.working ?? entry.published : entry.published
      const destination = withManagementOrigin(managed ? hubManagePath(entry.id) : hubPath(entry.id), makeManagementOrigin(user, 'faculty', source, entry.id))
      return <li key={entry.id} tabIndex={-1} data-management-row={`faculty-${entry.id}`}><div><p className="faculty-status">{hubLabels[entry.status]}{managed && entry.published && entry.working && ` · Changes: ${hubLabels[entry.working.state ?? 'draft']}`}</p><h3><Link to={destination}>{revision?.title}</Link></h3></div><Link to={destination}>{managed ? 'Manage →' : 'Open →'}</Link></li>
    })}</ul>}
    {data.totalPages > 1 && <nav aria-label="Faculty pagination" className="faculty-actions">{data.page > 1 && <Link to={`?${new URLSearchParams({ ...(managed ? { scope } : { view: 'faculty' }), page: String(data.page-1) })}`}>Previous page</Link>}<span>Page {data.page} of {data.totalPages}</span>{data.page < data.totalPages && <Link to={`?${new URLSearchParams({ ...(managed ? { scope } : { view: 'faculty' }), page: String(data.page+1) })}`}>Next page</Link>}</nav>}
  </section>
}
