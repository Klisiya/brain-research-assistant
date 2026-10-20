import { useCallback, useRef, useState, type FormEvent } from 'react'
import { courseRequest, courseWrite } from '../../api/courseManagement'
import type { CourseResource } from '../../api/courses'
import { useManagementRead as useCourseRead } from '../management/useManagementRead'
import { useUnsavedChanges, useEditorMounted } from '../management/useUnsavedChanges'
import { useUnsavedForm } from '../management/useUnsavedForm'

export type CourseRun = (action: () => Promise<unknown>) => Promise<boolean>
type ManagedResource = CourseResource & { updatedAt: string }
const editToken = (resource: ManagedResource) => ({ expectedVersion:resource.version, expectedUpdatedAt:resource.updatedAt })
function Metadata({ resource, base, run, busy }: { resource: ManagedResource; base: string; run: CourseRun; busy: boolean }) {
  const [name,setName]=useState(resource.displayName),[description,setDescription]=useState(resource.description??''),[access,setAccess]=useState(resource.accessLevel)
  const value=JSON.stringify({name,description,access}),[baseline,setBaseline]=useState(value),isMounted=useEditorMounted()
  const [token,setToken]=useState(editToken(resource)),[observed,setObserved]=useState(resource.updatedAt)
  // Keep dirty inputs paired with the version they were edited against.
  if(!busy && value===baseline && resource.updatedAt!==observed){setObserved(resource.updatedAt);setToken(editToken(resource));setName(resource.displayName);setDescription(resource.description??'');setAccess(resource.accessLevel);setBaseline(JSON.stringify({name:resource.displayName,description:resource.description??'',access:resource.accessLevel}))}
  useUnsavedChanges(value!==baseline,busy)
  return <form onSubmit={async e=>{e.preventDefault();await run(async()=>{await courseWrite(`${base}/${resource.id}`,'PATCH',{displayName:name,description,accessLevel:access,...token});const result=await courseRequest<{resources:ManagedResource[]}>(base+'/manage'),fresh=result.resources.find(row=>row.id===resource.id);if(!fresh)throw new Error('Resource changed. Refresh before editing.');if(isMounted()){setName(fresh.displayName);setDescription(fresh.description??'');setAccess(fresh.accessLevel);setToken(editToken(fresh));setBaseline(JSON.stringify({name:fresh.displayName,description:fresh.description??'',access:fresh.accessLevel}))}})}}>
    <label>Display name<input disabled={busy} required maxLength={300} value={name} onChange={e=>setName(e.target.value)} /></label>
    <label>Description<input disabled={busy} maxLength={1000} value={description} onChange={e=>setDescription(e.target.value)} /></label>
    <label htmlFor={`${base}-${resource.id}-access`}>Access</label><select disabled={busy} id={`${base}-${resource.id}-access`} value={access} onChange={e=>setAccess(e.target.value)}><option value="public">Public</option><option value="authenticated">Authenticated</option><option value="staff">Course staff only</option></select>
    <div className="course-editor-actions"><button disabled={busy} type="submit">Save resource</button><button disabled={busy} type="button" onClick={()=>void run(()=>courseWrite(`${base}/${resource.id}`,'DELETE',editToken(resource)))}>Remove resource</button></div>
  </form>
}
function Replacement({ resource, base, run, busy }: { resource: ManagedResource; base: string; run: CourseRun; busy: boolean }) {
  const link=resource.attachmentType==='external_link', formRef=useRef<HTMLFormElement>(null)
  const formGuard=useUnsavedForm(formRef,busy,undefined,resource.updatedAt),isMounted=useEditorMounted(),[token,setToken]=useState(editToken(resource)),[observed,setObserved]=useState(resource.updatedAt)
  if(!busy && !formGuard.dirty && resource.updatedAt!==observed){setObserved(resource.updatedAt);setToken(editToken(resource))}
  return <details><summary>Replace content</summary><p>A different file or link target creates a new content version. Earlier learning history is preserved.</p>
    <form ref={formRef} aria-label={`Replace ${resource.displayName}`} onSubmit={e=>{
      e.preventDefault();const form=e.currentTarget,data=new FormData(form)
      data.set('expectedVersion',String(token.expectedVersion));data.set('expectedUpdatedAt',token.expectedUpdatedAt)
      void run(async()=>{if(link)await courseWrite(`${base}/${resource.id}`,'PUT',{...token,externalUrl:data.get('externalUrl')});else await courseRequest(`${base}/${resource.id}`,{method:'PUT',body:data});const result=await courseRequest<{resources:ManagedResource[]}>(base+'/manage'),fresh=result.resources.find(row=>row.id===resource.id);if(!fresh)throw new Error('Resource changed. Refresh before replacing.');if(isMounted()){setToken(editToken(fresh));form.reset();const input=form.querySelector<HTMLInputElement>('input[name=externalUrl]');if(input)input.value=fresh.externalUrl??'';formGuard.saved()}})
    }}>{link?<label>Replacement URL<input disabled={busy} type="url" name="externalUrl" required defaultValue={resource.externalUrl??''} /></label>:<label>Replacement file<input disabled={busy} type="file" name="file" required accept={resource.attachmentType==='pdf'?'.pdf':resource.attachmentType==='slides'?'.pptx':resource.attachmentType==='document'?'.docx':'.png,.jpg,.jpeg,.webp'} /></label>}
      <button disabled={busy} type="submit">Replace content</button>
    </form></details>
}
export default function CourseResourcesEditor({ base, run, busy, title }: { base: string; run: CourseRun; busy: boolean; title: string }) {
  const reader=useCallback((signal:AbortSignal)=>courseRequest<{resources:ManagedResource[]}>(base+'/manage',{signal}),[base])
  const state=useCourseRead(base,reader,true),[kind,setKind]=useState('pdf'),formRef=useRef<HTMLFormElement>(null)
  const formGuard=useUnsavedForm(formRef,busy), isMounted=useEditorMounted()
  const change:CourseRun=async action=>{const saved=await run(action);if(saved && isMounted())state.retry();return saved}
  const submit=async(e:FormEvent<HTMLFormElement>)=>{
    e.preventDefault();const form=e.currentTarget,data=new FormData(form)
    const saved=await change(()=>kind==='external_link'?courseWrite(base+'/manage','POST',{attachmentType:kind,displayName:data.get('displayName'),description:data.get('description'),accessLevel:data.get('accessLevel'),externalUrl:data.get('externalUrl')}):courseRequest(base+'/manage',{method:'POST',body:data}))
    if(saved && isMounted()){form.reset();formGuard.saved()}
  }
  const move=(index:number,direction:number)=>{const ids=state.data!.resources.map(r=>r.id);[ids[index],ids[index+direction]]=[ids[index+direction],ids[index]];void change(()=>courseWrite(base+'/order','PUT',{relationIds:ids}))}
  return <section className="course-editor-panel"><h2>{title}</h2>
    {state.loading?<p role="status">Loading resources…</p>:state.error&&!state.data?<><p role="alert">Resources unavailable.</p><button type="button" onClick={state.retry}>Retry resources</button></>:!state.data?.resources.length?<p>No resources added.</p>:state.data.resources.map((r,i)=><article className="course-managed-resource" key={r.id}><h3>{r.displayName}</h3><p>{r.attachmentType} · Version {r.version}</p><a href={r.externalUrl??r.downloadUrl??undefined} {...(r.externalUrl?{target:'_blank',rel:'noopener noreferrer'}:{})}>{r.externalUrl?'Open external resource ↗':'Download resource'}</a><div className="course-editor-actions"><button disabled={busy||i===0} type="button" aria-label={`Move ${r.displayName} up`} onClick={()=>move(i,-1)}>Up</button><button disabled={busy||i===state.data!.resources.length-1} type="button" aria-label={`Move ${r.displayName} down`} onClick={()=>move(i,1)}>Down</button></div><Metadata resource={r} base={base} run={change} busy={busy} /><Replacement resource={r} base={base} run={change} busy={busy} /></article>)}
    <form ref={formRef} className="course-resource-upload" onSubmit={submit}><h3>Add resource</h3>
      <label htmlFor={`${base}-kind`}>Resource type</label><select disabled={busy} id={`${base}-kind`} name="attachmentType" value={kind} onChange={e=>{const next=e.target.value;const form=formRef.current;const losesContent=Boolean(form?.querySelector<HTMLInputElement>('input[type=file]')?.files?.length || form?.querySelector<HTMLInputElement>('input[name=externalUrl]')?.value);if(losesContent)formGuard.requestExit(()=>setKind(next));else setKind(next)}}><option value="pdf">PDF</option><option value="slides">Slides</option><option value="document">Document</option><option value="cover">Cover image</option><option value="external_link">External link</option></select>
      <label>Display name<input disabled={busy} required name="displayName" maxLength={300} /></label><label>Description<input disabled={busy} name="description" maxLength={1000} /></label>
      <label htmlFor={`${base}-access`}>Access</label><select disabled={busy} id={`${base}-access`} name="accessLevel"><option value="public">Public</option><option value="authenticated">Authenticated</option><option value="staff">Course staff only</option></select>
      {kind==='external_link'?<label>External URL<input disabled={busy} type="url" required name="externalUrl" /></label>:<label>File<input disabled={busy} type="file" required name="file" key={kind} accept={kind==='pdf'?'.pdf':kind==='slides'?'.pptx':kind==='document'?'.docx':'.png,.jpg,.jpeg'} /></label>}
      {kind==='cover'&&<p>Cover images are not listed as learning downloads.</p>}<button type="submit" disabled={busy}>Add resource</button>
    </form>
  </section>
}
