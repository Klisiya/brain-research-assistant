import { useCallback, useId, useRef, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { HubError, hubLabels, hubMutation, hubRequest, industryManagePath, industryPath, type HubEntry, type HubFields, type HubList, type HubRevision } from '../../api/hub'
import type { AuthUser } from '../../types/auth'
import { useManagementRead } from '../management/useManagementRead'
import { makeManagementOrigin, managementReturn, withManagementOrigin, listPage } from '../management/managementOrigin'
import { useManagementOrigin, useManagementListPosition } from '../management/useManagementOrigin'
import { useUnsavedChanges, useEditorMounted } from '../management/useUnsavedChanges'
import ConfirmDialog from '../papers/ConfirmDialog'
import './FacultyWorkspace.css'
import './IndustryWorkspace.css'

const api = '/api/hub/industry/entries'
const manage = '/manage/hub/industry'
const published = '/innovation-hub?view=industry'
type Fields = HubFields & { sourceDate: string }
type Action = 'submit' | 'withdraw' | 'approve' | 'reject' | 'archive' | 'draft' | 'discard-revision'
const fields = (revision?: HubRevision | null): Fields => ({ title: revision?.title ?? '', body: revision?.body ?? '', sourceName: revision?.sourceName ?? '', sourceUrl: revision?.sourceUrl ?? '', sourceDate: revision?.sourceDate ?? '' })

function RevisionView({ revision }: { revision: HubRevision }) {
  return <div className="faculty-content"><h3>{revision.title}</h3>
    <p className="faculty-body">{revision.body}</p>
    <p>Source: {revision.sourceName}{revision.sourceUrl && <> · <a href={revision.sourceUrl} target="_blank" rel="noopener noreferrer">Open source ↗</a></>}</p>
    {revision.sourceDate && <p>Source date: <time dateTime={revision.sourceDate}>{revision.sourceDate}</time></p>}
    {revision.attachments.length > 0 && <section aria-label="Attachments"><h4>Materials</h4><ul className="faculty-attachments">{revision.attachments.map(item => <li key={item.id}>
      <span>{item.displayName}{!item.externalUrl && <small>Download available · In-page preview unavailable</small>}</span>
      {item.externalUrl ? <a href={item.externalUrl} target="_blank" rel="noopener noreferrer">Open link ↗</a> : item.downloadUrl && <a href={item.downloadUrl} target="_blank" rel="noopener noreferrer">Download</a>}
    </li>)}</ul></section>}
  </div>
}

function UpdateFields({ values, onChange, disabled }: { values: Fields; onChange: (value: Fields) => void; disabled: boolean }) {
  const id = useId()
  return <fieldset disabled={disabled} className="faculty-fields"><legend>Industry update details</legend>
    <div className="industry-field"><label htmlFor={`${id}-title`}>Title</label><input id={`${id}-title`} required maxLength={200} value={values.title} onChange={e => onChange({ ...values, title: e.target.value })} /></div>
    <div className="industry-field"><label htmlFor={`${id}-body`}>Description</label><textarea id={`${id}-body`} required rows={6} maxLength={10000} value={values.body} onChange={e => onChange({ ...values, body: e.target.value })} /></div>
    <div className="industry-field"><label htmlFor={`${id}-source`}>Source name</label><input id={`${id}-source`} required maxLength={300} value={values.sourceName} onChange={e => onChange({ ...values, sourceName: e.target.value })} /></div>
    <div className="industry-field"><label htmlFor={`${id}-url`}>Source URL (optional)</label><input id={`${id}-url`} type="url" maxLength={1500} value={values.sourceUrl} onChange={e => onChange({ ...values, sourceUrl: e.target.value })} /></div>
    <div className="industry-field"><label htmlFor={`${id}-date`}>Source date (optional)</label><input id={`${id}-date`} type="date" value={values.sourceDate} onChange={e => onChange({ ...values, sourceDate: e.target.value })} /></div>
    <p>Enter the source date only if supplied by the source. It is separate from the platform creation date.</p>
  </fieldset>
}

function NewUpdate({ user }: { user: AuthUser }) {
  const origin = useManagementOrigin(user, ['industry']), back = origin ? managementReturn(origin) : { path: manage, label: 'Industry Updates' }
  const navigate = useNavigate(), controller = useRef<AbortController | null>(null)
  const [values, setValues] = useState(fields()), [busy, setBusy] = useState(false), [error, setError] = useState('')
  useUnsavedChanges(JSON.stringify(values) !== JSON.stringify(fields()), busy)
  const isMounted = useEditorMounted()
  async function create(event: FormEvent) {
    event.preventDefault(); if (controller.current) return
    const request = new AbortController(); controller.current = request; setBusy(true); setError('')
    try {
      const result = await hubMutation(api, 'POST', values, request.signal)
      if (isMounted() && !request.signal.aborted) navigate(withManagementOrigin(industryManagePath(result.entry.id), origin), { replace: true })
    } catch (reason) { if (isMounted() && !request.signal.aborted) setError(reason instanceof Error ? reason.message : 'Unable to save.') }
    finally { if (controller.current === request) controller.current = null; if (isMounted() && !request.signal.aborted) setBusy(false) }
  }
  return <section className="faculty-workspace industry-workspace"><Link className="management-return" to={back.path}>← {back.label}</Link><h1>Create Industry Update</h1>
    <p>Enter material provided by a real source. Save a draft and submit it for administrator review.</p>
    {error && <p role="alert">{error}</p>}<form onSubmit={event => void create(event)}><UpdateFields values={values} onChange={setValues} disabled={busy} /><button type="submit" className="faculty-primary" disabled={busy}>{busy ? 'Saving…' : 'Save Draft'}</button></form>
  </section>
}

function History({ entry }: { entry: HubEntry }) {
  const reader = useCallback((signal: AbortSignal) => hubRequest<{ events: { id: number; action: string; actorId: number; revisionNumber: number | null; sourceName: string | null; createdAt: string }[] }>(`${api}/${entry.id}/history`, { signal }), [entry.id])
  const state = useManagementRead(`industry-history:${entry.id}:${entry.version}`, reader)
  return <details className="faculty-history"><summary>Review history</summary>{state.loading ? <p role="status">Loading history…</p> : state.error ? <p role="alert">History unavailable. <button onClick={state.retry}>Retry history</button></p> : <ul>{state.data?.events.map(event => <li key={event.id}>{event.action.replaceAll('_', ' ')} · Account {event.actorId} · Revision v{event.revisionNumber} · Source: {event.sourceName} · <time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleString()}</time></li>)}</ul>}</details>
}

function Editor({ initial, user, refresh }: { initial: HubEntry; user: AuthUser; refresh: () => void }) {
  const origin = useManagementOrigin(user, ['industry']), back = origin ? managementReturn(origin) : { path: manage, label: 'Industry Updates' }
  const navigate = useNavigate()
  const [entry, setEntry] = useState(initial), [values, setValues] = useState(fields(initial.working))
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [confirm, setConfirm] = useState<Action | 'delete' | null>(null), [reason, setReason] = useState('')
  const [materialName, setMaterialName] = useState(''), [materialType, setMaterialType] = useState('pdf'), [url, setUrl] = useState('')
  const file = useRef<HTMLInputElement>(null), controller = useRef<AbortController | null>(null)
  const isMounted = useEditorMounted()
  const revision = entry.working, draft = revision?.state === 'draft' && entry.status !== 'archived'
  const canDiscard = entry.published && entry.status !== 'archived' && revision && ['draft','rejected'].includes(revision.state ?? '')
  const canDelete = entry.published ? user.role === 'admin' : revision?.state === 'draft' || revision?.state === 'rejected'
  const dirty = JSON.stringify(values) !== JSON.stringify(fields(revision))
  const [fileSelected, setFileSelected] = useState(false)
  const requestExit = useUnsavedChanges((draft && dirty) || Boolean(reason), busy)
  const materialExit = useUnsavedChanges(Boolean(materialName || url || fileSelected), busy, 'hub-material')
  async function run(operation: (signal: AbortSignal) => Promise<{ entry: HubEntry }>, message: string, resetMaterials = false) {
    if (controller.current) return
    const request = new AbortController(); controller.current = request; setBusy(true); setError(''); setNotice('')
    try {
      const result = await operation(request.signal)
      if (isMounted() && !request.signal.aborted) {
        setEntry(result.entry); setValues(fields(result.entry.working)); setNotice(message); setConfirm(null)
        setReason(''); if (resetMaterials) { setMaterialName(''); setUrl(''); setFileSelected(false); if (file.current) file.current.value = '' }
      }
    } catch (failure) { if (isMounted() && !request.signal.aborted) setError(failure instanceof Error ? failure.message : 'Unable to save.') }
    finally { if (controller.current === request) controller.current = null; if (isMounted() && !request.signal.aborted) setBusy(false) }
  }
  function action(value: Action) {
    void run(signal => hubMutation(`${api}/${entry.id}/${value}`, 'POST', { expectedVersion: entry.version, ...(value === 'discard-revision' ? { confirmation: 'DISCARD' } : {}), ...(value === 'reject' ? { reviewNote: reason } : {}) }, signal), value === 'discard-revision' ? 'Revision discarded. The published version is unchanged.' : value === 'approve' ? 'Approved and published.' : 'Update saved.', value === 'discard-revision')
  }
  async function deleteUpdate() {
    if (controller.current) return
    const request = new AbortController(); controller.current = request; setBusy(true); setError('')
    try {
      const result = await hubRequest<{ deleted: boolean; cleanupPending: boolean }>(`${api}/${entry.id}`, {
        method: 'DELETE', signal: request.signal, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedVersion: entry.version, confirmation: 'DELETE' }),
      })
      if (isMounted() && !request.signal.aborted) {
        if (result.deleted !== true) throw new Error('Deletion could not be confirmed. Refresh the update before retrying.')
        navigate(back.path, { replace: true, state: { industryDeletion: result.cleanupPending ? 'cleanup-pending' : 'complete' } })
      }
    } catch (failure) { if (isMounted() && !request.signal.aborted) setError(failure instanceof Error ? failure.message : 'Unable to delete update.') }
    finally { if (controller.current === request) controller.current = null; if (isMounted() && !request.signal.aborted) setBusy(false) }
  }
  function upload(event: FormEvent) {
    event.preventDefault()
    if (materialType === 'external_link') void run(signal => hubMutation(`${api}/${entry.id}/attachments`, 'POST', { expectedVersion: entry.version, displayName: materialName, externalUrl: url }, signal), 'Link added to draft.', true)
    else if (file.current?.files?.[0]) {
      const form = new FormData()
      form.set('expectedVersion', String(entry.version)); form.set('displayName', materialName); form.set('attachmentType', materialType); form.set('file', file.current.files[0])
      void run(signal => hubRequest(`${api}/${entry.id}/attachments`, { method: 'POST', body: form, signal }), 'Material added to draft.', true)
    }
  }
  return <section className="faculty-workspace industry-workspace"><Link className="management-return" to={back.path}>← {back.label}</Link><h1>Manage Industry Update</h1>
    <p className="faculty-status">{hubLabels[entry.status]}{entry.published && revision && <> · {revision.state === 'pending' ? 'Pending Revision' : 'Revision'} v{revision.number}: {hubLabels[revision.state ?? 'draft']}</>}</p>
    <p>Submitted by account {entry.submittedById}. Source identity is recorded separately.</p>
    {error && <div role="alert"><p>{error}</p><button disabled={busy} onClick={() => requestExit(refresh)}>Refresh update</button><p>Refresh loads the saved version and clears unsaved changes.</p></div>}
    {notice && <p role="status">{notice}</p>}{revision?.reviewNote && <p>Review feedback: {revision.reviewNote}</p>}
    {draft && <><form onSubmit={event => { event.preventDefault(); void run(signal => hubMutation(`${api}/${entry.id}`, 'PATCH', { ...values, expectedVersion: entry.version }, signal), 'Draft saved.') }}><UpdateFields values={values} onChange={setValues} disabled={busy} /><button type="submit" disabled={busy} className="faculty-primary">Save Draft</button></form>
      {dirty && <p>Save changes before adding materials or submitting for review.</p>}
      <form className="faculty-upload" onSubmit={upload}><fieldset disabled={busy || dirty}><legend>Add material</legend>
        <label>Material name<input required maxLength={300} value={materialName} onChange={e => setMaterialName(e.target.value)} /></label>
        <label>Material type<select value={materialType} onChange={e => {const next = e.target.value; const change = () => { setMaterialType(next); setUrl(''); setFileSelected(false); if (file.current) file.current.value = '' }; if (url || fileSelected) materialExit(change, 'hub-material'); else change()}}><option value="pdf">PDF</option><option value="slides">PPT / PPTX</option><option value="document">Word (DOC / DOCX)</option><option value="cover">Image (PNG / JPEG / WebP)</option><option value="external_link">External link</option></select></label>
        {materialType === 'external_link' ? <label>Link URL<input key="material-url" required type="url" maxLength={1500} value={url} onChange={e => setUrl(e.target.value)} /></label> : <label>File<input key="material-file" required type="file" ref={file} onChange={event => setFileSelected(Boolean(event.target.files?.length))} accept={{ pdf: '.pdf', slides: '.ppt,.pptx', document: '.doc,.docx', cover: '.png,.jpg,.jpeg,.webp' }[materialType]} /></label>}
        <p>PDF/PPT: up to 50 MB; Word: 30 MB; images: 8 MB. No video, encrypted files, or macros. In-page preview is unavailable.</p><button type="submit">Add material</button>
      </fieldset></form>
      {revision && revision.attachments.length > 0 && <ul className="faculty-attachments" aria-label="Draft materials">{revision.attachments.map(item => <li key={item.id}><span>{item.displayName}</span><button disabled={busy || dirty} aria-label={`Remove ${item.displayName}`} onClick={() => void run(signal => hubMutation(`${api}/${entry.id}/attachments/${item.id}`, 'DELETE', { expectedVersion: entry.version }, signal), 'Material removed from draft.')}>Remove</button></li>)}</ul>}
    </>}
    {(entry.published || revision && !draft) && <section className="industry-comparison" aria-label="Version comparison">
      <div><h2>Current published version</h2>{entry.published ? <><p>Published v{entry.published.number} remains live until another revision is approved.</p><RevisionView revision={entry.published} /></> : <p>No version has been published.</p>}</div>
      {revision && !draft && <div><h2>{revision.state === 'pending' ? 'Pending revision' : 'Working revision'} v{revision.number}</h2><p>This revision is not visible to learners.</p><RevisionView revision={revision} /></div>}
    </section>}
    <div className="faculty-actions">
      {draft && <button disabled={busy || dirty} className="faculty-primary" onClick={() => materialExit(() => { setMaterialName(''); setUrl(''); setFileSelected(false); if (file.current) file.current.value = ''; setConfirm('submit') }, 'hub-material')}>Submit for Review</button>}
      {revision?.state === 'pending' && entry.status !== 'archived' && <><button disabled={busy} onClick={() => setConfirm('withdraw')}>Withdraw to Draft</button>{user.role === 'admin' && <><button disabled={busy} onClick={() => setConfirm('approve')}>Approve & Publish</button><label>Rejection reason<textarea maxLength={2000} value={reason} disabled={busy} onChange={e => setReason(e.target.value)} /></label><button disabled={busy || !reason.trim()} onClick={() => setConfirm('reject')}>Reject</button></>}</>}
      {entry.status !== 'archived' && (revision?.state === 'rejected' || !revision && entry.published) && <button disabled={busy} onClick={() => action('draft')}>{revision?.state === 'rejected' ? 'Revise rejected update' : 'Create revision'}</button>}
      {entry.published && entry.status !== 'archived' && <Link to={withManagementOrigin(industryPath(entry.id), origin)}>View published update →</Link>}
    </div>
    <section className="industry-danger" aria-labelledby="industry-danger-title"><h2 id="industry-danger-title">Danger zone</h2>
      <p>Archive retains versions and moderation history. Permanent deletion removes this update, all versions and material links; only a minimal deletion audit receipt is retained.</p>
      <div className="faculty-actions">
        {user.role === 'admin' && entry.status !== 'archived' && <button disabled={busy || dirty} onClick={() => materialExit(() => { setMaterialName(''); setUrl(''); setFileSelected(false); if (file.current) file.current.value = ''; setConfirm('archive') }, 'hub-material')}>Archive update</button>}
        {canDiscard && <button className="industry-delete" disabled={busy} onClick={()=>{setError('');setConfirm('discard-revision')}}>Discard revision</button>}
        {canDelete && <button className="industry-delete" disabled={busy} onClick={() => { setError(''); setConfirm('delete') }}>{entry.published ? 'Delete permanently' : 'Delete draft'}</button>}
      </div>
      {!canDelete && <p>{entry.published ? 'Previously published updates can only be permanently deleted by an administrator.' : 'Withdraw this pending update to Draft before deleting it.'}</p>}
    </section><History entry={entry} />
    {confirm === 'delete' ? <ConfirmDialog title={entry.published ? 'Permanently delete update?' : 'Delete this draft?'} confirmLabel={entry.published ? 'Delete permanently' : 'Delete draft'} description={entry.published ? 'This cannot be undone. All revisions and material links will be removed, including any published version. Shared files used by other content are preserved. Unsaved changes will be discarded.' : 'This permanently removes the saved draft. This action cannot be undone. Any unsaved local changes will also be discarded.'} confirmationText={entry.published ? 'DELETE' : undefined} tone="danger" busy={busy} error={error} onCancel={() => setConfirm(null)} onConfirm={() => void deleteUpdate()} /> : confirm === 'discard-revision' ? <ConfirmDialog title="Discard this revision?" description="The current published version will remain available. Only this draft revision will be removed. Any unsaved local changes will also be discarded." cancelLabel="Keep revision" confirmLabel="Discard revision" tone="danger" busy={busy} error={error} onCancel={()=>setConfirm(null)} onConfirm={()=>action('discard-revision')} /> : confirm && <ConfirmDialog title={`${confirm === 'approve' ? 'Approve and publish' : confirm[0].toUpperCase()+confirm.slice(1)} update?`} confirmLabel={confirm === 'approve' ? 'Approve & Publish' : 'Confirm'} description={confirm === 'archive' ? 'This update will no longer be visible to learners or in search. History is retained.' : 'This action applies to the saved revision. Only approval replaces the published version.'} confirmationText={confirm === 'archive' ? 'ARCHIVE' : undefined} tone={confirm === 'archive' ? 'danger' : 'neutral'} busy={busy} error={error} onCancel={() => setConfirm(null)} onConfirm={() => action(confirm)} />}

  </section>
}

export default function IndustryWorkspace({ user, managed = false, create = false }: { user: AuthUser; managed?: boolean; create?: boolean }) {
  const location = useLocation()
  const { entryId } = useParams(), [query] = useSearchParams()
  const requested = query.get('scope')
  const scope = managed ? user.role === 'admin' && (requested === 'all' || requested === 'review') ? requested : 'mine' : 'published'
  const page = String(listPage(query.get('page')))
  const origin = useManagementOrigin(user, ['industry'])
  const back = origin ? managementReturn(origin) : { path: managed ? manage : published, label: 'Industry Updates' }
  const source = new URLSearchParams({ scope, page })
  const path = entryId ? `${api}/${encodeURIComponent(entryId)}${managed ? '/manage' : ''}` : `${api}?${new URLSearchParams({ scope, page })}`
  const reader = useCallback(async (signal: AbortSignal) => {
    if (create) return null
    const data = await hubRequest<HubList | { entry: HubEntry }>(path, { signal })
    if ('entry' in data ? data.entry?.kind !== 'industry' : !Array.isArray(data.entries) || data.entries.some(entry => entry.kind !== 'industry')) throw new HubError('Invalid Industry Updates response.', 503)
    return data
  }, [path, create])
  const state = useManagementRead(`industry:${user.id}:${user.role}:${path}`, reader)
  useManagementListPosition(state.data && 'entries' in state.data ? state.data : null, !entryId && !create)
  if (create) return <NewUpdate user={user} />
  if (state.loading) return <p role="status" className="faculty-workspace">Loading Industry Updates…</p>
  if (state.error) return <section className="faculty-workspace" role="alert"><h2>{state.error === 'not-found' ? 'Update not available' : state.error === 'forbidden' ? 'Access denied' : 'Industry Updates unavailable'}</h2><p>This update may be unpublished, archived, or unavailable to your account.</p><button onClick={state.retry}>Retry</button><Link className="management-return" to={back.path}>{origin ? back.label : 'Back to Industry Updates'}</Link></section>
  const data = state.data
  if (!data) return null
  if ('entry' in data) {
    if (managed) return <Editor key={`${data.entry.id}:${data.entry.version}`} initial={data.entry} user={user} refresh={state.retry} />
    return <article className="faculty-workspace industry-workspace"><Link className="management-return" to={back.path}>← {back.label}</Link><h1>{data.entry.published?.title}</h1>{data.entry.published && <RevisionView revision={data.entry.published} />}
      {data.entry.createdAt && <p>Added to platform: <time dateTime={data.entry.createdAt}>{new Date(data.entry.createdAt).toLocaleString()}</time></p>}
    </article>
  }
  return <section className="faculty-workspace industry-workspace"><div className="faculty-list-header">{managed ? <h1>Industry Updates</h1> : <h2>Industry Updates</h2>}<div className="faculty-actions">
    {managed ? <><Link className="faculty-primary" to={withManagementOrigin(`${manage}/new`, makeManagementOrigin(user, 'industry', source))}>Create update</Link><Link to={manage}>My Industry Updates</Link>{user.role === 'admin' && <><Link to={`${manage}?scope=review`}>Review queue</Link><Link to={`${manage}?scope=all`}>All updates</Link></>}<Link to={published}>Published updates</Link></> : user.role !== 'student' && <Link to={manage}>Manage Industry Updates →</Link>}
  </div></div>
    {managed && location.state?.industryDeletion === 'complete' && <p role="status">Update permanently deleted.</p>}
    {managed && location.state?.industryDeletion === 'cleanup-pending' && <p role="status">Update permanently deleted. File access is revoked; physical file cleanup is queued for retry.</p>}
    {!data.entries.length ? <p>{managed ? 'No industry updates in this view.' : 'No industry updates have been published yet.'}</p> : <ul className="faculty-list">{data.entries.map(entry => {
      const revision = managed ? entry.working ?? entry.published : entry.published
      const destination = withManagementOrigin(managed ? industryManagePath(entry.id) : industryPath(entry.id), makeManagementOrigin(user, 'industry', source, entry.id))
      return <li key={entry.id} tabIndex={-1} data-management-row={`industry-${entry.id}`}><div><p className="faculty-status">{hubLabels[entry.status]}{managed && entry.published && entry.working && ` · Revision v${entry.working.number}: ${hubLabels[entry.working.state ?? 'draft']}`}</p><h3><Link to={destination}>{revision?.title}</Link></h3>{revision?.sourceName && <p>Source: {revision.sourceName}</p>}</div><Link to={destination}>{managed ? 'Manage →' : 'Open →'}</Link></li>
    })}</ul>}
    {data.totalPages > 1 && <nav aria-label="Industry Updates pagination" className="faculty-actions">{data.page > 1 && <Link to={`?${new URLSearchParams({ ...(managed ? { scope } : { view: 'industry' }), page: String(data.page-1) })}`}>Previous page</Link>}<span>Page {data.page} of {data.totalPages}</span>{data.page < data.totalPages && <Link to={`?${new URLSearchParams({ ...(managed ? { scope } : { view: 'industry' }), page: String(data.page+1) })}`}>Next page</Link>}</nav>}
  </section>
}
