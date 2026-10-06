import { useEffect, useState } from 'react'
import { getResources, type CourseResource } from '../../api/courses'
import { apiFetch } from '../../api/request'

export function ResourceFallback({ resource }: { resource: CourseResource }) {
  return <div className="mw-file-actions">
    {resource.downloadUrl && <a href={resource.downloadUrl}>Download file</a>}
    {resource.externalUrl && <a href={resource.externalUrl} target="_blank" rel="noopener noreferrer">Open source ↗</a>}
    {!resource.downloadUrl && !resource.externalUrl && <p>No file or source is available.</p>}
  </div>
}

function unavailableReason(resource: CourseResource) {
  if (resource.attachmentType === 'slides') return 'PowerPoint preview is unavailable. Slide conversion is not supported yet.'
  if (resource.mimeType?.startsWith('video/') || resource.attachmentType === 'video') return 'Video preview is unavailable. Video playback is not supported by the current file service.'
  if (resource.mimeType?.startsWith('image/')) return 'Image preview is unavailable. The current course file service does not publish images as learning materials.'
  if (resource.attachmentType === 'document') return 'Word preview is unavailable. Document conversion is not supported yet.'
  return 'Preview is unavailable for this resource. Use the available file or source link.'
}

// Browser PDF handling uses the existing authorized download; no external viewer or conversion.
function PdfPreview({ resource, identity, downloadBase }: { resource: CourseResource; identity: string; downloadBase: string }) {
  const [result, setResult] = useState<{ identity: string; url: string | null; error: boolean }>({ identity: '', url: null, error: false })
  useEffect(() => {
    const controller = new AbortController()
    let objectUrl: string | null = null
    async function load() {
      const response = await apiFetch(resource.downloadUrl!, { signal: controller.signal, cache: 'no-store' })
      if (!response.ok || response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/pdf') throw new Error('PDF unavailable')
      const blob = await response.blob()
      const signature = new TextDecoder().decode(await blob.slice(0, 5).arrayBuffer())
      if (signature !== '%PDF-' || blob.size > 50 * 1024 * 1024) throw new Error('Invalid PDF')
      // Downloads resolve the current asset. Recheck authority/version before labeling its bytes.
      const current = (await getResources(`${downloadBase}/resources`, controller.signal)).find(row => row.id === resource.id)
      if (!current || current.version !== resource.version || current.downloadUrl !== resource.downloadUrl || current.mimeType !== 'application/pdf' || current.attachmentType !== 'pdf') throw new Error('PDF changed or unavailable')
      if (controller.signal.aborted) return
      objectUrl = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }))
      setResult({ identity, url: objectUrl, error: false })
    }
    void load().catch(() => {
      if (!controller.signal.aborted) setResult({ identity, url: null, error: true })
    })
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [identity, downloadBase, resource.id, resource.version, resource.downloadUrl])
  const current = result.identity === identity ? result : null
  if (!current) return <div className="mw-preview-message" role="status">Loading PDF…</div>
  if (current.error || !current.url) return <div className="mw-preview-message"><h3>Preview unavailable</h3><p role="alert">The PDF could not be loaded safely. Access may have changed; reload the materials or use the file link.</p><ResourceFallback resource={resource} /></div>
  return <>
    <div className="mw-preview-caption"><span>Browser PDF preview</span><span>If the viewer is unavailable, use the file link below.</span></div>
    <object className="mw-pdf" data={current.url} type="application/pdf" aria-label={`PDF preview: ${resource.displayName}`}>
      <div className="mw-preview-message"><h3>Preview unavailable</h3><p>This browser cannot display the PDF here.</p></div>
    </object>
    <ResourceFallback resource={resource} />
  </>
}

export default function ModuleResourceViewer({ resource, downloadBase, account }: { resource: CourseResource; downloadBase: string; account: string }) {
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 767px)').matches)
  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)')
    const update = () => setCompact(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  const safeDownload = resource.downloadUrl === `${downloadBase}/resources/${resource.id}/download`
  const pdf = resource.attachmentType === 'pdf' && resource.mimeType === 'application/pdf' && safeDownload && navigator.pdfViewerEnabled && !compact
  return <section className="mw-viewer" aria-labelledby="mw-resource-title">
    <header className="mw-viewer-heading"><p className="mw-eyebrow">{resource.attachmentType.replaceAll('_', ' ')} · Version {resource.version}</p><h2 id="mw-resource-title">{resource.displayName}</h2>{resource.description && <p>{resource.description}</p>}</header>
    {pdf ? <PdfPreview resource={resource} downloadBase={downloadBase} identity={`${account}:${downloadBase}:${resource.id}:${resource.version}`} /> : <div className="mw-preview-message"><h3>Preview unavailable</h3><p>{resource.attachmentType === 'pdf' ? compact ? 'Inline PDF preview is unavailable on small screens. Download the file to open it in your PDF viewer.' : 'This browser cannot display this PDF safely in the workspace.' : unavailableReason(resource)}</p><ResourceFallback resource={resource} /></div>}
  </section>
}
