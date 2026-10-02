import { useCallback, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getResearchDetail, getResearchList, researchPath, researchRequest, researchWrite, ResearchError, type ResearchArea, type ResearchDetail, type ResearchResource, type Editor, type Staff } from '../api/research'
import { getCourse, type Course } from '../api/courses'
import { fetchPapers } from '../api/papers'
import { useCourseRead } from '../hooks/useCourseRead'
import { useAuth } from '../auth/useAuth'
import type { AuthUser } from '../types/auth'
import './ResearchManagementPage.css'

type Run = (action: () => Promise<unknown>) => Promise<boolean>
function OverviewEditor({ area, run, busy }: { area: ResearchArea; run: Run; busy: boolean }) {
  const [overview,setOverview] = useState(area.overview)
  const [subtopics,setSubtopics] = useState(area.subtopics.join('\n'))
  const [regions,setRegions] = useState(area.brainRegionSlugs.join('\n'))
  const [status,setStatus] = useState(area.status ?? 'draft')
  const submit = (event: FormEvent) => { event.preventDefault(); void run(() => researchWrite(`/api/research-areas/${area.id}`,'PATCH',{overview,subtopics:subtopics.split('\n').map(s=>s.trim()).filter(Boolean),brainRegionSlugs:regions.split('\n').map(s=>s.trim()).filter(Boolean),status,expectedUpdatedAt:area.updatedAt})) }
  return <section className="research-editor-panel"><h2>Overview & Subtopics</h2><form onSubmit={submit}>
    <div className="research-field"><label htmlFor={`research-overview-${area.id}`}>Overview</label><textarea id={`research-overview-${area.id}`} required maxLength={6000} value={overview} onChange={e=>setOverview(e.target.value)} rows={5} /></div>
    <div className="research-field"><label htmlFor={`research-subtopics-${area.id}`}>Subtopics <small>One per line</small></label><textarea id={`research-subtopics-${area.id}`} value={subtopics} onChange={e=>setSubtopics(e.target.value)} rows={4} /></div>
    <div className="research-field"><label htmlFor={`research-regions-${area.id}`}>Related brain region slugs <small>One existing anatomical slug per line</small></label><textarea id={`research-regions-${area.id}`} value={regions} onChange={e=>setRegions(e.target.value)} rows={3} /></div>
    <label>Publication status<select value={status} onChange={e=>setStatus(e.target.value)}><option value="draft">Draft</option><option value="published">Published</option><option value="archived">Archived</option></select></label>
    <button type="submit" disabled={busy}>Save area</button>
  </form></section>
}

function PaperSelector({ areaId, run, busy }: { areaId: number; run: Run; busy: boolean }) {
  const [input,setInput]=useState(''), [query,setQuery]=useState(''), [page,setPage]=useState(1)
  const reader=useCallback((signal: AbortSignal)=>fetchPapers({q:query,page,perPage:10,signal}),[query,page])
  const state=useCourseRead(`papers:${query}:${page}`,reader)
  return <div className="research-selector"><form onSubmit={e=>{e.preventDefault();setQuery(input.trim());setPage(1)}}><label>Search published papers<input type="search" value={input} onChange={e=>setInput(e.target.value)} /></label><button type="submit">Search papers</button></form>
    {state.loading ? <p role="status">Loading papers…</p> : state.error ? <><p role="alert">Paper search is unavailable.</p><button onClick={state.retry} type="button">Retry search</button></> : !state.data?.papers.length ? <p>No matching published papers.</p> : <><ul>{state.data.papers.map(paper=><li key={paper.id}><span>{paper.title}</span><button type="button" disabled={busy} aria-label={`Add paper: ${paper.title}`} onClick={()=>void run(()=>researchWrite(`/api/research-areas/${areaId}/papers`,'POST',{paperId:paper.id}))}>Add paper</button></li>)}</ul><div className="research-pagination"><button type="button" disabled={page===1} onClick={()=>setPage(p=>p-1)}>Previous papers</button><span>Page {state.data.pagination.page} of {Math.max(1,state.data.pagination.totalPages)}</span><button type="button" disabled={page>=state.data.pagination.totalPages} onClick={()=>setPage(p=>p+1)}>Next papers</button></div></>}
  </div>
}

function ModuleSelector({ areaId,run,busy }: { areaId:number;run:Run;busy:boolean }) {
  const coursesReader=useCallback((signal:AbortSignal)=>researchRequest<{courses:Course[]}>('/api/courses',{signal}),[])
  const courses=useCourseRead('published-courses',coursesReader)
  const [selected,setSelected]=useState(''), [moduleId,setModuleId]=useState(0)
  const courseSlug=selected || courses.data?.courses[0]?.slug || ''
  const reader=useCallback((signal:AbortSignal)=>courseSlug ? getCourse(courseSlug,signal) : Promise.resolve(null),[courseSlug])
  const modules=useCourseRead(`modules:${courseSlug}`,reader)
  const selectedId=moduleId || modules.data?.modules[0]?.id || 0
  return <div className="research-selector">
    {courses.loading ? <p role="status">Loading courses…</p> : courses.error ? <><p role="alert">Courses are unavailable.</p><button type="button" onClick={courses.retry}>Retry courses</button></> : !courses.data?.courses.length ? <p>No published courses.</p> : <>
      <div className="research-field"><label htmlFor={`research-course-${areaId}`}>Course</label><select id={`research-course-${areaId}`} value={courseSlug} onChange={e=>{setSelected(e.target.value);setModuleId(0)}}>{courses.data.courses.map(course=><option value={course.slug} key={course.id}>{course.title}</option>)}</select></div>
      {modules.loading ? <p role="status">Loading modules…</p> : modules.error ? <><p role="alert">Modules are unavailable.</p><button type="button" onClick={modules.retry}>Retry modules</button></> : !modules.data?.modules.length ? <p>No published modules in this course.</p> : <><div className="research-field"><label htmlFor={`research-module-${areaId}`}>Learning module</label><select id={`research-module-${areaId}`} value={selectedId} onChange={e=>setModuleId(Number(e.target.value))}>{modules.data.modules.map(module=><option key={module.id} value={module.id}>Module {module.number} · {module.title}</option>)}</select></div><button type="button" disabled={busy || !selectedId} onClick={()=>void run(()=>researchWrite(`/api/research-areas/${areaId}/modules`,'POST',{moduleId:selectedId}))}>Add module</button></>}
    </>}
  </div>
}

function ResourceEditor({ resource,areaId,run,busy }: {resource:ResearchResource;areaId:number;run:Run;busy:boolean}) {
  const [name,setName]=useState(resource.displayName), [access,setAccess]=useState(resource.accessLevel), [description,setDescription]=useState(resource.description ?? '')
  return <form className="research-resource-editor" onSubmit={e=>{e.preventDefault();void run(()=>researchWrite(`/api/research-areas/${areaId}/resources/${resource.id}`,'PATCH',{displayName:name,description,accessLevel:access,expectedVersion:resource.version}))}}>
    <label>Display name<input required value={name} maxLength={300} onChange={e=>setName(e.target.value)} /></label><label>Description<input value={description} maxLength={1000} onChange={e=>setDescription(e.target.value)} /></label>
    <label>Access<select value={access} onChange={e=>setAccess(e.target.value)}><option value="public">Public</option><option value="authenticated">Authenticated</option><option value="staff">Area editors only</option></select></label>
    <div className="research-actions"><button disabled={busy} type="submit">Save resource</button><button disabled={busy} type="button" onClick={()=>void run(()=>researchWrite(`/api/research-areas/${areaId}/resources/${resource.id}`,'DELETE',{expectedVersion:resource.version}))}>Remove resource</button></div>
  </form>
}

function ResourceUpload({areaId,run,busy}:{areaId:number;run:Run;busy:boolean}) {
  const [kind,setKind]=useState('pdf')
  const submit=async(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault(); const form=event.currentTarget, data=new FormData(form)
    const success=await run(()=>kind==='external_link' ? researchWrite(`/api/research-areas/${areaId}/resources/link`,'POST',{attachmentType:kind,displayName:data.get('displayName'),description:data.get('description'),accessLevel:data.get('accessLevel'),externalUrl:data.get('externalUrl')}) : researchRequest(`/api/research-areas/${areaId}/resources`,{method:'POST',body:data}))
    if(success)form.reset()
  }
  return <form className="research-upload" onSubmit={submit}><h3>Add selected resource</h3>
    <label>Resource type<select name="attachmentType" value={kind} onChange={e=>setKind(e.target.value)}><option value="pdf">PDF</option><option value="slides">Slides</option><option value="document">Document</option><option value="cover">Cover image</option><option value="external_link">External link</option></select></label>
    <label>Display name<input required name="displayName" maxLength={300} /></label><label>Description<input name="description" maxLength={1000} /></label>
    <label>Access<select name="accessLevel"><option value="public">Public</option><option value="authenticated">Authenticated</option><option value="staff">Area editors only</option></select></label>
    {kind==='external_link' ? <label>External URL<input name="externalUrl" required type="url" /></label> : <label>File<input required key={kind} type="file" name="file" accept={kind==='pdf'?'.pdf':kind==='slides'?'.pptx':kind==='document'?'.docx':'.png,.jpg,.jpeg'} /></label>}
    {kind==='cover' && <p>Cover images are not listed as learning downloads.</p>}<button disabled={busy} type="submit">Add resource</button>
  </form>
}

function StaffEditor({areaId,revision}:{areaId:number;revision:string}) {
  const [input,setInput]=useState(''),[query,setQuery]=useState(''),[page,setPage]=useState(1),[error,setError]=useState(''),[busy,setBusy]=useState(false)
  const reader=useCallback((signal:AbortSignal)=>researchRequest<{staff:Staff[]}>(`/api/research-areas/${areaId}/staff`,{signal}),[areaId])
  const staff=useCourseRead(`staff:${areaId}:${revision}`,reader)
  const candidatesReader=useCallback((signal:AbortSignal)=>researchRequest<{users:Editor[];total:number}>(`/api/research-areas/editors?q=${encodeURIComponent(query)}&page=${page}`,{signal}),[query,page])
  const candidates=useCourseRead(`editors:${query}:${page}`,candidatesReader)
  const change=async(action:()=>Promise<unknown>)=>{setBusy(true);setError('');try{await action();staff.retry()}catch(e){setError(e instanceof Error?e.message:'Unable to change editors.')}finally{setBusy(false)}}
  return <section className="research-editor-panel"><h2>Area Editors</h2>{error && <p role="alert">{error}</p>}
    {staff.loading ? <p role="status">Loading editors…</p> : staff.error ? <><p role="alert">Editors unavailable.</p><button type="button" onClick={staff.retry}>Retry editors</button></> : !staff.data?.staff.length ? <p>No teachers have been assigned to this area.</p> : <ul>{staff.data.staff.map(row=><li key={row.id}><span>{row.username}{!row.eligible && ' · Inactive or no longer a teacher'}</span><button type="button" disabled={busy} aria-label={`Remove editor: ${row.username}`} onClick={()=>void change(()=>researchWrite(`/api/research-areas/${areaId}/staff/${row.id}`,'DELETE'))}>Remove editor</button></li>)}</ul>}
    <form onSubmit={e=>{e.preventDefault();setQuery(input.trim());setPage(1)}}><label>Search active teachers<input type="search" value={input} onChange={e=>setInput(e.target.value)} /></label><button type="submit">Search teachers</button></form>
    {candidates.loading ? <p role="status">Loading eligible teachers…</p> : candidates.error ? <><p role="alert">Teacher search unavailable.</p><button type="button" onClick={candidates.retry}>Retry teachers</button></> : !candidates.data?.users.length ? <p>No eligible teachers found.</p> : <><ul>{candidates.data.users.map(user=><li key={user.id}><span>{user.username} · {user.email}</span><button disabled={busy} type="button" aria-label={`Assign editor: ${user.username}`} onClick={()=>void change(()=>researchWrite(`/api/research-areas/${areaId}/staff`,'POST',{userId:user.id}))}>Assign editor</button></li>)}</ul><div className="research-pagination"><button disabled={page===1} type="button" onClick={()=>setPage(p=>p-1)}>Previous teachers</button><span>Page {page}</span><button disabled={page*20>=candidates.data.total} type="button" onClick={()=>setPage(p=>p+1)}>Next teachers</button></div></>}
  </section>
}

export default function ResearchManagementPage({currentUser}:{currentUser:AuthUser}) {
  const {areaId}=useParams(), id=areaId?Number(areaId):null
  const {refreshAuth}=useAuth()
  const reader=useCallback((signal:AbortSignal):Promise<ResearchDetail|ResearchArea[]>=>id===null?getResearchList(true,signal):getResearchDetail(id,signal),[id])
  const state=useCourseRead(`manage:${id}:${currentUser.id}:${currentUser.role}`,reader)
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('')
  const run:Run=async action=>{setBusy(true);setError('');setMessage('');try{await action();state.retry();setMessage('Changes saved.');return true}catch(e){setError(e instanceof Error?e.message:'Unable to save changes.');if(e instanceof ResearchError && [401,403].includes(e.status))await refreshAuth();return false}finally{setBusy(false)}}
  const detail=state.data && !Array.isArray(state.data)?state.data:null, areas=Array.isArray(state.data)?state.data:null
  const move=(kind:string,ids:number[],index:number,direction:number)=>{const next=[...ids];[next[index],next[index+direction]]=[next[index+direction],next[index]];void run(()=>researchWrite(`/api/research-areas/${id}/${kind}/order`,'PUT',{relationIds:next}))}
  const orderButtons=(kind:string,ids:number[],index:number,title:string)=><div className="research-actions"><button disabled={busy||index===0} type="button" aria-label={`Move ${title} up`} onClick={()=>move(kind,ids,index,-1)}>Up</button><button disabled={busy||index===ids.length-1} type="button" aria-label={`Move ${title} down`} onClick={()=>move(kind,ids,index,1)}>Down</button></div>
  return <div className="research-management"><header><p className="research-eyebrow">Management · Curated Research</p><h1>{detail?.area.name ?? 'Research Areas'}</h1><p>Maintain the research content assigned to you.</p><Link to="/research">View research overview</Link>{detail && <><Link to="/manage/research-areas">All assigned areas</Link><Link to={researchPath(detail.area.slug)}>View public area</Link></>}</header>
    <p role="status" aria-live="polite">{message}</p>{error && <p role="alert" className="research-management-error">{error}</p>}
    {state.loading ? <p role="status">Loading research workspace…</p> : state.error ? <section className="research-editor-panel"><h2>{state.error==='not-found'?'Research area not found':'Workspace unavailable'}</h2><p>Your account may not have access, or the service is unavailable.</p><button type="button" onClick={state.retry}>Retry workspace</button></section> : areas ? <div className="research-manage-list">{areas.length?areas.map(area=><Link key={area.id} to={`/manage/research-areas/${area.id}`}><span>{area.code} · {area.status}</span><h2>{area.name}</h2><span>Edit area →</span></Link>):<p>No research areas have been assigned to your account.</p>}</div> : detail && <>
      <OverviewEditor key={`${detail.area.id}:${detail.area.updatedAt}`} area={detail.area} run={run} busy={busy} />
      <section className="research-editor-panel"><h2>Related Papers</h2>{!detail.papers.length?<p>No papers associated.</p>:<ol>{detail.papers.map((row,index)=><li key={row.relationId}><Link to={`/papers/${row.paper.slug}`}>{row.paper.title}</Link><small>{row.status}</small>{orderButtons('papers',detail.papers.map(r=>r.relationId),index,row.paper.title)}<button type="button" disabled={busy} aria-label={`Remove paper: ${row.paper.title}`} onClick={()=>void run(()=>researchWrite(`/api/research-areas/${id}/papers/${row.relationId}`,'DELETE'))}>Remove paper</button></li>)}</ol>}<PaperSelector areaId={detail.area.id} run={run} busy={busy} /></section>
      <section className="research-editor-panel"><h2>Related Learning Modules</h2>{!detail.modules.length?<p>No modules associated.</p>:<ol>{detail.modules.map((row,index)=><li key={row.relationId}><span>{row.course.title}</span><strong>Module {row.module.number} · {row.module.title}</strong><small>{row.courseStatus} course / {row.status} module</small>{orderButtons('modules',detail.modules.map(r=>r.relationId),index,row.module.title)}<button disabled={busy} type="button" aria-label={`Remove module: ${row.module.title}`} onClick={()=>void run(()=>researchWrite(`/api/research-areas/${id}/modules/${row.relationId}`,'DELETE'))}>Remove module</button></li>)}</ol>}<ModuleSelector areaId={detail.area.id} run={run} busy={busy} /></section>
      <section className="research-editor-panel"><h2>Selected Resources</h2>{!detail.resources.length?<p>No selected resources.</p>:detail.resources.map((resource,index)=><article className="research-managed-resource" key={`${resource.id}:${resource.version}`}><h3>{resource.displayName}</h3><p>{resource.attachmentType.replaceAll('_',' ')} · Version {resource.version}</p><a href={resource.externalUrl ?? resource.downloadUrl ?? undefined} {...(resource.externalUrl?{target:'_blank',rel:'noopener noreferrer'}:{})}>{resource.externalUrl?'Open external resource ↗':'Download resource'}</a>{orderButtons('resources',detail.resources.map(r=>r.id),index,resource.displayName)}<ResourceEditor resource={resource} areaId={detail.area.id} run={run} busy={busy} /></article>)}<ResourceUpload areaId={detail.area.id} run={run} busy={busy} /></section>
      {currentUser.role==='admin' && <StaffEditor areaId={detail.area.id} revision={detail.area.updatedAt ?? ''} />}
    </>}
  </div>
}
