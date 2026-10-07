import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { deleteAnnotation, getAnnotations, saveAnnotation, type AnnotationItem, type AnnotationKind, type AnnotationSource, type NoteType, type SourceResource } from '../../api/annotations'
import { useAuth } from '../../auth/useAuth'
import { usePersonalState } from '../../hooks/usePersonalState'
import './PaperAnnotations.css'

const noteTypes: { value: NoteType; label: string; prompt: string }[] = [
  {value:'general',label:'General Note',prompt:'Write your own reading note.'},
  {value:'summary',label:'Summary',prompt:'What is the central idea?'},
  {value:'question',label:'Question',prompt:'What remains unclear?'},
  {value:'connection',label:'Connection',prompt:'How does this connect to another concept?'},
  {value:'key_idea',label:'Key Idea',prompt:'What concept is worth remembering?'},
]
type Draft = { item: AnnotationItem | null; title: string; body: string; noteType: NoteType; highlightText: string; comment: string; sourceId: string; sourceVersion: number | null; resources: SourceResource[] }

function SourceLabel({ source }: { source: AnnotationSource }) {
  return <p className="annotation-source">Source: {source.kind === 'paper' ? source.available ? 'Paper' : 'Paper unavailable' : <>{source.displayName ?? 'Resource unavailable'} · Version {source.version}</>}
    {source.state === 'earlier' && <> · Current version {source.currentVersion}</>}
  </p>
}

function PersonalAnnotations({ slug, kind }: { slug: string; kind: AnnotationKind }) {
  const reader = useCallback((signal: AbortSignal) => getAnnotations(slug,kind,signal), [slug,kind])
  const state = usePersonalState(`annotations:${kind}:${slug}`,reader)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [pendingDelete, setPendingDelete] = useState<AnnotationItem | null>(null)
  const firstField = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null)
  const add = useRef<HTMLButtonElement>(null), opener = useRef<HTMLElement | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const isNote = kind === 'notes', noun = isNote ? 'Note' : 'Concept Highlight', title = isNote ? 'Guided Notes' : 'Concept Highlights'
  const draftOpen = draft !== null, editingId = draft?.item?.id
  useEffect(() => { if (draftOpen) firstField.current?.focus() }, [editingId, draftOpen])
  useEffect(() => {
    const element = dialog.current
    if (pendingDelete && element && !element.open) element.showModal()
    return () => { if (element?.open) element.close() }
  }, [pendingDelete])
  const restoreFocus = () => window.queueMicrotask(() => { if (opener.current?.isConnected) opener.current.focus(); else add.current?.focus() })
  const closeDraft = () => { setDraft(null); restoreFocus() }
  const closeDelete = () => { setPendingDelete(null); restoreFocus() }
  const begin = (item: AnnotationItem | null, button: HTMLButtonElement) => {
    opener.current = button
    setDraft({ item, title: item?.kind === 'note' ? item.title : '', body: item?.kind === 'note' ? item.body : '', noteType: item?.kind === 'note' ? item.noteType : 'general',
      highlightText: item?.kind === 'highlight' ? item.highlightText : '', comment: item?.kind === 'highlight' ? item.comment ?? '' : '', sourceId: 'paper', sourceVersion: null, resources: state.data?.resources ?? [] })
  }
  const save = async () => {
    if (!draft) return
    const content = isNote ? { title: draft.title, body: draft.body, noteType: draft.noteType } : { highlightText: draft.highlightText, comment: draft.comment || null }
    const context = draft.item ? { expectedRevision: draft.item.revision } : draft.sourceId === 'paper' ? {} : { attachmentId: Number(draft.sourceId), expectedVersion: draft.sourceVersion! }
    const saved = await state.run(signal => saveAnnotation(slug,kind,{ ...content,...context },signal,draft.item?.id))
    if (saved) closeDraft()
  }
  const remove = async () => {
    if (!pendingDelete) return
    const removed = await state.run(signal => deleteAnnotation(kind,pendingDelete.id,pendingDelete.revision,signal))
    if (removed) closeDelete()
  }
  const cards = (items: AnnotationItem[]) => <ul className="annotation-list">{items.map(item => <li className="annotation-card" key={item.id}>
    {item.kind === 'note' ? <><span className="annotation-type">{noteTypes.find(t => t.value === item.noteType)?.label}</span><h4>{item.title}</h4><p className="annotation-text">{item.body}</p></> : <><p className="annotation-text annotation-concept">{item.highlightText}</p>{item.comment && <p className="annotation-text">{item.comment}</p>}</>}
    <SourceLabel source={item.source} />{item.source.state === 'earlier' && <p className="annotation-history-notice">This {isNote ? 'note' : 'highlight'} belongs to an earlier resource version.</p>}
    <time dateTime={item.updatedAt}>Updated: {new Date(item.updatedAt).toLocaleString('en-US')}</time>
    <div className="personal-actions"><button type="button" disabled={state.busy || Boolean(draft)} aria-label={`Edit ${isNote ? 'note' : 'highlight'}: ${item.kind === 'note' ? item.title : item.highlightText.slice(0,60)}`} onClick={e => begin(item,e.currentTarget)}>Edit</button>
      <button type="button" disabled={state.busy || Boolean(draft)} aria-label={`Delete ${isNote ? 'note' : 'highlight'}: ${item.kind === 'note' ? item.title : item.highlightText.slice(0,60)}`} onClick={e => { opener.current=e.currentTarget; setPendingDelete(item) }}>Delete</button></div>
  </li>)}</ul>
  const items = state.data?.items ?? [], current = items.filter(i => i.source.state === 'current'), earlier = items.filter(i => i.source.state === 'earlier'), unavailable = items.filter(i => i.source.state === 'unavailable')
  return <section className="annotation-panel" aria-label={title}><div className="annotation-heading"><h3>{title}</h3><button ref={add} type="button" disabled={state.loading || Boolean(state.error) || state.busy || Boolean(draft)} onClick={e => begin(null,e.currentTarget)}>Add {noun}</button></div>
    <p>{isNote ? 'Organize your own reading notes.' : 'Save a short concept or excerpt you enter, with an optional personal note.'}</p>
    {state.loading ? <p role="status">Loading {isNote ? 'notes' : 'highlights'}…</p> : state.error ? <div><p role="alert">{title} are unavailable. Your paper content remains accessible.</p><button type="button" onClick={state.retry}>Retry {isNote ? 'notes' : 'highlights'}</button></div> : items.length === 0 ? <p>No {isNote ? 'notes' : 'concept highlights'} yet.</p> : <>
      {current.length > 0 && <div><h4>Current {isNote ? 'notes' : 'highlights'}</h4>{cards(current)}</div>}
      {earlier.length > 0 && <details className="annotation-history"><summary>Earlier Versions</summary>{cards(earlier)}</details>}
      {unavailable.length > 0 && <details className="annotation-history"><summary>Unavailable Sources</summary><p>Your personal text is preserved. The original source cannot be accessed here.</p>{cards(unavailable)}</details>}
    </>}
    {draft && <form className="annotation-form" aria-label={`${draft.item ? 'Edit' : 'Add'} ${noun}`} onSubmit={e => { e.preventDefault(); void save() }} onKeyDown={e => { if (e.key === 'Escape' && !state.busy) { e.preventDefault(); closeDraft() } }}>
      <h4>{draft.item ? 'Edit' : 'Add'} {noun}</h4><fieldset disabled={state.busy}>
        {isNote ? <><label>Note Type<select aria-label="Note Type" value={draft.noteType} onChange={e => setDraft({...draft,noteType:e.target.value as NoteType})}>{noteTypes.map(t => <option value={t.value} key={t.value}>{t.label}</option>)}</select></label>
          <label>Title<input aria-label="Title" ref={element => { firstField.current=element }} required maxLength={200} value={draft.title} onChange={e => setDraft({...draft,title:e.target.value})} /></label>
          <label>Body<textarea aria-label="Body" required rows={5} maxLength={10000} placeholder={noteTypes.find(t => t.value === draft.noteType)?.prompt} value={draft.body} onChange={e => setDraft({...draft,body:e.target.value})} /></label></>
          : <><label>Highlighted concept/text<textarea aria-label="Highlighted concept/text" ref={element => { firstField.current=element }} required rows={3} maxLength={1000} value={draft.highlightText} onChange={e => setDraft({...draft,highlightText:e.target.value})} /></label>
            <label>Optional note<textarea aria-label="Optional note" rows={3} maxLength={2000} value={draft.comment} onChange={e => setDraft({...draft,comment:e.target.value})} /></label></>}
        {draft.item ? <><SourceLabel source={draft.item.source} /><p>Source and recorded version stay unchanged when editing.</p></> : <><label>Source<select aria-label="Source" value={draft.sourceId} onChange={e => setDraft({...draft,sourceId:e.target.value,sourceVersion:draft.resources.find(r => String(r.id) === e.target.value)?.version ?? null})}>
          <option value="paper">Paper</option>{draft.resources.map(r => <option key={r.id} value={String(r.id)}>{r.displayName} · {r.attachmentType.replace('_',' ')} · Version {r.version}</option>)}</select></label>{draft.sourceVersion !== null && <p>Selected source version: {draft.sourceVersion}</p>}</>}
        <div className="personal-actions"><button type="submit">{state.busy ? 'Saving…' : `Save ${noun}`}</button><button type="button" onClick={closeDraft}>Cancel</button></div>
      </fieldset>
    </form>}
    {state.errorMessage && !pendingDelete && <div className="annotation-error"><p role="alert">{state.errorMessage}</p><p>Your draft is kept. After reloading, cancel and reopen the form to use the latest source or revision.</p><button type="button" disabled={state.busy} onClick={state.retry}>Reload list</button></div>}
    <span className="personal-status-message" aria-live="polite">{state.message}</span>
    {pendingDelete && <dialog ref={dialog} className="annotation-dialog" aria-labelledby={`${kind}-delete-title`} onCancel={() => { setPendingDelete(null); restoreFocus() }} onKeyDown={e => {
      if (e.key !== 'Tab') return
      const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
      e.preventDefault()
      if (!buttons.length) return
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
      buttons[index < 0 ? 0 : (index + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length].focus()
    }}><h3 id={`${kind}-delete-title`}>Delete {noun}?</h3><p>This removes only your personal record.</p>
      {state.errorMessage && <p role="alert">{state.errorMessage}</p>}<div className="personal-actions"><button type="button" disabled={state.busy} onClick={() => void remove()}>Delete {noun}</button><button type="button" autoFocus disabled={state.busy} onClick={closeDelete}>Cancel</button></div></dialog>}
  </section>
}

function AnnotationPanel({ slug, kind }: { slug: string; kind: AnnotationKind }) {
  const { state, refreshAuth } = useAuth(), location = useLocation(), title = kind === 'notes' ? 'Guided Notes' : 'Concept Highlights'
  if (state.status === 'authenticated') return <PersonalAnnotations key={`${state.user.id}:${slug}:${kind}`} slug={slug} kind={kind} />
  return <section className="annotation-panel" aria-label={title}><h3>{title}</h3>{state.status === 'anonymous' ? <Link to="/login" state={{from:location.pathname}}>Sign in to use {title.toLowerCase()}</Link> : state.status === 'loading' ? <p role="status">Checking sign-in…</p> : <><p role="alert">Sign-in status unavailable.</p><button type="button" onClick={() => void refreshAuth()}>Retry sign-in</button></>}</section>
}
export function GuidedNotesPanel({ slug }: { slug: string }) { return <AnnotationPanel slug={slug} kind="notes" /> }
export function ConceptHighlightsPanel({ slug }: { slug: string }) { return <AnnotationPanel slug={slug} kind="highlights" /> }
