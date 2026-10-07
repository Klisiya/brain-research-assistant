import { useEffect, useRef, useState } from 'react'
import { fetchAttachmentFile, fetchPublicAttachments } from '../../api/papers'
import type { PaperAttachment } from '../../types/paper'
import { ACCESS_LABELS, ATTACHMENT_LABELS, attachmentError, externalResourceUrl, formatFileSize } from './attachmentPresentation'

function safeFileUrl(item: PaperAttachment, slug: string) {
  return item.downloadUrl === `/api/papers/${encodeURIComponent(slug)}/attachments/${item.id}/download`
}

async function readCurrentFile(item: PaperAttachment, slug: string, download: boolean, signal: AbortSignal) {
  if (!safeFileUrl(item, slug)) throw new Error('Unsafe file URL')
  const file = await fetchAttachmentFile(item, download, signal)
  // The download endpoint resolves the current asset; confirm its version and authority again.
  const latest = (await fetchPublicAttachments(slug, { signal })).find(row => row.id === item.id)
  if (!latest || latest.version !== item.version || latest.downloadUrl !== item.downloadUrl || latest.mimeType !== item.mimeType || latest.attachmentType !== item.attachmentType) throw new Error('File changed or unavailable')
  return file
}

function AttachmentDownload({ attachment, slug }: { attachment: PaperAttachment; slug: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const active = useRef<AbortController | null>(null)
  const urls = useRef(new Map<string, number>())
  useEffect(() => {
    const currentUrls = urls.current
    return () => { active.current?.abort(); for (const [url, timer] of currentUrls) { window.clearTimeout(timer); URL.revokeObjectURL(url) } currentUrls.clear() }
  }, [])
  const download = async () => {
    if (active.current) return
    const controller = new AbortController()
    active.current = controller; setBusy(true); setError(null)
    try {
      const { blob, filename } = await readCurrentFile(attachment, slug, true, controller.signal)
      if (controller.signal.aborted) return
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove()
      urls.current.set(url, window.setTimeout(() => { URL.revokeObjectURL(url); urls.current.delete(url) }, 60000))
    } catch (error) { if (!controller.signal.aborted) setError(attachmentError(error)) }
    finally { if (active.current === controller) active.current = null; if (!controller.signal.aborted) setBusy(false) }
  }
  if (!safeFileUrl(attachment, slug)) return <p>File unavailable.</p>
  return <div className="pr-file-actions"><button type="button" disabled={busy} onClick={() => void download()}>{busy ? 'Downloading…' : 'Download file'}</button>{error && <p role="alert">{error} Refresh materials before trying again.</p>}</div>
}

function InlinePreview({ attachment, slug, image }: { attachment: PaperAttachment; slug: string; image: boolean }) {
  const [result, setResult] = useState<{ url: string | null; error: boolean } | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    let objectUrl: string | null = null
    async function load() {
      const { blob } = await readCurrentFile(attachment, slug, false, controller.signal)
      const mime = blob.type.split(';')[0].toLowerCase()
      if (mime !== attachment.mimeType || !blob.size || blob.size > (image ? 8 : 50) * 1024 * 1024) throw new Error('Invalid file')
      const bytes = new Uint8Array(await blob.slice(0, 12).arrayBuffer())
      if (!image && new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-') throw new Error('Invalid PDF')
      if (image && !(
        mime === 'image/png' && bytes.slice(0, 8).join(',') === '137,80,78,71,13,10,26,10'
        || mime === 'image/jpeg' && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        || mime === 'image/webp' && new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP'
      )) throw new Error('Invalid image')
      if (controller.signal.aborted) return
      objectUrl = URL.createObjectURL(new Blob([blob], { type: mime }))
      setResult({ url: objectUrl, error: false })
    }
    void load().catch(() => { if (!controller.signal.aborted) setResult({ url: null, error: true }) })
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [attachment, slug, image])
  if (!result) return <p role="status">Loading authorized preview…</p>
  if (result.error || !result.url) return <div className="pr-preview-fallback"><h3>Preview unavailable</h3><p role="alert">The file could not be loaded safely. Access or its version may have changed. Refresh materials or try the authorized download.</p></div>
  return image ? <img className="pr-image" src={result.url} alt={attachment.displayName} onError={() => {
    URL.revokeObjectURL(result.url!)
    setResult({ url: null, error: true })
  }} /> : <>
    <p className="pr-preview-caption">Browser PDF preview. If your browser cannot display it, use Download file.</p>
    <object className="pr-pdf" data={result.url} type="application/pdf" aria-label={`PDF preview: ${attachment.displayName}`}><p>PDF preview unavailable in this browser. Use Download file.</p></object>
  </>
}

export default function PaperAttachmentReader({ attachment, slug, identity }: { attachment: PaperAttachment; slug: string; identity: string }) {
  const [small, setSmall] = useState(() => window.matchMedia('(max-width: 767px)').matches)
  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)')
    const update = () => setSmall(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  const image = attachment.attachmentType === 'cover' && ['image/png', 'image/jpeg', 'image/webp'].includes(attachment.mimeType ?? '')
  const pdf = attachment.attachmentType === 'pdf' && attachment.mimeType === 'application/pdf' && !small && navigator.pdfViewerEnabled
  const preview = (image || pdf) && safeFileUrl(attachment, slug)
  const external = externalResourceUrl(attachment.externalUrl)
  const reason = attachment.attachmentType === 'pdf' ? small ? 'Inline PDF preview is unavailable on small screens. Download the file to open it in your PDF viewer.' : 'This browser cannot display the PDF safely in this workspace.'
    : attachment.attachmentType === 'slides' ? 'PowerPoint preview is unavailable. Slide conversion is not supported yet.'
      : attachment.attachmentType === 'document' ? 'Document preview is unavailable. Document conversion is not supported yet.'
        : attachment.attachmentType === 'external_link' ? 'This material opens at its external source.' : 'Preview is unavailable for this material.'
  return <section className="pr-attachment" aria-labelledby="pr-material-title">
    <h3 id="pr-material-title">{attachment.displayName}</h3>
    <p className="pr-material-meta">{ATTACHMENT_LABELS[attachment.attachmentType]} · Version {attachment.version} · {ACCESS_LABELS[attachment.accessLevel]}{attachment.fileSize !== null && <> · {formatFileSize(attachment.fileSize)}</>}</p>
    {attachment.description && <p className="pr-material-description">{attachment.description}</p>}
    {preview ? <InlinePreview key={`${identity}:${attachment.id}:${attachment.version}:${image}`} attachment={attachment} slug={slug} image={image} /> : <div className="pr-preview-fallback"><h3>{attachment.attachmentType === 'external_link' ? 'External resource' : 'Preview unavailable'}</h3><p>{reason}</p></div>}
    {attachment.attachmentType === 'external_link' ? external ? <a href={external} target="_blank" rel="noopener noreferrer">Open external material ↗</a> : <p>Resource link unavailable.</p> : <AttachmentDownload attachment={attachment} slug={slug} />}
  </section>
}
