import { useCallback, useEffect } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getResearchDetail, getResearchList, researchPath, type ResearchDetail, type ResearchArea } from '../api/research'
import { modulePath } from '../api/courses'
import { useCourseRead } from '../hooks/useCourseRead'
import { useAuth } from '../auth/useAuth'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import PageParticleBackground from '../components/PageParticleBackground'
import './ResearchAreaPage.css'

export default function ResearchAreaPage() {
  const { slug } = useParams()
  const { state: auth } = useAuth()
  const reader = useCallback((signal: AbortSignal): Promise<ResearchDetail | ResearchArea[]> => slug ? getResearchDetail(slug,signal) : getResearchList(false,signal), [slug])
  const state = useCourseRead(`${slug ?? 'list'}:${auth.status}:${auth.user?.id ?? ''}`, reader)
  useEffect(() => { window.scrollTo({top:0,left:0}) }, [slug])
  const detail = state.data && !Array.isArray(state.data) ? state.data : null
  const areas = Array.isArray(state.data) ? state.data : null
  return <div className="app-shell research-page"><PageParticleBackground /><Navbar /><main className="research-main" aria-busy={state.loading}>
    {!state.data ? <section className="research-glass research-status"><p className="research-eyebrow">Research Areas</p><h1>{state.loading ? 'Loading research…' : state.error === 'not-found' ? 'Research area not found' : 'Research unavailable'}</h1><p role={state.error ? 'alert' : 'status'}>{state.loading ? 'Preparing the research content.' : state.error === 'not-found' ? 'This area does not exist or has not been published.' : 'We could not load this content. Please try again.'}</p>{state.error === 'unavailable' && <button onClick={state.retry} type="button">Try again</button>}<Link to="/research">Research overview</Link></section> : detail ? <>
      <nav className="research-breadcrumb" aria-label="Breadcrumb"><Link to="/research">Research Areas</Link><span aria-hidden="true">/</span><span aria-current="page">{detail.area.name}</span></nav>
      <header className={`research-header research-accent-${detail.area.slug}`}><p className="research-eyebrow">{detail.area.code} · Research Area</p><h1>{detail.area.name}</h1><p>{detail.area.overview}</p></header>
      <section className="research-glass research-subtopics"><h2>Subtopics</h2>{detail.area.subtopics.length ? <ul>{detail.area.subtopics.map(topic => <li key={topic}>{topic}</li>)}</ul> : <p>No subtopics have been published yet.</p>}</section>
      <section className="research-section"><h2>Related Papers</h2>{detail.papers.length ? <div className="research-content-grid">{detail.papers.map(({paper}) => paper && <Link className="research-glass research-content-card" to={`/papers/${encodeURIComponent(paper.slug)}`} key={paper.id}><span className="research-eyebrow">Published research</span><h3>{paper.title}</h3><p>{paper.authors.join(', ')}</p><span>Read paper →</span></Link>)}</div> : <p className="research-empty">No published papers have been curated for this area yet.</p>}</section>
      <section className="research-section"><h2>Related Learning Modules</h2>{detail.modules.length ? <div className="research-content-grid">{detail.modules.map(({course,module}) => course && module && <Link className="research-glass research-content-card" to={modulePath(course.slug,module.slug)} key={module.id}><span className="research-eyebrow">Module {String(module.number).padStart(2,'0')} · {module.durationHours} Hours</span><h3>{module.title}</h3><p lang="zh">{module.titleZh}</p><p className="research-course-name">{course.title}</p><span>Explore module →</span></Link>)}</div> : <p className="research-empty">No published learning modules have been curated for this area yet.</p>}</section>
      <section className="research-section"><h2>Selected Learning Resources</h2>{detail.resources.length ? <ul className="research-resource-list research-glass">{detail.resources.map(resource => <li key={resource.id}><a href={resource.externalUrl ?? resource.downloadUrl ?? undefined} {...(resource.externalUrl ? {target:'_blank',rel:'noopener noreferrer'} : {})}>{resource.displayName}{resource.externalUrl && <span> ↗ <span className="research-external">External resource</span></span>}</a><small>{resource.attachmentType.replaceAll('_',' ')} · Version {resource.version}</small>{resource.description && <p>{resource.description}</p>}</li>)}</ul> : <p className="research-empty">No selected learning resources are available to you yet.</p>}</section>
      {detail.brainRegions.length > 0 && <section className="research-section"><h2>Related Brain Anatomy</h2><div className="research-anatomy-links">{detail.brainRegions.map(region => <Link className="research-glass" to={`/brain-region/${encodeURIComponent(region.slug)}`} key={region.slug}>{region.name} →</Link>)}</div></section>}
      <section className="research-section"><h2>Related Hub Content</h2><p className="research-empty">No published Hub content is available yet.</p></section>
    </> : <><header className="research-header"><p className="research-eyebrow">Explore the disciplines</p><h1>Research Areas</h1><p>Explore published research, related learning modules, and selected educational resources.</p></header>{areas?.length ? <div className="research-area-grid">{areas.map(area => <Link className={`research-glass research-area-card research-accent-${area.slug}`} key={area.slug} to={researchPath(area.slug)}><span className="research-eyebrow">{area.code}</span><h2>{area.name}</h2><p>{area.overview}</p><span>Explore area →</span></Link>)}</div> : <p className="research-empty">No research areas have been published yet.</p>}</>}
  </main><Footer /></div>
}
