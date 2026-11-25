import { useCallback, useId, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { hubLabels, hubMutation, hubRequest, HubError, type HubEntry, type HubRevision, type HubList } from '../../api/hub'
import type { AuthUser } from '../../types/auth'
import { useManagementRead } from '../management/useManagementRead'
import { makeManagementOrigin, managementReturn, withManagementOrigin, listPage } from '../management/managementOrigin'
import { useManagementOrigin, useManagementListPosition } from '../management/useManagementOrigin'
import { useUnsavedChanges, useEditorMounted } from '../management/useUnsavedChanges'
import { useSearchReturn } from '../search/useSearchReturn'
import ConfirmDialog from '../papers/ConfirmDialog'
import './FacultyWorkspace.css'
import './IndustryWorkspace.css'
import './CollaborationWorkspace.css'

const api = '/api/hub/collaboration/entries', manage = '/manage/hub/collaboration', home = '/innovation-hub?view=collaboration'
const detailPath = (id: number) => `/innovation-hub/collaboration/${id}`
type Fields = { title: string; body: string; sourceName: string; sourceUrl: string; requirements: string; deadline: string; contactName: string; contactEmail: string }
const fields = (r?: HubRevision | null): Fields => ({ title: r?.title ?? '', body: r?.body ?? '', sourceName: r?.sourceName ?? '', sourceUrl: r?.sourceUrl ?? '', requirements: r?.requirements ?? '', deadline: r?.deadline ?? '', contactName: r?.contactName ?? '', contactEmail: r?.contactEmail ?? '' })
const businessLabel = (entry: HubEntry) => entry.businessStatus === 'closed' ? 'Closed' : entry.businessStatus === 'archived' ? 'Archived' : 'Open'
const safeUrl = (value?: string | null) => {
  if (!value || value.includes('\\') || Array.from(value).some(c => c.charCodeAt(0) <= 32 || c.charCodeAt(0) === 127)) return null
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null } catch { return null }
}

function Opportunity({ revision: r, nested = false }: { revision: HubRevision; nested?: boolean }) {
  const Heading = nested ? 'h3' : 'h2'
  const external = safeUrl(r.sourceUrl), email = r.contactEmail && /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}$/.test(r.contactEmail) ? r.contactEmail : null
  const today = new Date(), localDay = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  return <div className="faculty-content collaboration-content">
    <p>Partner / source: {r.sourceName}</p><p className="faculty-body">{r.body}</p>
    {r.requirements && <section><Heading>Requirements / conditions</Heading><p className="faculty-body">{r.requirements}</p></section>}
    {r.deadline && <p>Deadline: <time dateTime={r.deadline}>{r.deadline}</time>{r.deadline < localDay && ' · Deadline passed'}</p>}
    {(r.contactName || email || external) && <section><Heading>Contact information</Heading>
      {r.contactName && <p>{r.contactName}</p>}{email && <p><a href={`mailto:${email}`}>{email}</a></p>}
      {external && <p><a href={external} target="_blank" rel="noopener noreferrer">Visit external contact / opportunity link ↗</a></p>}
      <p>Contact the source directly using the information provided.</p>
    </section>}
    {r.attachments.length > 0 && <section><Heading>Attachments</Heading><ul className="faculty-attachments">{r.attachments.map(item => <li key={item.id}><span>{item.displayName}{!item.externalUrl && <small>Download available · In-page preview unavailable</small>}</span>
      {safeUrl(item.externalUrl) ? <a href={safeUrl(item.externalUrl)!} target="_blank" rel="noopener noreferrer">Open link ↗</a> : item.downloadUrl?.startsWith(`${api}/`) && <a href={item.downloadUrl} target="_blank" rel="noopener noreferrer">Download</a>}
    </li>)}</ul></section>}
  </div>
}

function OpportunityFields({ value, change, busy }: { value: Fields; change: (v: Fields) => void; busy: boolean }) {
  const id = useId()
  return <fieldset disabled={busy} className="faculty-fields"><legend>Opportunity details</legend>{([
    ['title', 'Title', 200, 'text', true], ['body', 'Description', 10000, 'textarea', true],
    ['sourceName', 'Partner / source name', 300, 'text', true], ['requirements', 'Requirements / conditions', 10000, 'textarea', false],
    ['deadline', 'Deadline (optional)', undefined, 'date', false], ['contactName', 'Contact name (optional)', 200, 'text', false],
    ['contactEmail', 'Contact email (optional)', 254, 'email', false], ['sourceUrl', 'Contact / external URL (optional)', 1500, 'url', false],
  ] as const).map(([key, label, maxLength, type, required]) => <div className="industry-field" key={key}><label htmlFor={`${id}-${key}`}>{label}</label>
    {type === 'textarea' ? <textarea id={`${id}-${key}`} rows={key === 'body' ? 6 : 3} maxLength={maxLength} required={required} value={value[key]} onChange={e => change({ ...value, [key]: e.target.value })} /> : <input id={`${id}-${key}`} type={type} maxLength={maxLength} required={required} value={value[key]} onChange={e => change({ ...value, [key]: e.target.value })} />}
  </div>)}<p>Enter only information supplied by the source. A deadline does not automatically close an opportunity.</p></fieldset>
}

function useWrite() {
  const mounted = useEditorMounted(), active = useRef(false), [busy, setBusy] = useState(false), [error, setError] = useState('')
  useUnsavedChanges(false, busy)
  async function run<T>(operation: () => Promise<T>, done: (result: T) => void) {
    if (active.current) return
    active.current = true; setBusy(true); setError('')
    try { const result = await operation(); if (mounted()) done(result) }
    catch (e) { if (mounted()) setError(e instanceof Error ? e.message : 'Unable to save opportunity.') }
    finally { active.current = false; if (mounted()) setBusy(false) }
  }
  return { busy, error, setError, run }
}

function Editor({ user, initial, refresh }: { user: AuthUser; initial?: HubEntry; refresh: () => void }) {
  const navigate = useNavigate(), origin = useManagementOrigin(user, ['collaboration'])
  const back = origin ? managementReturn(origin) : { path: manage, label: 'Back to my opportunities' }
  const [entry, setEntry] = useState(initial), [value, setValue] = useState(fields(initial?.working)), [reason, setReason] = useState('')
  const [confirm, setConfirm] = useState<string | null>(null), [notice, setNotice] = useState(''), write = useWrite()
  const working = entry?.working, draft = !entry || working?.state === 'draft' && entry.status !== 'archived'
  const dirty = JSON.stringify(value) !== JSON.stringify(fields(working))
  const requestExit = useUnsavedChanges((draft && dirty) || Boolean(reason), write.busy)
  const [materialName, setMaterialName] = useState(''), [materialType, setMaterialType] = useState('pdf'), [selectedFile, setSelectedFile] = useState(false)
  const file = useRef<HTMLInputElement>(null), materialDirty = Boolean(materialName || selectedFile)
  const materialExit = useUnsavedChanges(materialDirty, write.busy, 'collaboration-material')
  const materialId = useId()
  function resetMaterial() { setMaterialName(''); setSelectedFile(false); if (file.current) file.current.value = '' }
  function saved(result: { entry: HubEntry }) { setEntry(result.entry); setValue(fields(result.entry.working)); setReason(''); setConfirm(null); setNotice('Opportunity saved.') }
  function save(event: FormEvent) {
    event.preventDefault(); void write.run(() => hubRequest<{ entry: HubEntry }>(entry ? `${api}/${entry.id}` : api, { method: entry ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...value, ...(entry ? { expectedVersion: entry.version } : {}) }) }), result => {
      if (!entry) navigate(withManagementOrigin(`${manage}/${result.entry.id}`, origin), { replace: true })
      else saved(result)
    })
  }
  function action(name: string) {
    if (!entry) return
    if (name === 'delete') {
      void write.run(() => hubRequest<{ deleted: boolean }>(`${api}/${entry.id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedVersion: entry.version, confirmation: 'DELETE' }) }), result => {
        if (result.deleted !== true) throw new Error('Deletion could not be confirmed. Refresh before retrying.')
        navigate(back.path, { replace: true })
      })
    } else void write.run(() => hubMutation(`${api}/${entry.id}/${name}`, 'POST', { expectedVersion: entry.version, ...(name === 'reject' ? { reviewNote: reason } : {}), ...(name === 'discard-revision' ? { confirmation: 'DISCARD' } : {}) }, new AbortController().signal), result => { saved(result); if (name === 'discard-revision') resetMaterial() })
  }
  function ask(name: string) {
    write.setError('')
    if (['delete', 'discard-revision'].includes(name)) setConfirm(name)
    else materialExit(() => { resetMaterial(); setConfirm(name) }, 'collaboration-material')
  }
  function upload(event: FormEvent) {
    event.preventDefault(); if (!entry || !file.current?.files?.[0]) return
    const data = new FormData(); data.set('expectedVersion', String(entry.version)); data.set('displayName', materialName); data.set('attachmentType', materialType); data.set('file', file.current.files[0])
    void write.run(() => hubRequest<{ entry: HubEntry }>(`${api}/${entry.id}/attachments`, { method: 'POST', body: data }), result => { saved(result); resetMaterial() })
  }
  return <section className="faculty-workspace collaboration-workspace"><Link className="management-return" to={back.path}>← {back.label}</Link><h1>{entry ? 'Manage opportunity' : 'Create opportunity'}</h1>
    {entry && <><p>{hubLabels[entry.status]} · {businessLabel(entry)}{working && ` · Working revision v${working.number}: ${hubLabels[working.state ?? 'draft']}`}</p><p>Submitted by account {entry.submittedById}</p></>}
    {write.error && <div role="alert"><p>{write.error}</p>{entry && <button disabled={write.busy} onClick={() => requestExit(refresh)}>Refresh saved version</button>}</div>}{notice && <p role="status">{notice}</p>}
    {working?.reviewNote && <p>Review feedback: {working.reviewNote}</p>}
    {draft && <><form onSubmit={save}><OpportunityFields value={value} change={setValue} busy={write.busy} /><button className="faculty-primary" disabled={write.busy}>Save Draft</button></form>
      {entry && <form onSubmit={upload}><fieldset disabled={write.busy || dirty} className="faculty-fields"><legend>Add attachment to saved draft</legend>
        <label htmlFor={`${materialId}-name`}>Material name</label><input id={`${materialId}-name`} required maxLength={300} value={materialName} onChange={e => setMaterialName(e.target.value)} />
        <label htmlFor={`${materialId}-type`}>Material type</label><select id={`${materialId}-type`} value={materialType} onChange={e => { const next = e.target.value; materialExit(() => { resetMaterial(); setMaterialType(next) }, 'collaboration-material') }}><option value="pdf">PDF</option><option value="slides">PPT / PPTX</option><option value="document">Word</option><option value="cover">Image</option></select>
        <label htmlFor={`${materialId}-file`}>File</label><input id={`${materialId}-file`} required type="file" ref={file} onChange={e => setSelectedFile(Boolean(e.target.files?.length))} accept={{ pdf: '.pdf', slides: '.ppt,.pptx', document: '.doc,.docx', cover: '.png,.jpg,.jpeg,.webp' }[materialType]} />
        <p>PDF/PPT: up to 50 MB; Word: 30 MB; images: 8 MB. In-page preview unavailable.</p><button>Add attachment</button>
      </fieldset></form>}
      {working && working.attachments.length > 0 && <ul className="faculty-attachments">{working.attachments.map(item => <li key={item.id}>{item.displayName}<button disabled={write.busy || dirty || materialDirty} aria-label={`Remove ${item.displayName}`} onClick={() => void write.run(() => hubMutation(`${api}/${entry!.id}/attachments/${item.id}`, 'DELETE', { expectedVersion: entry!.version }, new AbortController().signal), saved)}>Remove</button></li>)}</ul>}
    </>}
    {entry?.published && <section aria-label="Current published version"><h2>Current published version · v{entry.published.number}</h2><p>This version remains available until a new revision is approved.</p><Opportunity revision={entry.published} nested /><Link to={withManagementOrigin(detailPath(entry.id), origin)}>View published opportunity →</Link></section>}
    {working && !draft && <section aria-label="Working revision"><h2>Working revision · v{working.number} · {hubLabels[working.state ?? 'draft']}</h2><p>This revision is not visible to learners.</p><Opportunity revision={working} nested /></section>}
    {entry && entry.status !== 'archived' && <div className="faculty-actions">
      {draft && <button className="faculty-primary" disabled={write.busy || dirty} onClick={() => ask('submit')}>Submit for Review</button>}
      {working?.state === 'pending' && <><button disabled={write.busy} onClick={() => ask('withdraw')}>Withdraw to Draft</button>{user.role === 'admin' && <><button disabled={write.busy} onClick={() => ask('approve')}>Approve & Publish</button><label>Rejection reason<textarea maxLength={2000} value={reason} disabled={write.busy} onChange={e => setReason(e.target.value)} /></label><button disabled={write.busy || !reason.trim()} onClick={() => ask('reject')}>Reject</button></>}</>}
      {(working?.state === 'rejected' || !working && entry.published) && <button disabled={write.busy} onClick={() => action('draft')}>{working ? 'Revise rejected opportunity' : 'Create revision'}</button>}
      {entry.published && <button disabled={write.busy || dirty} onClick={() => ask(entry.businessStatus === 'closed' ? 'reopen' : 'close')}>{entry.businessStatus === 'closed' ? 'Reopen opportunity' : 'Close opportunity'}</button>}
    </div>}
    {entry && <section className="industry-danger"><h2>Danger zone</h2><p>Close ends an opportunity while keeping its published detail available. Archive removes it from published lists and Search.</p><div className="faculty-actions">
      {user.role === 'admin' && working?.state === 'pending' && (entry.status === 'archived'
        ? <><p>Withdraw this pending revision to save it as a draft. This item will remain archived.</p><button type="button" disabled={write.busy} onClick={() => ask('withdraw')}>Withdraw archived revision to Draft</button></>
        : <p>Resolve or withdraw the pending revision before archiving.</p>)}
      {user.role === 'admin' && entry.status !== 'archived' && working?.state !== 'pending' && <button disabled={write.busy || dirty} onClick={() => ask('archive')}>Archive opportunity</button>}
      {!entry.published && ['draft', 'rejected'].includes(working?.state ?? '') && <button className="industry-delete" disabled={write.busy} onClick={() => ask('delete')}>Delete draft</button>}
      {entry.published && entry.status !== 'archived' && ['draft', 'rejected'].includes(working?.state ?? '') && <button className="industry-delete" disabled={write.busy} onClick={() => ask('discard-revision')}>Discard revision</button>}
    </div></section>}
    {entry && <History id={entry.id} version={entry.version} />}
    {confirm && <ConfirmDialog title={confirm === 'delete' ? 'Delete this draft?' : confirm === 'discard-revision' ? 'Discard this revision?' : `${confirm === 'approve' ? 'Approve and publish' : confirm[0].toUpperCase()+confirm.slice(1)} opportunity?`} description={confirm === 'delete' ? 'This permanently removes the saved draft and any unsaved local input. This action cannot be undone.' : confirm === 'discard-revision' ? 'The current published version will remain available. Only this draft revision and any unsaved local input will be removed.' : confirm === 'close' ? 'The opportunity will be marked Closed. Its published detail and contact information will remain readable.' : confirm === 'withdraw' && entry?.status === 'archived' ? 'The working revision will become a draft. This item will remain archived.' : confirm === 'archive' ? 'This opportunity will no longer be visible to learners or in Search. History is retained.' : 'This action applies to the saved version. Only approval replaces the published version.'} confirmLabel={confirm === 'delete' ? 'Delete draft' : confirm === 'discard-revision' ? 'Discard revision' : confirm === 'approve' ? 'Approve & Publish' : 'Confirm'} cancelLabel={confirm === 'discard-revision' ? 'Keep revision' : 'Cancel'} tone={['delete', 'discard-revision', 'archive'].includes(confirm) ? 'danger' : 'neutral'} confirmationText={confirm === 'archive' ? 'ARCHIVE' : undefined} busy={write.busy} error={write.error} onCancel={() => setConfirm(null)} onConfirm={() => action(confirm)} />}
  </section>
}

function History({ id, version }: { id: number; version?: number }) {
  const [open, setOpen] = useState(false)
  const read = useCallback((signal: AbortSignal) => open ? hubRequest<{ events: { id: number; actorId: number; action: string; createdAt: string }[] }>(`${api}/${id}/history`, { signal }) : Promise.resolve(null), [open, id])
  const state = useManagementRead(`collaboration-history:${id}:${version}:${open}`, read)
  return <details onToggle={e => setOpen(e.currentTarget.open)}><summary>Moderation history</summary>{state.loading ? <p role="status">Loading history…</p> : state.error ? <button onClick={state.retry}>Retry history</button> : <ul>{state.data?.events.map(event => <li key={event.id}>{event.action} · Account {event.actorId} · <time dateTime={event.createdAt}>{event.createdAt}</time></li>)}</ul>}</details>
}

export default function CollaborationWorkspace({ user, managed = false, create = false }: { user: AuthUser; managed?: boolean; create?: boolean }) {
  const { entryId } = useParams(), [query, setQuery] = useSearchParams()
  const requested = query.get('scope'), scope = managed ? user.role === 'admin' && ['all', 'review'].includes(requested ?? '') ? requested! : 'mine' : 'published'
  const page = String(listPage(query.get('page'))), status = ['open', 'closed'].includes(query.get('status') ?? '') ? query.get('status')! : 'all'
  const origin = useManagementOrigin(user, ['collaboration']), searchBack = useSearchReturn(Boolean(entryId) && !managed && !create && !origin)
  const back = origin ? managementReturn(origin) : searchBack ?? { path: managed ? manage : home, label: managed ? 'Back to my opportunities' : 'Back to Collaboration Board' }
  const source = new URLSearchParams({ scope, page, status })
  const path = entryId ? `${api}/${encodeURIComponent(entryId)}${managed ? '/manage' : ''}` : `${api}?${source}`
  const read = useCallback(async (signal: AbortSignal) => {
    if (create) return null
    const data = await hubRequest<HubList | { entry: HubEntry }>(path, { signal })
    if ('entry' in data ? data.entry?.kind !== 'collaboration' : !Array.isArray(data.entries) || data.entries.some(e => e.kind !== 'collaboration')) throw new HubError('Invalid collaboration response.', 503)
    return data
  }, [create, path])
  const state = useManagementRead(`collaboration:${user.id}:${user.role}:${path}`, read)
  useManagementListPosition(state.data && 'entries' in state.data ? state.data : null, !entryId && !create)
  if (create) return <Editor key={`new:${user.id}`} user={user} refresh={state.retry} />
  if (state.loading) return <p className="faculty-workspace" role="status">Loading collaboration opportunities…</p>
  if (state.error) return <section className="faculty-workspace" role="alert"><h2>{state.error === 'not-found' ? 'Opportunity unavailable' : 'Collaboration Board unavailable'}</h2><p>This opportunity may be unpublished, archived, or unavailable to your account.</p><button onClick={state.retry}>Retry</button><Link className="management-return" to={back.path}>{back.label}</Link></section>
  if (!state.data) return null
  if ('entry' in state.data) {
    const entry = state.data.entry
    if (managed) return <Editor key={`${entry.id}:${entry.version}`} user={user} initial={entry} refresh={state.retry} />
    return <article className="faculty-workspace collaboration-workspace"><Link className="management-return" to={back.path}>← {back.label}</Link><h1>{entry.published?.title}</h1><p className="faculty-status">{businessLabel(entry)}</p>{entry.published && <Opportunity revision={entry.published} />}</article>
  }
  function listQuery(next: Record<string, string>) { setQuery({ ...(managed ? { scope } : { view: 'collaboration' }), status, ...next }) }
  return <section className="faculty-workspace collaboration-workspace"><header className="faculty-list-header">{managed ? <h1>Collaboration Board</h1> : <h2>Collaboration Board</h2>}<div className="faculty-actions">
    {managed ? <><Link className="faculty-primary" to={withManagementOrigin(`${manage}/new`, makeManagementOrigin(user, 'collaboration', source))}>Create opportunity</Link><Link to={manage}>My opportunities</Link>{user.role === 'admin' && <><Link to={`${manage}?scope=review`}>Review queue</Link><Link to={`${manage}?scope=all`}>All opportunities</Link></>}<Link to={home}>Published opportunities</Link></> : user.role !== 'student' && <Link to={manage}>Manage opportunities →</Link>}
  </div></header><div className="faculty-actions" aria-label="Opportunity status">{(['open', 'closed', 'all'] as const).map(value => <button key={value} aria-pressed={status === value} onClick={() => listQuery({ status: value })}>{value[0].toUpperCase()+value.slice(1)}</button>)}</div>
    {!state.data.entries.length ? <p>No collaboration opportunities in this view.</p> : <ul className="faculty-list">{state.data.entries.map(entry => {
      const revision = managed ? entry.working ?? entry.published : entry.published
      const destination = withManagementOrigin(managed ? `${manage}/${entry.id}` : detailPath(entry.id), makeManagementOrigin(user, 'collaboration', source, entry.id))
      return <li key={entry.id} tabIndex={-1} data-management-row={`collaboration-${entry.id}`}><div><p className="faculty-status">{businessLabel(entry)}{managed && ` · ${hubLabels[entry.status]}`}{managed && entry.published && entry.working && ` · Revision v${entry.working.number}: ${hubLabels[entry.working.state ?? 'draft']}`}</p><h3><Link to={destination}>{revision?.title}</Link></h3><p>{revision?.sourceName}</p>{revision?.body && <p>{revision.body.length > 220 ? revision.body.slice(0, 217)+'…' : revision.body}</p>}{revision?.deadline && <p>Deadline: <time dateTime={revision.deadline}>{revision.deadline}</time></p>}</div></li>
    })}</ul>}
    {state.data.totalPages > 1 && <nav className="faculty-actions" aria-label="Collaboration pagination"><button disabled={Number(page) <= 1} onClick={() => listQuery({ page: String(Number(page)-1) })}>Previous page</button><span>Page {page} of {state.data.totalPages}</span><button disabled={Number(page) >= state.data.totalPages} onClick={() => listQuery({ page: String(Number(page)+1) })}>Next page</button></nav>}
  </section>
}
