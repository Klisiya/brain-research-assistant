import { useCallback } from 'react'
import { getCourse, getCourses } from '../../api/courses'
import { useCourseRead } from '../../hooks/useCourseRead'

export default function PaperModuleFilter({course,module,onChange}:{course:string;module:string;onChange:(course:string,module:string)=>void}) {
  const listReader=useCallback((signal:AbortSignal)=>getCourses(signal),[]),courses=useCourseRead('paper-filter-courses',listReader)
  const moduleReader=useCallback((signal:AbortSignal)=>course?getCourse(course,signal):Promise.resolve(null),[course]),modules=useCourseRead(`paper-filter-modules:${course}`,moduleReader)
  return <>
    <label><span>Course</span><select aria-label="Filter by course" value={course} onChange={e=>onChange(e.target.value,'')}><option value="">All Courses</option>{courses.data?.map(c=><option key={c.slug} value={c.slug}>{c.title}</option>)}{course&&!courses.data?.some(c=>c.slug===course)&&<option value={course}>Unavailable course</option>}</select></label>
    <label><span>Module</span><select aria-label="Filter by module" value={module} disabled={!course||modules.loading||Boolean(modules.error)} onChange={e=>onChange(course,e.target.value)}><option value="">All Modules</option>{modules.data?.modules.map(m=><option key={m.slug} value={m.slug}>Module {m.number} · {m.title}</option>)}{module&&!modules.data?.modules.some(m=>m.slug===module)&&<option value={module}>Unavailable module</option>}</select></label>
    {(courses.loading||(course&&modules.loading))&&<p role="status">Loading course filters…</p>}
    {(courses.error||(course&&modules.error))&&<div><p role="alert">Course filters unavailable.</p><button type="button" onClick={()=>{courses.retry();modules.retry()}}>Retry course filters</button></div>}
  </>
}
