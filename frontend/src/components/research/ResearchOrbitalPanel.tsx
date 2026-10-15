import { useLayoutEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { researchPath, type ResearchArea } from '../../api/research'

export default function ResearchOrbitalPanel({ area, onClose, onHoverChange }: {
  area: ResearchArea | undefined
  onClose: () => void
  onHoverChange: (hovered: boolean) => void
}) {
  // Retain only the closing panel's content until its brief fade completes.
  const [snapshot, setSnapshot] = useState(area)
  if (area && snapshot !== area) setSnapshot(area)
  const panel = useRef<HTMLElement>(null)
  const wasOpen = useRef(false)
  const opacity = useRef(0)

  useLayoutEffect(() => {
    const element = panel.current
    if (!element || !snapshot) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let animation: Animation | undefined
    let current = true
    if (area) {
      if (!wasOpen.current && !reduced) animation = element.animate([
        { opacity: opacity.current, translate: '0 6px', scale: '.985' },
        { opacity: 1, translate: '0 0', scale: '1' },
      ], { duration: 180, easing: 'cubic-bezier(.22,1,.36,1)' })
      wasOpen.current = true
    } else {
      wasOpen.current = false
      animation = element.animate([{ opacity: opacity.current }, { opacity: 0 }], {
        duration: reduced ? 0 : 140, fill: 'forwards',
      })
      animation.onfinish = () => { if (current) setSnapshot(undefined) }
    }
    return () => {
      current = false
      opacity.current = Number(getComputedStyle(element).opacity)
      animation?.cancel()
    }
  }, [area, snapshot])

  const shown = area ?? snapshot
  if (!shown) return null
  return <section ref={panel} id="research-orbital-detail"
    className={`research-orbital-detail research-accent-${shown.slug}${area ? '' : ' is-closing'}`}
    aria-labelledby="research-orbital-title" aria-hidden={area ? undefined : true} inert={!area}
    onPointerEnter={event => { if (area && event.pointerType === 'mouse') onHoverChange(true) }}
    onPointerLeave={event => { if (event.pointerType === 'mouse') onHoverChange(false) }}>
    <div className="research-orbital-panel-bar">
      <p className="research-eyebrow">{shown.code}</p>
      <button type="button" className="research-orbital-close" aria-label="Close research area details" onClick={onClose}>
        <svg aria-hidden="true" viewBox="0 0 20 20" fill="none"><path d="m5 5 10 10M15 5 5 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
      </button>
    </div>
    <h2 id="research-orbital-title">{shown.name}</h2>
    {shown.overview.trim() && <p className="research-orbital-overview">{shown.overview}</p>}
    <div className="research-orbital-panel-footer">
      <Link className="research-action" to={researchPath(shown.slug)}>Explore Area <span aria-hidden="true">→</span></Link>
    </div>
  </section>
}
