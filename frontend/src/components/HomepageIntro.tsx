import { useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import './HomepageIntro.css'

const SESSION_KEY = 'brain-home-intro-seen'
const HANDOFF_START = 3450
const HANDOFF_DURATION = 820
const DURATION = HANDOFF_START + HANDOFF_DURATION
// A small deterministic topology, independent of real research or download state.
const nodes = Array.from({ length: 34 }, (_, i) => {
  const angle = i * 2.39996
  const radius = 30 + Math.sqrt(i / 33) * 218
  return { x: 400 + Math.cos(angle) * radius, y: 210 + Math.sin(angle) * radius * .61 }
})

const hudPanels = [
  { id: 'signal', title: 'Neural Signal Array', rows: ['Signal Coherence', 'Active Nodes', 'Link State'] },
  { id: 'topology', title: 'Cortical Topology', rows: ['Regions Mapped', 'Synaptic Paths', 'Mapping Status'] },
  { id: 'interface', title: 'Research Interface', rows: ['Network', 'Visual Layer', 'System Status'] },
] as const

function shouldPlay() {
  try { return sessionStorage.getItem(SESSION_KEY) !== '1' }
  catch { return false }
}

function HomepageIntro() {
  const [visible, setVisible] = useState(shouldPlay)
  const overlayRef = useRef<HTMLDivElement>(null)
  const skipRef = useRef<() => void>(() => {})

  useLayoutEffect(() => {
    const overlay = overlayRef.current
    const home = overlay?.parentElement
    if (!visible || !overlay || !home) return

    let frame = 0
    let watchdog = 0
    let done = false
    let motion: MediaQueryList | undefined
    const restore: (() => void)[] = []
    const animations: Animation[] = []
    const previousFocus = document.activeElement
    const release = () => {
      window.cancelAnimationFrame(frame)
      window.clearTimeout(watchdog)
      for (const animation of animations) animation.cancel()
      animations.length = 0
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', finish)
      document.removeEventListener('visibilitychange', onVisibility)
      motion?.removeEventListener('change', onMotion)
      for (const undo of restore.reverse()) undo()
      restore.length = 0
      delete home.dataset.homeIntro
    }
    const finish = () => {
      if (done) return
      done = true
      const returnFocus = overlay.contains(document.activeElement)
      release()
      // Hide synchronously, including when animation initialization failed.
      overlay.hidden = true
      if (returnFocus) {
        const target = previousFocus instanceof HTMLElement && previousFocus !== document.body
          && previousFocus.isConnected && !previousFocus.closest('[inert]')
          ? previousFocus : home.querySelector<HTMLAnchorElement>('.navbar a[href="/"]')
        target?.focus({ preventScroll: true })
      }
      setVisible(false)
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') { event.preventDefault(); finish() }
    }
    function onVisibility() { if (document.hidden) finish() }
    function onMotion() { if (motion?.matches) finish() }
    function preserveStyle(element: HTMLElement, property: string, value: string) {
      const old = element.style.getPropertyValue(property)
      const priority = element.style.getPropertyPriority(property)
      restore.push(() => {
        if (old) element.style.setProperty(property, old, priority)
        else element.style.removeProperty(property)
      })
      element.style.setProperty(property, value)
    }

    skipRef.current = finish
    // Independent of rAF: even a stalled animation must release the page.
    watchdog = window.setTimeout(finish, 4500)
    try {
      sessionStorage.setItem(SESSION_KEY, '1')
      motion = window.matchMedia('(prefers-reduced-motion: reduce)')
      overlay.dataset.motion = motion.matches ? 'reduced' : 'full'
      overlay.dataset.density = window.innerWidth < 620 || navigator.hardwareConcurrency <= 4 ? 'compact' : 'full'
      home.dataset.homeIntro = motion.matches ? 'reduced' : 'signal'
      const gap = window.innerWidth - document.documentElement.clientWidth
      if (gap > 0 && CSS.supports('scrollbar-gutter', 'stable')) {
        preserveStyle(document.documentElement, 'scrollbar-gutter', 'stable')
      } else if (gap > 0) {
        preserveStyle(document.body, 'padding-right', `${parseFloat(getComputedStyle(document.body).paddingRight) + gap}px`)
      }
      for (const element of [document.documentElement, document.body]) {
        preserveStyle(element, 'overflow-x', 'hidden')
        preserveStyle(element, 'overflow-y', 'hidden')
      }
      for (const child of Array.from(home.children)) {
        if (child === overlay || !(child instanceof HTMLElement)) continue
        const wasInert = child.inert
        restore.push(() => { child.inert = wasInert })
        child.inert = true
      }
      window.addEventListener('keydown', onKey)
      window.addEventListener('resize', finish)
      document.addEventListener('visibilitychange', onVisibility)
      motion.addEventListener('change', onMotion)
      if (document.hidden) { finish(); return release }
      if (motion.matches) {
        window.clearTimeout(watchdog)
        watchdog = window.setTimeout(finish, 400)
        return () => { done = true; release() }
      }

      const percent = overlay.querySelector<HTMLElement>('[data-intro-percent]')!
      const status = overlay.querySelector<HTMLElement>('[data-intro-status]')!
      const hudValues = overlay.querySelectorAll<HTMLElement>('[data-intro-hud-value]')
      const visualNodeCount = overlay.dataset.density === 'compact' ? 18 : nodes.length
      const startHandoff = () => {
        const sourceWords = overlay.querySelectorAll<HTMLElement>('[data-intro-word]')
        const targetWords = home.querySelectorAll<HTMLElement>('.hero-title-anchor-word')
        if (sourceWords.length !== 2 || targetWords.length !== 2) throw new Error('Hero anchor unavailable.')
        // Measure each word separately: the actual phrase may wrap on mobile.
        sourceWords.forEach((source, index) => {
          const target = targetWords[index]
          const from = source.getBoundingClientRect()
          const to = target.getBoundingClientRect()
          if (!from.width || !from.height || !to.width || !to.height) throw new Error('Hero anchor has no geometry.')
          const options: KeyframeAnimationOptions = {
            duration: HANDOFF_DURATION, easing: 'cubic-bezier(.42,0,.22,1)', fill: 'both',
          }
          animations.push(source.animate([
            { transform: 'none', opacity: 1, textShadow: '0 0 32px rgba(56,189,248,.26)', offset: 0 },
            { opacity: 0, offset: .32 },
            { transform: `translate(${to.x - from.x}px, ${to.y - from.y}px) scale(${to.width / from.width}, ${to.height / from.height})`, opacity: 0, textShadow: '0 0 8px rgba(56,189,248,.12)', offset: 1 },
          ], options))
          animations.push(target.animate([
            { transform: `translate(${from.x - to.x}px, ${from.y - to.y}px) scale(${from.width / to.width}, ${from.height / to.height})`, opacity: 0, offset: 0 },
            { opacity: 1, offset: .32 },
            { transform: 'none', opacity: 1, offset: 1 },
          ], options))
        })
      }
      const started = performance.now()
      let lastPercent = -1
      let lastPhase = ''
      const tick = (now: number) => {
        if (done) return
        try {
          const elapsed = now - started
          const t = Math.min(1, Math.max(0, (elapsed - 400) / 2120))
          const progress = t >= 1 ? 1 : t < .35 ? t / .35 * .48 : t < .8 ? .48 + (t - .35) / .45 * .34 : .82 + (t - .8) / .2 * .18
          overlay.style.setProperty('--boot-progress', String(progress))
          const rounded = Math.floor(progress * 100)
          if (rounded !== lastPercent) {
            percent.textContent = String(rounded).padStart(2, '0')
            overlay.dataset.hud = rounded < 14 ? 'waiting' : rounded < 45 ? 'signal' : rounded < 86 ? 'mapping' : 'ready'
            // Illustrative readings share the boot clock, not device or server state.
            const readings = [
              `${Math.round(35 + progress * 64)}%`,
              `${String(Math.round(progress * visualNodeCount)).padStart(2, '0')} / ${visualNodeCount}`,
              rounded < 45 ? 'Acquiring' : rounded < 86 ? 'Coherent' : 'Aligned',
              `${String(Math.floor(progress * 6)).padStart(2, '0')} / 06`,
              String(Math.round(progress * 48)).padStart(2, '0'),
              rounded < 86 ? 'Tracing' : rounded < 100 ? 'Aligning' : 'Mapped',
              rounded < 45 ? 'Forming' : rounded < 86 ? 'Connecting' : 'Coherent',
              rounded < 86 ? 'Composing' : rounded < 100 ? 'Aligning' : 'Resolved',
              rounded < 86 ? 'Initializing' : rounded < 100 ? 'Converging' : 'Ready',
            ]
            hudValues.forEach((element, index) => {
              if (element.textContent !== readings[index]) element.textContent = readings[index]
            })
            lastPercent = rounded
          }
          const phase = elapsed < 500 ? 'signal' : elapsed < 1500 ? 'mapping'
            : elapsed < 2520 ? 'convergence' : elapsed < 2700 ? 'online'
              : elapsed < HANDOFF_START ? 'identity' : 'handoff'
          if (phase !== lastPhase) {
            if (phase === 'handoff') startHandoff()
            overlay.dataset.phase = phase
            home.dataset.homeIntro = phase
            status.textContent = phase === 'signal' ? 'Signal acquisition' : phase === 'mapping' ? 'Neural mapping'
              : phase === 'convergence' ? 'Synaptic synchronization' : 'Interface ready'
            lastPhase = phase
          }
          if (elapsed >= DURATION) finish()
          else frame = window.requestAnimationFrame(tick)
        } catch { finish() }
      }
      frame = window.requestAnimationFrame(tick)
    } catch { finish() }

    return () => { done = true; release(); skipRef.current = () => {} }
  }, [visible])

  if (!visible) return null
  return (
    <div className="homepage-intro" data-phase="signal" ref={overlayRef}>
      <div className="homepage-intro-art" aria-hidden="true">
        <div className="homepage-intro-masthead"><span>Brain Research</span><span>Neural interface / initiation</span></div>
        <div className="homepage-intro-field">
          <div className="homepage-intro-aura" />
          <svg className="homepage-intro-network" viewBox="0 0 800 420" fill="none">
            <g className="homepage-intro-contours" stroke="currentColor" strokeWidth=".6">
              <ellipse cx="400" cy="210" rx="278" ry="153" />
              <ellipse cx="400" cy="210" rx="278" ry="84" transform="rotate(-18 400 210)" />
              <ellipse cx="400" cy="210" rx="208" ry="150" transform="rotate(24 400 210)" />
              <path d="M80 210h56m528 0h56M400 25v22m0 326v22" />
            </g>
            {nodes.map((node, i) => {
              const parent = i < 3 ? { x: 400, y: 210 } : nodes[Math.floor((i - 1) / 2)]
              return <g className={`homepage-intro-node${i >= 10 ? ' homepage-intro-peripheral' : ''}${i >= 18 ? ' homepage-intro-detail' : ''}`}
                style={{ '--node-delay': `${480 + i * 43}ms` } as CSSProperties} key={i}>
                <path d={`M${parent.x} ${parent.y} L${node.x} ${node.y}`} />
                <circle cx={node.x} cy={node.y} r={i % 5 === 0 ? 3 : 1.8} />
                {i % 5 === 0 && <circle className="homepage-intro-node-ring" cx={node.x} cy={node.y} r="7" />}
              </g>
            })}
            <circle className="homepage-intro-wave" vectorEffect="non-scaling-stroke" cx="400" cy="210" r="20" />
            <circle className="homepage-intro-core-halo" cx="400" cy="210" r="13" />
            <circle className="homepage-intro-core" cx="400" cy="210" r="3" />
          </svg>
          <div className="homepage-intro-destination"><span data-intro-word>Brain</span><span data-intro-word>Science</span></div>
        </div>
        {hudPanels.map((panel, index) => (
          <div className={`homepage-intro-hud homepage-intro-hud-${panel.id}`} key={panel.id}>
            <div className="homepage-intro-hud-caption"><span>Visual telemetry</span><span>0{index + 1}</span></div>
            <h2>{panel.title}</h2>
            <dl>{panel.rows.map(label => (
              <div key={label}><dt>{label}</dt><dd data-intro-hud-value>—</dd></div>
            ))}</dl>
            <div className="homepage-intro-hud-track"><i /></div>
          </div>
        ))}
        <div className="homepage-intro-console">
          <div className="homepage-intro-eyebrow">Neural system initialization</div>
          <div className="homepage-intro-status"><span data-intro-status>Signal acquisition</span><span><b data-intro-percent>00</b><small>%</small></span></div>
          <div className="homepage-intro-rail"><div /><i /></div>
          <div className="homepage-intro-calibration"><span>Signal</span><span>Connection</span><span>Discovery</span></div>
        </div>
        <div className="homepage-intro-bottom"><div className="homepage-intro-footer"><span>From neural signals to new perspectives</span><span>Brain science · Brain-inspired intelligence</span></div></div>
      </div>
      <div className="homepage-intro-controls"><button className="homepage-intro-skip" onClick={() => skipRef.current()} type="button">Skip intro <span aria-hidden="true">↗</span></button></div>
    </div>
  )
}

export default HomepageIntro
