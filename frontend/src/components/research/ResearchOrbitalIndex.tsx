import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { ResearchArea } from '../../api/research'
import ResearchOrbitalPanel from './ResearchOrbitalPanel'

const ROTATION_DURATION = 180_000

// Native transform animations run without a JS frame loop or React renders.
function orbitMotion(rotor: HTMLElement, stage: HTMLElement) {
  const targets = [rotor, ...rotor.querySelectorAll<HTMLElement>('.research-orbital-upright')]
  const spin = targets.map((target, index) => target.animate([
    { transform: 'rotate(0deg)' }, { transform: `rotate(${index === 0 ? 360 : -360}deg)` },
  ], { duration: ROTATION_DURATION, iterations: Infinity }))
  const start = document.timeline.currentTime
  spin.forEach(animation => { animation.startTime = start })
  const media = window.matchMedia('(prefers-reduced-motion: reduce)')
  const paused = { selected: false, hover: false, focus: false, outside: false }
  let alignment: { animations: Animation[]; from: number; to: number } | null = null
  let disposed = false

  function sync() {
    if (disposed) return
    const time = Number(spin[0].currentTime ?? 0)
    const stop = media.matches || document.hidden || alignment !== null || Object.values(paused).some(Boolean)
    spin.forEach(animation => {
      animation.pause()
      animation.currentTime = time
      if (!stop) {
        animation.play()
        if (document.timeline.currentTime !== null) animation.startTime = Number(document.timeline.currentTime) - time
      }
    })
  }
  function setAngle(angle: number) {
    const time = ((angle % 360 + 360) % 360) / 360 * ROTATION_DURATION
    spin.forEach(animation => { animation.currentTime = time })
  }
  function finishAlignment() {
    if (!alignment) return
    const { animations, from, to } = alignment
    const progress = Number(animations[0].effect?.getComputedTiming().progress ?? 0)
    setAngle(from + (to - from) * progress)
    alignment = null
    animations.forEach(animation => animation.cancel())
  }
  function select(index: number, total: number) {
    finishAlignment()
    paused.selected = true
    sync()
    const from = Number(spin[0].currentTime ?? 0) / ROTATION_DURATION * 360 % 360
    const desired = (360 - index / total * 360) % 360
    const to = from + ((desired - from + 540) % 360 - 180)
    if (media.matches) { setAngle(to); return }
    const animations = targets.map((target, position) => target.animate([
      { transform: `rotate(${position === 0 ? from : -from}deg)` },
      { transform: `rotate(${position === 0 ? to : -to}deg)` },
    ], { duration: 650, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'forwards' }))
    alignment = { animations, from, to }
    animations[0].onfinish = () => {
      if (disposed || alignment?.animations !== animations) return
      setAngle(to)
      alignment = null
      animations.forEach(animation => animation.cancel())
      sync()
    }
  }
  function motionChange() { finishAlignment(); sync() }
  const observer = new IntersectionObserver(([entry]) => { paused.outside = !entry.isIntersecting; sync() })
  observer.observe(stage)
  media.addEventListener('change', motionChange)
  document.addEventListener('visibilitychange', sync)
  sync()
  return {
    select,
    pause(reason: 'hover' | 'focus', value: boolean) { paused[reason] = value; sync() },
    close() { finishAlignment(); paused.selected = false; paused.hover = false; sync() },
    dispose() {
      disposed = true
      observer.disconnect()
      media.removeEventListener('change', motionChange)
      document.removeEventListener('visibilitychange', sync)
      alignment?.animations.forEach(animation => animation.cancel())
      spin.forEach(animation => animation.cancel())
    },
  }
}

export default function ResearchOrbitalIndex({ areas }: { areas: ResearchArea[] }) {
  const [activeId, setActiveId] = useState<number | null>(null)
  const root = useRef<HTMLElement>(null), stage = useRef<HTMLDivElement>(null), rotor = useRef<HTMLUListElement>(null)
  const motion = useRef<ReturnType<typeof orbitMotion> | null>(null)
  const buttons = useRef(new Map<number, HTMLButtonElement>())
  const active = areas.find(area => area.id === activeId)
  useEffect(() => {
    if (!rotor.current || !stage.current) return
    const controller = orbitMotion(rotor.current, stage.current)
    motion.current = controller
    return () => { controller.dispose(); motion.current = null }
  }, [areas])
  function close(restoreFocus: boolean) {
    setActiveId(null)
    motion.current?.close()
    if (restoreFocus && activeId !== null) buttons.current.get(activeId)?.focus({ preventScroll: true })
    else root.current?.focus({ preventScroll: true })
  }
  return <section ref={root} className={`research-orbital${active ? ' is-expanded' : ''}`} aria-label="Explore research areas" tabIndex={-1}
    onClick={event => {
      if (active && event.target instanceof Element && !event.target.closest('button, a, .research-orbital-detail')) close(false)
    }}
    onKeyDown={event => { if (event.key === 'Escape' && active) { event.preventDefault(); close(true) } }}
    onFocusCapture={event => motion.current?.pause('focus', event.target !== event.currentTarget && event.target.matches(':focus-visible'))}
    onBlurCapture={event => motion.current?.pause('focus', event.relatedTarget instanceof HTMLElement && event.currentTarget.contains(event.relatedTarget) && event.relatedTarget !== event.currentTarget && event.relatedTarget.matches(':focus-visible'))}>
    <div className="research-orbital-stage" ref={stage}>
      <div className="research-orbital-ring" aria-hidden="true" />
      <div className="research-orbital-core" aria-hidden="true"><span className="research-orbital-core-light" /></div>
      <nav aria-label="Research areas"><ul className="research-orbital-rotor" ref={rotor}>
        {areas.map((area, index) => <li key={area.id} className={`research-orbital-station research-accent-${area.slug}`} style={{ '--node-angle': `${index / areas.length * 360}deg` } as CSSProperties}>
          <div className="research-orbital-upright"><button type="button" className={`research-orbital-node${activeId === area.id ? ' is-active' : ''}`}
            ref={element => { if (element) buttons.current.set(area.id, element); else buttons.current.delete(area.id) }}
            aria-expanded={activeId === area.id} aria-controls={activeId === area.id ? 'research-orbital-detail' : undefined}
            onPointerEnter={event => { if (event.pointerType === 'mouse') motion.current?.pause('hover', true) }}
            onPointerLeave={event => { if (event.pointerType === 'mouse') motion.current?.pause('hover', false) }}
            onClick={() => {
              if (activeId === area.id) close(true)
              else { setActiveId(area.id); motion.current?.select(index, areas.length) }
            }}>
            <span className="research-orbital-code">{area.code}</span><span className="research-orbital-name">{area.name}</span>
          </button></div>
        </li>)}
      </ul></nav>
    </div>
    <ResearchOrbitalPanel area={active} onClose={() => close(true)} onHoverChange={hovered => motion.current?.pause('hover', hovered)} />
  </section>
}
