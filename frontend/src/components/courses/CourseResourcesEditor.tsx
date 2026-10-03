import { useCallback, useState, type FormEvent } from 'react'
import { courseRequest, courseWrite } from '../../api/courseManagement'
import type { CourseResource } from '../../api/courses'
import { useCourseRead } from '../../hooks/useCourseRead'

export type CourseRun = (action: () => Promise<unknown>) => Promise<boolean>
function Metadata({ resource, base, run, busy }: { resource: CourseResource; base: string; run: CourseRun; busy: boolean }) {
  const [name,setName]=useState(resource.displayName),[description,setDescription]=useState(resource.description??''),[access,setAccess]=useState(resource.accessLevel)
  return <form onSubmit={e=>{e.preventDefault();void run(()=>courseWrite(`${base}/${resource.id}`,'PATCH',{displayName:name,description,accessLevel:access,expectedVersion:resource.version}))}}>
    <label>Display name<input required maxLength={300} value={name} onChange={e=>setName(e.target.value)} /></label>
    <label>Description<input maxLength={1000} value={description} onChange={e=>setDescription(e.target.value)} /></label>
    <label htmlFor={`${base}-${resource.id}-access`}>Access</label><select id={`${base}-${resource.id}-access`} value={access} onChange={e=>setAccess(e.target.value)}><option value="public">Public</option><option value="authenticated">Authenticated</option><option value="staff">Course staff only</option></select>
    <div className="course-editor-actions"><button disabled={busy} type="submit">Save resource</button><button disabled={busy} type="button" onClick={()=>void run(()=>courseWrite(`${base}/${resource.id}`,'DELETE',{expectedVersion:resource.version}))}>Remove resource</button></div>
  </form>
}
export default function CourseResourcesEditor({ base, run, busy, title }: { base: string; run: CourseRun; busy: boolean; title: string }) {
  const reader=useCallback((signal:AbortSignal)=>courseRequest<{resources:CourseResource[]}>(base+'/manage',{signal}),[base])
  const state=useCourseRead(base,reader),[kind,setKind]=useState('pdf')
  const change:CourseRun=async action=>{const saved=await run(action);if(saved)state.retry();return saved}
  const submit=async(e:FormEvent<HTMLFormElement>)=>{
    e.preventDefault();const form=e.currentTarget,data=new FormData(form)
    const saved=await change(()=>kind==='external_link'?courseWrite(base+'/manage','POST',{attachmentType:kind,displayName:data.get('displayName'),description:data.get('description'),accessLevel:data.get('accessLevel'),externalUrl:data.get('externalUrl')}):courseRequest(base+'/manage',{method:'POST',body:data}))
    if(saved)form.reset()
  }
  const move=(index:number,direction:number)=>{const ids=state.data!.resources.map(r=>r.id);[ids[index],ids[index+direction]]=[ids[index+direction],ids[index]];void change(()=>courseWrite(base+'/order','PUT',{relationIds:ids}))}
  return <section className="course-editor-panel"><h2>{title}</h2>
    {state.loading?<p role="status">Loading resources…</p>:state.error?<><p role="alert">Resources unavailable.</p><button type="button" onClick={state.retry}>Retry resources</button></>:!state.data?.resources.length?<p>No resources added.</p>:state.data.resources.map((r,i)=><article className="course-managed-resource" key={`${r.id}:${r.version}`}><h3>{r.displayName}</h3><p>{r.attachmentType} · Version {r.version}</p><a href={r.externalUrl??r.downloadUrl??undefined} {...(r.externalUrl?{target:'_blank',rel:'noopener noreferrer'}:{})}>{r.externalUrl?'Open external resource ↗':'Download resource'}</a><div className="course-editor-actions"><button disabled={busy||i===0} type="button" aria-label={`Move ${r.displayName} up`} onClick={()=>move(i,-1)}>Up</button><button disabled={busy||i===state.data!.resources.length-1} type="button" aria-label={`Move ${r.displayName} down`} onClick={()=>move(i,1)}>Down</button></div><Metadata resource={r} base={base} run={change} busy={busy} /></article>)}
    <form className="course-resource-upload" onSubmit={submit}><h3>Add resource</h3>
      <label htmlFor={`${base}-kind`}>Resource type</label><select id={`${base}-kind`} name="attachmentType" value={kind} onChange={e=>setKind(e.target.value)}><option value="pdf">PDF</option><option value="slides">Slides</option><option value="document">Document</option><option value="cover">Cover image</option><option value="external_link">External link</option></select>
      <label>Display name<input required name="displayName" maxLength={300} /></label><label>Description<input name="description" maxLength={1000} /></label>
      <label htmlFor={`${base}-access`}>Access</label><select id={`${base}-access`} name="accessLevel"><option value="public">Public</option><option value="authenticated">Authenticated</option><option value="staff">Course staff only</option></select>
      {kind==='external_link'?<label>External URL<input type="url" required name="externalUrl" /></label>:<label>File<input type="file" required name="file" key={kind} accept={kind==='pdf'?'.pdf':kind==='slides'?'.pptx':kind==='document'?'.docx':'.png,.jpg,.jpeg'} /></label>}
      {kind==='cover'&&<p>Cover images are not listed as learning downloads.</p>}<button type="submit" disabled={busy}>Add resource</button>
    </form>
  </section>
}
