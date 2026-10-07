import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth'
import { fetchPublicAttachments } from '../../api/papers'
import BookmarkControl from '../learning/BookmarkControl'
import PaperReadingControls from '../learning/PaperReadingControls'
import { GuidedNotesPanel, ConceptHighlightsPanel } from '../learning/PaperAnnotations'
import type { PaperReadingController } from '../../hooks/usePaperReading'
import type { Paper, PaperAttachment } from '../../types/paper'
import { ATTACHMENT_LABELS, attachmentError, externalResourceUrl } from './attachmentPresentation'
import PaperAttachmentReader from './PaperAttachmentReader'
import './PaperReadingWorkspace.css'

function useCompactTools() {
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 1099px)').matches)
  useEffect(() => {
    const media = window.matchMedia('(max-width: 1099px)')
    const update = () => setCompact(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  return compact
}

const tools = ['Progress', 'Notes', 'Highlights'] as const

function StudyTools({ paper, reading, attachment, compact }: { paper: Paper; reading: PaperReadingController; attachment: PaperAttachment | null; compact: boolean }) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<(typeof tools)[number]>('Progress')
  const dialog = useRef<HTMLDialogElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const close = () => { setOpen(false); window.queueMicrotask(() => trigger.current?.focus()) }
  useEffect(() => {
    const element = dialog.current!
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (element.open) element.close()
    if (compact && open) element.showModal()
    else if (!compact) { element.open = true; previous?.focus() }
    const original = document.body.style.overflow
    if (compact && open) document.body.style.overflow = 'hidden'
    return () => { element.close(); document.body.style.overflow = original }
  }, [compact, open])
  return <>
    <button ref={trigger} className="pr-tools-trigger" type="button" aria-haspopup="dialog" aria-controls="pr-study-tools" aria-expanded={open} onClick={() => setOpen(true)}>Study tools</button>
    <dialog ref={dialog} id="pr-study-tools" className="pr-study-tools" aria-labelledby="pr-tools-title" onCancel={event => {
      if (event.target !== event.currentTarget) return
      event.preventDefault(); close()
    }} onKeyDown={event => {
      if (!compact || event.key !== 'Tab' || event.defaultPrevented || (event.target as HTMLElement).closest('dialog') !== event.currentTarget) return
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]')).filter(element => element.getClientRects().length > 0)
      const first = controls[0], last = controls[controls.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }}>
      <div className="pr-tools-heading"><h2 id="pr-tools-title">Study tools</h2><button type="button" className="pr-tools-close" onClick={close}>Close tools</button></div>
      <p className="pr-private">Your personal reading record</p>
      <BookmarkControl targetType="paper" targetId={paper.id} showSignInPrompt={false} />
      <div className="pr-tool-tabs" role="tablist" aria-label="Paper study tools">
        {tools.map((name, index) => <button key={name} type="button" role="tab" id={`pr-tab-${name}`} aria-selected={tab === name} aria-controls={`pr-panel-${name}`} tabIndex={tab === name ? 0 : -1} onClick={() => setTab(name)} onKeyDown={event => {
          const offset = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
          if (!offset && event.key !== 'Home' && event.key !== 'End') return
          event.preventDefault()
          const next = event.key === 'Home' ? tools[0] : event.key === 'End' ? tools[tools.length - 1] : tools[(index + offset + tools.length) % tools.length]
          setTab(next); document.getElementById(`pr-tab-${next}`)?.focus()
        }}>{name}</button>)}
      </div>
      <div role="tabpanel" id="pr-panel-Progress" aria-labelledby="pr-tab-Progress" hidden={tab !== 'Progress'} tabIndex={0}>
        <PaperReadingControls state={reading} slug={paper.slug} />
        {attachment && attachment.attachmentType !== 'cover' && <div className="pr-resource-progress"><h3>Selected Resource Progress</h3><p>{attachment.displayName}</p><PaperReadingControls state={reading} slug={paper.slug} attachment={attachment} /></div>}
        <p className="pr-completion-note">Opening, scrolling or viewing a file does not mark it as read.</p>
        <p className="pr-unavailable">Knowledge Check · Unavailable. Assessment is not supported yet.</p>
      </div>
      <div role="tabpanel" id="pr-panel-Notes" aria-labelledby="pr-tab-Notes" hidden={tab !== 'Notes'} tabIndex={0}><GuidedNotesPanel slug={paper.slug} /></div>
      <div role="tabpanel" id="pr-panel-Highlights" aria-labelledby="pr-tab-Highlights" hidden={tab !== 'Highlights'} tabIndex={0}><ConceptHighlightsPanel slug={paper.slug} /></div>
    </dialog>
  </>
}

export default function PaperReadingWorkspace({ paper, reading, returnPath, citation, publishedDate, onCopyCitation, copyState }: {
  paper: Paper; reading: PaperReadingController; returnPath: string; citation: string; publishedDate: string | null; onCopyCitation: () => void; copyState: 'copied' | 'failed' | null
}) {
  const { state: auth } = useAuth()
  const account = `${auth.status}:${auth.user?.id ?? ''}:${auth.user?.role ?? ''}`
  const [version, setVersion] = useState(0)
  const [result, setResult] = useState<{ key: string; items: PaperAttachment[] | null; error: string | null } | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const key = `${paper.slug}:${account}:${version}`
  const current = result?.key === key ? result : null
  useEffect(() => {
    if (auth.status === 'loading' || auth.status === 'unavailable') return
    const controller = new AbortController()
    void fetchPublicAttachments(paper.slug, { signal: controller.signal }).then(items => {
      if (!controller.signal.aborted) setResult({ key, items, error: null })
    }).catch(error => { if (!controller.signal.aborted) setResult({ key, items: null, error: attachmentError(error) }) })
    return () => controller.abort()
  }, [key, paper.slug, auth.status])
  const items = current?.items ?? []
  const attachment = items.find(item => item.id === selectedId) ?? items.find(item => item.attachmentType === 'pdf') ?? items.find(item => item.attachmentType !== 'cover') ?? items[0] ?? null
  const compact = useCompactTools()
  const source = externalResourceUrl(paper.externalUrl)
  return <article className="pr-workspace">
    <Link className="pr-back" to={returnPath}>← {returnPath.startsWith('/course/') ? 'Back to Module' : 'Back to Paper Library'}</Link>
    <header className="pr-header"><p className="pr-eyebrow">Paper reading</p><h1>{paper.title || 'Untitled paper'}</h1>
      {paper.authors.length > 0 && <p className="pr-authors">{paper.authors.join(', ')}</p>}
      <p className="pr-publication">{[paper.journal, paper.year, paper.publicationType].filter(Boolean).join(' · ') || 'Publication details unavailable'}</p>
    </header>
    <div className="pr-layout">
      <div className="pr-reading-column">
        <section className="pr-reading-surface" aria-label="Paper reading area">
          <div className="pr-reading-heading"><h2>Reading material</h2><button type="button" onClick={() => setVersion(value => value + 1)}>Refresh materials</button></div>
          {auth.status === 'unavailable' ? <p role="alert">Sign-in status unavailable. Retry sign-in in the study tools to load authorized materials.</p>
            : !current ? <p role="status">Loading authorized materials…</p> : current.error ? <p role="alert">{current.error}</p>
              : attachment ? <>
                <label className="pr-material-select">Material<select value={attachment.id} onChange={event => setSelectedId(Number(event.target.value))}>{items.map(item => <option key={item.id} value={item.id}>{item.displayName} · {ATTACHMENT_LABELS[item.attachmentType]} · v{item.version}</option>)}</select></label>
                <PaperAttachmentReader key={`${key}:${attachment.id}:${attachment.version}`} attachment={attachment} slug={paper.slug} identity={key} />
              </> : <div className="pr-empty-material"><h3>Full text unavailable</h3><p>No attachments are available for this paper.</p>{source && <a href={source} target="_blank" rel="noopener noreferrer">Open external source ↗</a>}</div>}
          {paper.abstract.trim() && <section className="pr-abstract"><h2>Abstract</h2><p>{paper.abstract}</p></section>}
        </section>
        <details className="pr-metadata"><summary>Paper details &amp; citation</summary><div>
          <dl>{paper.estimatedReadingMinutes > 0 && <div><dt>Reading time</dt><dd>{paper.estimatedReadingMinutes} min</dd></div>}
            <div><dt>Access</dt><dd>{paper.openAccess ? 'Open Access' : 'Guided Access'}</dd></div>
            {publishedDate && <div><dt>Published</dt><dd>{publishedDate}</dd></div>}
            {paper.publisher && <div><dt>Publisher</dt><dd>{paper.publisher}</dd></div>}
            {paper.volume && <div><dt>Volume</dt><dd>{paper.volume}</dd></div>}
            {paper.issue && <div><dt>Issue</dt><dd>{paper.issue}</dd></div>}
            {paper.pages && <div><dt>Pages</dt><dd>{paper.pages}</dd></div>}
            {paper.doi && <div><dt>DOI</dt><dd><a href={`https://doi.org/${encodeURIComponent(paper.doi)}`} target="_blank" rel="noopener noreferrer">{paper.doi}</a></dd></div>}
            {paper.difficulty && <div><dt>Difficulty</dt><dd>{paper.difficulty}</dd></div>}
            {paper.resourceCategory && <div><dt>Category</dt><dd>{paper.resourceCategory}</dd></div>}
            {paper.topics.length > 0 && <div><dt>Topics</dt><dd>{paper.topics.join(' · ')}</dd></div>}
            {paper.keywords.length > 0 && <div><dt>Keywords</dt><dd>{paper.keywords.join(' · ')}</dd></div>}
          </dl>
          {paper.learningObjectives.length > 0 && <section><h3>Learning objectives</h3><ul>{paper.learningObjectives.map((objective, index) => <li key={index}>{objective}</li>)}</ul></section>}
          <h3>Citation</h3><p>{citation}</p><button type="button" onClick={onCopyCitation}>Copy Citation</button><span className="pr-copy-status" aria-live="polite">{copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Could not copy citation.' : ''}</span>
          {source && <p><a href={source} target="_blank" rel="noopener noreferrer">Open external source ↗</a></p>}
        </div></details>
      </div>
      <StudyTools key={`${paper.slug}:${account}`} paper={paper} reading={reading} attachment={attachment} compact={compact} />
    </div>
  </article>
}
