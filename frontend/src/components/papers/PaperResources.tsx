import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { fetchAttachmentFile, fetchManagedAttachments, fetchPublicAttachments, PaperApiError } from '../../api/papers'
import { SESSION_EXPIRED_EVENT } from '../../api/session'
import { useAuth } from '../../auth/useAuth'
import type { PaperAttachment } from '../../types/paper'
import { ACCESS_LABELS, ATTACHMENT_LABELS, attachmentError, externalResourceUrl, formatFileSize } from './attachmentPresentation'
import './PaperResources.css'
type ResourceActionError = { message: string; signIn: boolean }
function ResourceFileActions({ attachment, onError }: { attachment: PaperAttachment; onError: (error: ResourceActionError) => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [signIn, setSignIn] = useState(false)
  const active = useRef<AbortController | null>(null), location = useLocation()
  useEffect(() => () => active.current?.abort(), [])
  const open = async (download: boolean) => {
    if (active.current) return
    const preview = download ? null : window.open('about:blank', '_blank')
    if (preview) { preview.opener = null; preview.document.body.textContent = 'Loading resource...' }
    if (!download && !preview) { setError('Allow a new tab to view this resource, or use Download.'); return }
    const controller = new AbortController()
    active.current = controller; setBusy(true); setError(null); setSignIn(false)
    try {
      const { blob, filename } = await fetchAttachmentFile(attachment, download, controller.signal)
      if (controller.signal.aborted) { preview?.close(); return }
      const url = URL.createObjectURL(blob)
      if (preview) preview.location.replace(url)
      else {
        const anchor = document.createElement('a')
        anchor.href = url; anchor.download = filename; document.body.append(anchor); anchor.click(); anchor.remove()
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 60000)
    } catch (error: unknown) {
      preview?.close()
      if (!controller.signal.aborted) {
        const message = attachmentError(error), expired = error instanceof PaperApiError && error.status === 401
        setError(message); setSignIn(expired); onError({ message, signIn: expired })
      }
    } finally { active.current = null; if (!controller.signal.aborted) setBusy(false) }
  }
  return <div className="resource-file-actions">
    <div className="resource-actions">
      {attachment.attachmentType === 'pdf' || attachment.attachmentType === 'cover' ? <button type="button" disabled={busy} onClick={() => void open(false)} aria-label={`View ${attachment.displayName}`}>{attachment.attachmentType === 'cover' ? 'View Image' : 'View'}</button> : null}
      <button type="button" disabled={busy} onClick={() => void open(true)} aria-label={`Download ${attachment.displayName}`}>{busy ? 'Opening...' : 'Download'}</button>
    </div>
    {error ? <p className="resource-error" role="alert">{error}</p> : null}
    {signIn ? <Link state={{ from: location.pathname }} to="/login">Sign In</Link> : null}
  </div>
}
function ResourceCard({ item, onError }: { item: PaperAttachment; onError: (error: ResourceActionError) => void }) {
  const external = externalResourceUrl(item.externalUrl)
  return <li className="resource-card">
    <div className="resource-card-copy">
      <div className="resource-badges"><span>{ATTACHMENT_LABELS[item.attachmentType]}</span><span>{ACCESS_LABELS[item.accessLevel]}</span>{item.fileSize !== null ? <span>{formatFileSize(item.fileSize)}</span> : null}</div>
      <h3>{item.displayName}</h3>{item.description ? <p>{item.description}</p> : null}
    </div>
    {item.attachmentType === 'external_link' ? external ? <div className="resource-actions"><a href={external} target="_blank" rel="noopener noreferrer" aria-label={`Open ${item.displayName} (external resource, opens in a new tab)`}>Open Resource ↗</a></div> : <p>Resource link unavailable.</p>
      : item.downloadUrl ? <ResourceFileActions attachment={item} onError={onError} /> : <p>File unavailable.</p>}
  </li>
}
export default function PaperResources({ paperId, slug, managed = false }: { paperId: number; slug: string; managed?: boolean }) {
  const { state } = useAuth()
  const location = useLocation()
  const [actionError, setActionError] = useState<ResourceActionError | null>(null)
  const [version, setVersion] = useState(0)
  const [result, setResult] = useState<{ key: string; items: PaperAttachment[] | null; error: string | null } | null>(null)
  useEffect(() => {
    const expired = () => setActionError({ message: 'Your session has expired. Please sign in again.', signIn: true })
    window.addEventListener(SESSION_EXPIRED_EVENT, expired)
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, expired)
  }, [])
  const authKey = `${state.status}:${state.user?.id ?? ''}:${state.user?.role ?? ''}`
  const key = `${managed ? paperId : slug}:${managed}:${authKey}:${version}`
  const current = result?.key === key ? result : null
  useEffect(() => {
    if (state.status === 'loading') return
    const controller = new AbortController()
    const request = managed ? fetchManagedAttachments(paperId, { signal: controller.signal }) : fetchPublicAttachments(slug, { signal: controller.signal })
    request.then(items => { if (!controller.signal.aborted) setResult({ key, items, error: null }) })
      .catch((error: unknown) => { if (!controller.signal.aborted) setResult({ key, items: null, error: attachmentError(error) }) })
    return () => controller.abort()
  }, [key, managed, paperId, slug, state.status])
  const files = current?.items?.filter(item => item.attachmentType !== 'cover') ?? []
  const covers = current?.items?.filter(item => item.attachmentType === 'cover') ?? []
  return <section className="paper-detail-block paper-resources" aria-labelledby="paper-resources-heading" key={authKey}>
    <span>Reading Materials</span><h2 id="paper-resources-heading">Resources</h2>
    {actionError?.signIn ? <div role="alert"><p>{actionError.message}</p><Link state={{ from: location.pathname, managementRequired: managed }} to="/login">Sign In</Link></div> : null}
    {managed ? <p>Management preview · Resources for this paper, including unpublished content.</p> : null}
    {!current ? <p role="status" aria-busy="true">Loading resources...</p> : current.error ? <div role="alert"><p>{current.error}</p><button onClick={() => setVersion(value => value + 1)} type="button">Retry Resources</button></div>
      : current.items?.length ? <>
        {files.length ? <ul className="resource-list">{files.map(item => <ResourceCard item={item} key={item.id} onError={setActionError} />)}</ul> : null}
        {covers.length ? <div className="resource-covers"><h3>Cover Artwork</h3><ul className="resource-list">{covers.map(item => <ResourceCard item={item} key={item.id} onError={setActionError} />)}</ul></div> : null}
      </> : <p className="resource-empty">No resources are available for this paper.</p>}
  </section>
}
