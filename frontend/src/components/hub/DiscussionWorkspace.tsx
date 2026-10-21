import { useCallback, useId, useRef, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { discussionRead, discussionMutation, discussionPath, discussionManagePath, discussionsHome, type Discussion, type DiscussionRevision, type DiscussionReport, type DiscussionEvent, type Page } from '../../api/discussions'
import { hubLabels } from '../../api/hub'
import type { AuthUser } from '../../types/auth'
import { useManagementRead } from '../management/useManagementRead'
import { makeManagementOrigin, managementReturn, withManagementOrigin, listPage, type ManagementOrigin } from '../management/managementOrigin'
import { useManagementOrigin, useManagementListPosition } from '../management/useManagementOrigin'
import { useSearchReturn } from '../search/useSearchReturn'
import { useUnsavedChanges, useEditorMounted } from '../management/useUnsavedChanges'
import ConfirmDialog from '../papers/ConfirmDialog'
import './FacultyWorkspace.css'
import './DiscussionWorkspace.css'

export type DiscussionMode = 'read' | 'create' | 'manage' | 'review' | 'reports'
function useMutation() {
  const controller = useRef<AbortController | null>(null)
  const [busy,setBusy] = useState(false), [error,setError] = useState(''), [notice,setNotice] = useState('')
  const isMounted = useEditorMounted()
  useUnsavedChanges(false, busy)
  async function run<T>(path: string, data: unknown, done: (result: T) => void, method = 'POST') {
    if (controller.current) return
    const request = new AbortController();controller.current=request;setBusy(true);setError('');setNotice('')
    try { const result = await discussionMutation<T>(path,method,data,request.signal);if (isMounted() && !request.signal.aborted) done(result) }
    catch (failure) { if (isMounted() && !request.signal.aborted) setError(failure instanceof Error ? failure.message : 'Unable to save discussion.') }
    finally { if (controller.current === request) controller.current=null;if (isMounted() && !request.signal.aborted) setBusy(false) }
  }
  return { busy,error,notice,setNotice,clearError:()=>setError(''),run }
}
function Fields({ reply, title, body, setTitle, setBody, busy }: { reply: boolean; title: string; body: string; setTitle: (value: string) => void; setBody: (value: string) => void; busy: boolean }) {
  const id = useId()
  return <fieldset className="discussion-fields" disabled={busy}><legend>{reply ? 'Reply draft' : 'Thread draft'}</legend>
    {!reply && <div><label htmlFor={`${id}-title`}>Title</label><input id={`${id}-title`} required maxLength={200} value={title} onChange={event=>setTitle(event.target.value)} /></div>}
    <div><label htmlFor={`${id}-body`}>Body</label><textarea id={`${id}-body`} required maxLength={10000} rows={6} value={body} onChange={event=>setBody(event.target.value)} /></div>
    <p>Text only. Threads and replies require approval before other readers can see them.</p>
  </fieldset>
}
function Revision({ value }: { value: DiscussionRevision }) {
  return <div className="discussion-text">{value.title && <h3>{value.title}</h3>}<p className="faculty-body">{value.body}</p>{value.publishedAt && <p>Published <time dateTime={value.publishedAt}>{new Date(value.publishedAt).toLocaleString()}</time></p>}</div>
}
function Feedback({ mutation }: { mutation: ReturnType<typeof useMutation> }) {
  return <>{mutation.error && <p role="alert">{mutation.error}</p>}{mutation.notice && <p role="status">{mutation.notice}</p>}</>
}
function Pager({ page, totalPages, change }: { page: number; totalPages: number; change: (page: number) => void }) {
  return totalPages>1 && <nav className="faculty-actions" aria-label="Discussion pagination"><button disabled={page<=1} onClick={()=>change(page-1)}>Previous page</button><span>Page {page} of {totalPages}</span><button disabled={page>=totalPages} onClick={()=>change(page+1)}>Next page</button></nav>
}
function NewContent({ threadId, origin }: { threadId?: number; origin?: ManagementOrigin | null }) {
  const navigate=useNavigate(), mutation=useMutation()
  const [title,setTitle]=useState(''), [body,setBody]=useState('')
  useUnsavedChanges(Boolean(title || body), mutation.busy)
  function submit(event: FormEvent) { event.preventDefault();void mutation.run<{entry:Discussion}>(threadId ? `/entries/${threadId}/replies` : '/entries',threadId ? {body} : {title,body},result=>navigate(withManagementOrigin(discussionManagePath(result.entry.id), origin ?? null))) }
  return <section aria-label={threadId ? 'Create reply' : 'Create thread'}><h2>{threadId ? 'Reply to this thread' : 'Create Thread'}</h2><form onSubmit={submit}><Fields reply={Boolean(threadId)} title={title} body={body} setTitle={setTitle} setBody={setBody} busy={mutation.busy} /><button className="faculty-primary" disabled={mutation.busy} type="submit">Save Draft</button></form><Feedback mutation={mutation}/></section>
}
function History({ path, report = false }: { path: string; report?: boolean }) {
  const [open,setOpen]=useState(false)
  return <details className="faculty-history" onToggle={event=>setOpen(event.currentTarget.open)}><summary>{report ? 'Report history' : 'Moderation history'}</summary>{open && <HistoryContent path={path} report={report}/>}</details>
}
function HistoryContent({ path, report }: { path: string; report: boolean }) {
  const [page,setPage]=useState(1)
  const read=useCallback((signal:AbortSignal)=>discussionRead<Page<DiscussionEvent> & {events?:DiscussionEvent[]}>(report ? path : `${path}?page=${page}`,signal),[path,page,report])
  const state=useManagementRead(`history:${path}:${page}`,read)
  if (state.loading) return <p role="status">Loading history…</p>
  if (state.error) return <button onClick={state.retry}>Retry history</button>
  return <><ul>{(state.data?.events ?? state.data?.entries ?? []).map((item,index)=><li key={index}>{item.action} · Account {item.actorId} · <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString()}</time></li>)}</ul>{state.data && !report && <Pager page={page} totalPages={state.data.totalPages} change={setPage}/>}</>
}
function ReportControl({ entry }: { entry: Discussion }) {
  const [open,setOpen]=useState(false),[reason,setReason]=useState(''),[detail,setDetail]=useState(''),[sent,setSent]=useState(false)
  const mutation=useMutation(),id=useId()
  const requestExit = useUnsavedChanges(open && !sent && Boolean(reason || detail), mutation.busy, `report-${id}`)
  return <div className="discussion-report-control"><button disabled={mutation.busy} onClick={()=>open ? requestExit(()=>{setOpen(false);setReason('');setDetail('')}, `report-${id}`) : setOpen(true)}>Report {entry.type}</button>{open && (sent ? <p role="status">Report submitted for administrator review. Content is unchanged.</p> : <form onSubmit={event=>{event.preventDefault();void mutation.run(`/entries/${entry.id}/reports`,{reason,detail},()=>{setSent(true);setReason('');setDetail('')})}}>
    <label htmlFor={`${id}-reason`}>Reason</label><input id={`${id}-reason`} required maxLength={200} value={reason} disabled={mutation.busy} onChange={event=>setReason(event.target.value)}/>
    <label htmlFor={`${id}-detail`}>Detail (optional)</label><textarea id={`${id}-detail`} maxLength={2000} value={detail} disabled={mutation.busy} onChange={event=>setDetail(event.target.value)}/><button disabled={mutation.busy}>Submit report</button><Feedback mutation={mutation}/>
  </form>)}</div>
}
function Editor({ initial, user, refresh }: { initial: Discussion; user: AuthUser; refresh:()=>void }) {
  const origin = useManagementOrigin(user, ['discussions', 'reports'])
  const back = origin ? managementReturn(origin).path : discussionsHome+'&scope=mine'
  const [entry,setEntry]=useState(initial),[title,setTitle]=useState(initial.working?.title??''),[body,setBody]=useState(initial.working?.body??'')
  const [confirm,setConfirm]=useState<string|null>(null),[reason,setReason]=useState('')
  const mutation=useMutation(),navigate=useNavigate(),draft=entry.working?.state==='draft' && entry.status!=='archived',id=useId()
  const dirty=title!==(entry.working?.title??'') || body!==(entry.working?.body??'')
  const requestExit = useUnsavedChanges((draft && dirty) || Boolean(reason), mutation.busy)
  function saved(result:{entry:Discussion}) { setEntry(result.entry);setTitle(result.entry.working?.title??'');setBody(result.entry.working?.body??'');setReason('');setConfirm(null);mutation.setNotice('Discussion saved.') }
  function action(value:string) {
    if(value==='delete') void mutation.run<{deleted:boolean}>(`/entries/${entry.id}`,{expectedVersion:entry.version,confirmation:'DELETE'},result=>{if(result.deleted)navigate(back,{replace:true})},'DELETE')
    else if(value==='discard-revision') void mutation.run(`/entries/${entry.id}/discard-revision`,{expectedVersion:entry.version,confirmation:'DISCARD'},(result:{entry:Discussion})=>{saved(result);mutation.setNotice('Revision discarded. The published version is unchanged.')})
    else void mutation.run(`/entries/${entry.id}/${value}`,{expectedVersion:entry.version,...(value==='reject'?{reviewNote:reason}:{})},saved)
  }
  return <><h1>Manage {entry.type==='reply' ? 'Reply' : 'Thread'}</h1><p className="faculty-status">{hubLabels[entry.status??'draft']}{entry.published && entry.working && ` · Working revision v${entry.working.number}: ${entry.working.state}`}</p><p>Author: {entry.author}</p>
    {entry.threadId && <Link to={withManagementOrigin(discussionPath(entry.threadId), origin)}>Back to Thread →</Link>}
    <Feedback mutation={mutation}/>{mutation.error && <><button disabled={mutation.busy} onClick={()=>requestExit(refresh)}>Refresh saved version</button><p>Refresh clears unsaved changes.</p></>}
    {entry.working?.reviewNote && <p>Review feedback: {entry.working.reviewNote}</p>}
    {draft && <form onSubmit={event=>{event.preventDefault();void mutation.run(`/entries/${entry.id}`,{expectedVersion:entry.version,body,...(entry.type==='thread'?{title}:{})},saved,'PATCH')}}><Fields reply={entry.type==='reply'} title={title} body={body} setTitle={setTitle} setBody={setBody} busy={mutation.busy}/><button disabled={mutation.busy} type="submit">Save Draft</button></form>}
    {entry.published && <section><h2>Current published version</h2><Revision value={entry.published}/></section>}
    {entry.working && !draft && <section><h2>Working revision v{entry.working.number}</h2><Revision value={entry.working}/></section>}
    <div className="faculty-actions">
      {draft && <><button disabled={mutation.busy||dirty} onClick={()=>setConfirm('submit')}>Submit for Review</button>{user.role==='admin' && entry.isAuthor && <button disabled={mutation.busy||dirty} onClick={()=>setConfirm('publish')}>Publish own draft</button>}</>}
      {entry.working?.state==='pending' && entry.status!=='archived' && <><button disabled={mutation.busy} onClick={()=>setConfirm('withdraw')}>Withdraw to Draft</button>{user.role==='admin' && <><button disabled={mutation.busy} onClick={()=>setConfirm('approve')}>Approve & Publish</button><label htmlFor={`${id}-review`}>Rejection reason</label><textarea id={`${id}-review`} maxLength={2000} value={reason} disabled={mutation.busy} onChange={event=>setReason(event.target.value)}/><button disabled={mutation.busy||!reason.trim()} onClick={()=>setConfirm('reject')}>Reject</button></>}</>}
      {entry.status!=='archived' && (entry.working?.state==='rejected'||!entry.working&&entry.published) && <button disabled={mutation.busy} onClick={()=>action('draft')}>{entry.working?.state==='rejected' ? 'Revise rejected content' : 'Create revision'}</button>}
      {entry.published && entry.status!=='archived' && <Link to={withManagementOrigin(discussionPath(entry.threadId??entry.id), origin)}>View Thread →</Link>}
    </div>
    <section className="discussion-danger"><h2>Danger zone</h2><p>Archive retains history. Permanent deletion removes all versions. Deleting a thread also removes its replies; report records retain an unavailable target and audit history.</p><div className="faculty-actions">
      {user.role==='admin' && entry.published && entry.status!=='archived' && <button disabled={mutation.busy||dirty} onClick={()=>setConfirm('archive')}>Archive content</button>}
      {entry.published && entry.status!=='archived' && ['draft','rejected'].includes(entry.working?.state??'') && <button disabled={mutation.busy} onClick={()=>setConfirm('discard-revision')}>Discard revision</button>}
      {(entry.published ? user.role==='admin' : ['draft','rejected'].includes(entry.working?.state??'')) && <button disabled={mutation.busy} onClick={()=>setConfirm('delete')}>{entry.published ? 'Delete permanently' : 'Delete draft'}</button>}
    </div></section>
    {user.role==='admin' && <History path={`/entries/${entry.id}/history`}/>}
    {confirm==='discard-revision' ? <ConfirmDialog title="Discard this revision?" description="The current published version will remain available. Only this draft revision will be removed. Any unsaved local changes will also be discarded." cancelLabel="Keep revision" confirmLabel="Discard revision" tone="danger" busy={mutation.busy} error={mutation.error} onCancel={()=>setConfirm(null)} onConfirm={()=>action('discard-revision')}/> : confirm==='delete' && !entry.published ? <ConfirmDialog title="Delete this draft?" description="This permanently removes the saved draft. This action cannot be undone. Any unsaved local changes will also be discarded." confirmLabel="Delete draft" tone="danger" busy={mutation.busy} error={mutation.error} onCancel={()=>setConfirm(null)} onConfirm={()=>action('delete')}/> : confirm && <ConfirmDialog title={`${confirm==='delete' ? 'Permanently delete' : confirm==='publish' ? 'Publish own' : confirm[0].toUpperCase()+confirm.slice(1)} ${entry.type}?`} confirmLabel={confirm==='delete'?'Delete permanently':confirm==='approve'?'Approve & Publish':'Confirm'} description={confirm==='delete'?'This cannot be undone. All revisions and any replies will be removed.':'Only approved content is visible to other readers. Pending edits preserve the current published version.'} confirmationText={confirm==='delete'?'DELETE':confirm==='archive'?'ARCHIVE':undefined} tone={['delete','archive'].includes(confirm)?'danger':'neutral'} busy={mutation.busy} error={mutation.error} onCancel={()=>setConfirm(null)} onConfirm={()=>action(confirm)}/>}

  </>
}
function Replies({ entry, origin }: { entry:Discussion; origin: ManagementOrigin | null }) {
  const [page,setPage]=useState(1)
  const read=useCallback((signal:AbortSignal)=>discussionRead<Page<Discussion>>(`/entries/${entry.id}/replies?page=${page}`,signal),[entry.id,page])
  const state=useManagementRead(`replies:${entry.id}:${page}`,read)
  return <section><h2>Replies</h2>{state.loading ? <p role="status">Loading replies…</p> : state.error ? <div role="alert"><p>Replies could not be loaded.</p><button onClick={state.retry}>Retry replies</button></div> : <>
    {!state.data?.entries.length && <p>No published replies yet.</p>}{state.data?.entries.map(reply=><article className="discussion-reply" key={reply.id} id={`reply-${reply.id}`}><h3>Reply by {reply.author}</h3>{reply.published && <Revision value={reply.published}/>}<div className="faculty-actions">{reply.canManage && <Link to={withManagementOrigin(discussionManagePath(reply.id), origin)}>Manage reply →</Link>}</div><ReportControl entry={reply}/></article>)}{state.data && <Pager page={page} totalPages={state.data.totalPages} change={setPage}/>}</>}
    <NewContent threadId={entry.id} origin={origin}/>
  </section>
}
function Reports({ user }: {user:AuthUser}) {
  const [query,setQuery]=useSearchParams(),status=query.get('status')??'open',page=String(listPage(query.get('page'))),mutation=useMutation()
  const read=useCallback((signal:AbortSignal)=>discussionRead<Page<DiscussionReport>>(`/reports?${new URLSearchParams({status,page})}`,signal),[status,page])
  const state=useManagementRead(`reports:${user.id}:${status}:${page}`,read)
  useManagementListPosition(state.data)
  return <><h2>Discussion Reports</h2><div className="faculty-actions" role="group" aria-label="Report status">{['open','resolved','dismissed','all'].map(value=><button aria-pressed={status===value} key={value} onClick={()=>setQuery({scope:'reports',status:value})}>{value[0].toUpperCase()+value.slice(1)}</button>)}</div><Feedback mutation={mutation}/>
    {mutation.error && <button disabled={mutation.busy} onClick={()=>{mutation.clearError();state.retry()}}>Refresh reports</button>}
    {state.loading ? <p role="status">Loading reports…</p> : state.error ? <div role="alert">Reports could not be loaded. <button onClick={state.retry}>Retry</button></div> : <>
      {!state.data?.entries.length && <p>No reports in this view.</p>}{state.data?.entries.map(report=><article className="discussion-reply" key={report.id} tabIndex={-1} data-management-row={`reports-${report.id}`}><h2>Report #{report.id} · {report.targetType}</h2><p>{report.status} · Target: {report.targetState}</p><p>Reported by {report.reporter}</p><p className="faculty-body">{report.reason}</p>{report.detail && <p className="faculty-body">{report.detail}</p>}
        {report.targetId && <Link to={withManagementOrigin(discussionManagePath(report.targetId), makeManagementOrigin(user, 'reports', query, report.id))}>Review target content →</Link>}
        {report.status==='open' && <div className="faculty-actions">{['resolve','dismiss'].map(action=><button key={action} disabled={mutation.busy} onClick={()=>void mutation.run(`/reports/${report.id}/${action}`,{expectedVersion:report.version},()=>{mutation.setNotice('Report updated. Content is unchanged.');state.retry()})}>{action==='resolve'?'Resolve report':'Dismiss report'}</button>)}</div>}<History path={`/reports/${report.id}`} report/>
      </article>)}{state.data && <Pager page={state.data.page} totalPages={state.data.totalPages} change={value=>setQuery({scope:'reports',status,page:String(value)})}/>}</>}
  </>
}
export default function DiscussionWorkspace({user,mode='read'}:{user:AuthUser;mode?:DiscussionMode}) {
  const {entryId}=useParams(),[query,setQuery]=useSearchParams()
  const origin = useManagementOrigin(user, ['discussions', 'reports'])
  const searchBack = useSearchReturn(Boolean(entryId) && mode === 'read' && !origin)
  const back = origin ? managementReturn(origin) : searchBack ?? { path: discussionsHome, label: 'Learner Discussions' }
  const isIndex=mode==='read'&&!entryId
  const isReviewIndex=mode==='review'&&!entryId
  const Heading=isIndex?'h2':'h1'
  const scope=query.get('scope')??(mode==='review'?'review':'published'),page=String(listPage(query.get('page')))
  const showReports=isReviewIndex&&scope==='reports'
  const path=entryId?`/entries/${encodeURIComponent(entryId)}${mode==='manage'?'/manage':''}`:`/entries?${new URLSearchParams({scope,page})}`
  const read=useCallback((signal:AbortSignal)=>mode==='create'||mode==='reports'||showReports?Promise.resolve(null):discussionRead<Page<Discussion>|{entry:Discussion}>(path,signal),[mode,path,showReports])
  const state=useManagementRead(`discussions:${user.id}:${user.role}:${path}:${mode}`,read)
  useManagementListPosition(state.data && 'entries' in state.data ? state.data : null, !entryId && !showReports)
  if(mode==='reports') {
    const reportQuery=new URLSearchParams(query);reportQuery.set('scope','reports')
    return <Navigate replace to={`/manage/hub/discussions?${reportQuery}`}/>
  }
  let content
  if(mode==='create')content=<><h1>New Discussion</h1><NewContent origin={origin}/></>
  else if(showReports)content=<Reports user={user}/>
  else if(state.loading)content=<p role="status">Loading discussions…</p>
  else if(state.error)content=<div role="alert"><Heading>{state.error==='not-found'?'Discussion unavailable':'Discussions unavailable'}</Heading><p>This content may be unpublished, archived or unavailable to your account.</p><button onClick={state.retry}>Retry</button></div>
  else if(state.data && 'entry' in state.data) {
    const entry=state.data.entry
    if(mode==='manage')content=<Editor key={`${entry.id}:${entry.version}`} initial={entry} user={user} refresh={state.retry}/>
    else if(entry.threadId)content=<Navigate replace to={withManagementOrigin(discussionPath(entry.threadId), origin)+`#reply-${entry.id}`}/>
    else content=<><h1>{entry.published?.title}</h1><p>By {entry.author}</p>{entry.published && <Revision value={{...entry.published,title:undefined}}/>}{entry.canManage && <Link to={withManagementOrigin(discussionManagePath(entry.id), origin)}>Manage thread →</Link>}<ReportControl entry={entry}/><Replies entry={entry} origin={origin}/></>
  } else if(state.data && 'entries' in state.data)content=<>{!isIndex && !isReviewIndex && <Heading>{scope==='published'?'Learner Discussions':scope==='mine'?'My Discussions':'Discussion Review'}</Heading>}{!isReviewIndex && <div className="faculty-actions">{['published','mine'].map(value=><button key={value} aria-pressed={scope===value} onClick={()=>setQuery({...(mode==='read'?{view:'discussions'}:{}),scope:value})}>{({published:'Published threads',mine:'My discussions'})[value]}</button>)}</div>}
    {!state.data.entries.length ? <p>{scope==='published'?'No discussions have been published yet.':'No discussion content in this view.'}</p> : <ul className="faculty-list">{state.data.entries.map(entry=><li key={entry.id} tabIndex={-1} data-management-row={`discussions-${entry.id}`}><div><p>{entry.type} · {entry.status?hubLabels[entry.status]:'Published'}</p><h2><Link to={withManagementOrigin(scope==='published'?discussionPath(entry.id):discussionManagePath(entry.id), isReviewIndex ? makeManagementOrigin(user, 'discussions', new URLSearchParams({ scope, page }), entry.id) : null)}>{(entry.working??entry.published)?.title??`Reply by ${entry.author}`}</Link></h2><p>By {entry.author}</p>{entry.published&&entry.working&&<p>Working revision v{entry.working.number}: {entry.working.state}</p>}</div></li>)}</ul>}
    <Pager page={state.data.page} totalPages={state.data.totalPages} change={value=>setQuery({...(mode==='read'?{view:'discussions'}:{}),scope,page:String(value)})}/></>
  return <section className="faculty-workspace discussion-workspace">
    {isReviewIndex ? <><h1>Discussion Review</h1><nav className="faculty-actions discussion-review-toolbar" aria-label="Discussion navigation"><Link to={discussionsHome}>← Learner Discussions</Link><Link className="faculty-primary" to={withManagementOrigin('/innovation-hub/discussions/new', makeManagementOrigin(user, showReports ? 'reports' : 'discussions', new URLSearchParams({ scope, page, ...(showReports ? { status: query.get('status') ?? 'open' } : {}) })))}>Create thread</Link>{(['published','mine','review','all','reports'] as const).map(value=><button key={value} aria-pressed={scope===value} onClick={()=>setQuery({scope:value})}>{({published:'Published threads',mine:'My discussions',review:'Review queue',all:'All discussions',reports:'Reports queue'})[value]}</button>)}</nav></> : isIndex ? <header className="faculty-actions discussion-index-header"><h2>Learner Discussions</h2><Link className="faculty-primary" to="/innovation-hub/discussions/new">Create thread</Link></header> : <nav className="faculty-actions" aria-label="Discussion navigation"><Link className="management-return" to={back.path}>← {back.label}</Link>{mode!=='create' && <Link to={withManagementOrigin('/innovation-hub/discussions/new', origin)}>Create thread</Link>}<Link to={discussionsHome+'&scope=mine'}>My discussions</Link>{user.role==='admin'&&<><Link to={origin?.kind === 'discussions' && origin.scope === 'review' ? back.path : '/manage/hub/discussions'}>Review queue</Link><Link to={origin?.kind === 'reports' ? back.path : '/manage/hub/discussions?scope=reports'}>Reports queue</Link></>}</nav>}
    {content}
  </section>
}
