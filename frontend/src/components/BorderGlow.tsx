import {
  useCallback,
  useEffect,
  useRef,
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
} from 'react'
import './BorderGlow.css'

interface BorderGlowProps {
  children?: ReactNode
  className?: string
  edgeSensitivity?: number
  glowColor?: string
  backgroundColor?: string
  borderRadius?: number
  glowRadius?: number
  glowIntensity?: number
  coneSpread?: number
  animated?: boolean
  colors?: string[]
  fillOpacity?: number
}

type GlowStyle = CSSProperties & Record<string, string | number>

type AnimationHandle = {
  cancel: () => void
}

const DEFAULT_COLORS = ['#c084fc', '#f472b6', '#38bdf8']
const GRADIENT_POSITIONS = ['80% 55%', '69% 34%', '8% 6%', '41% 38%', '86% 85%', '82% 18%', '51% 4%']
const GRADIENT_KEYS = [
  '--gradient-one',
  '--gradient-two',
  '--gradient-three',
  '--gradient-four',
  '--gradient-five',
  '--gradient-six',
  '--gradient-seven',
]
const COLOR_MAP = [0, 1, 2, 0, 1, 2, 1]
const POINTER_LERP = 0.22
const POINTER_EPSILON = 0.08

function parseHSL(hslStr: string): { h: number; s: number; l: number } {
  const match = hslStr.match(/([\d.]+)\s*([\d.]+)%?\s*([\d.]+)%?/)
  if (!match) {
    return { h: 40, s: 80, l: 80 }
  }

  return {
    h: parseFloat(match[1]),
    s: parseFloat(match[2]),
    l: parseFloat(match[3]),
  }
}

function buildGlowVars(glowColor: string, intensity: number): Record<string, string> {
  const { h, s, l } = parseHSL(glowColor)
  const base = `${h}deg ${s}% ${l}%`
  const opacities = [100, 60, 50, 40, 30, 20, 10]
  const keys = ['', '-60', '-50', '-40', '-30', '-20', '-10']
  const vars: Record<string, string> = {}

  for (let i = 0; i < opacities.length; i += 1) {
    vars[`--glow-color${keys[i]}`] = `hsl(${base} / ${Math.min(opacities[i] * intensity, 100)}%)`
  }

  return vars
}

function buildGradientVars(colors: string[]): Record<string, string> {
  const palette = colors.length ? colors : DEFAULT_COLORS
  const vars: Record<string, string> = {}

  for (let i = 0; i < 7; i += 1) {
    const color = palette[Math.min(COLOR_MAP[i], palette.length - 1)]
    vars[GRADIENT_KEYS[i]] = `radial-gradient(at ${GRADIENT_POSITIONS[i]}, ${color} 0px, transparent 50%)`
  }

  vars['--gradient-base'] = `linear-gradient(${palette[0]} 0 100%)`
  return vars
}

function easeOutCubic(x: number) {
  return 1 - Math.pow(1 - x, 3)
}

function easeInCubic(x: number) {
  return x * x * x
}

interface AnimateOpts {
  start?: number
  end?: number
  duration?: number
  delay?: number
  ease?: (t: number) => number
  onUpdate: (v: number) => void
  onEnd?: () => void
}

function animateValue({
  start = 0,
  end = 100,
  duration = 1000,
  delay = 0,
  ease = easeOutCubic,
  onUpdate,
  onEnd,
}: AnimateOpts): AnimationHandle {
  const startTime = performance.now() + delay
  let frameId: number | undefined
  let cancelled = false

  const tick = () => {
    if (cancelled) {
      return
    }

    const elapsed = performance.now() - startTime
    const progress = Math.min(elapsed / duration, 1)
    onUpdate(start + (end - start) * ease(progress))

    if (progress < 1) {
      frameId = window.requestAnimationFrame(tick)
      return
    }

    onEnd?.()
  }

  const timeoutId = window.setTimeout(() => {
    if (!cancelled) {
      frameId = window.requestAnimationFrame(tick)
    }
  }, delay)

  return {
    cancel: () => {
      cancelled = true

      window.clearTimeout(timeoutId)
      if (frameId !== undefined) {
        window.cancelAnimationFrame(frameId)
      }
    },
  }
}

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function BorderGlow({
  children,
  className = '',
  edgeSensitivity = 30,
  glowColor = '40 80 80',
  backgroundColor = '#120F17',
  borderRadius = 28,
  glowRadius = 40,
  glowIntensity = 1.0,
  coneSpread = 25,
  animated = false,
  colors = DEFAULT_COLORS,
  fillOpacity = 0.5,
}: BorderGlowProps) {
  const cardRef = useRef<HTMLDivElement>(null)
  const animationHandlesRef = useRef<AnimationHandle[]>([])
  const hasSweptRef = useRef(false)
  const hoverFrameRef = useRef<number | null>(null)
  const targetAngleRef = useRef(45)
  const currentAngleRef = useRef(45)
  const targetProximityRef = useRef(0)
  const currentProximityRef = useRef(0)
  const isPointerInsideRef = useRef(false)
  const isSweepingRef = useRef(false)

  const cancelHoverFrame = useCallback(() => {
    if (hoverFrameRef.current !== null) {
      window.cancelAnimationFrame(hoverFrameRef.current)
      hoverFrameRef.current = null
    }
  }, [])

  const writeGlowVars = useCallback((card: HTMLDivElement, proximity: number, angle: number) => {
    card.style.setProperty('--edge-proximity', `${proximity.toFixed(3)}`)
    card.style.setProperty('--cursor-angle', `${angle.toFixed(3)}deg`)
  }, [])

  const syncCurrentGlowVars = useCallback((card: HTMLDivElement) => {
    const style = window.getComputedStyle(card)
    const proximity = parseFloat(style.getPropertyValue('--edge-proximity'))
    const angle = parseFloat(style.getPropertyValue('--cursor-angle'))

    if (Number.isFinite(proximity)) {
      currentProximityRef.current = proximity
    }

    if (Number.isFinite(angle)) {
      currentAngleRef.current = ((angle % 360) + 360) % 360
    }
  }, [])

  const scheduleHoverFrame = useCallback(() => {
    if (isSweepingRef.current || hoverFrameRef.current !== null) {
      return
    }

    const tick = () => {
      const card = cardRef.current

      if (!card || isSweepingRef.current) {
        hoverFrameRef.current = null
        return
      }

      const proximityDelta = targetProximityRef.current - currentProximityRef.current
      const angleDelta = ((targetAngleRef.current - currentAngleRef.current + 540) % 360) - 180

      currentProximityRef.current += proximityDelta * POINTER_LERP
      currentAngleRef.current = (currentAngleRef.current + angleDelta * POINTER_LERP + 360) % 360

      const isSettled = Math.abs(proximityDelta) < POINTER_EPSILON && Math.abs(angleDelta) < POINTER_EPSILON

      if (isSettled) {
        currentProximityRef.current = targetProximityRef.current
        currentAngleRef.current = targetAngleRef.current
      }

      writeGlowVars(card, currentProximityRef.current, currentAngleRef.current)

      if (isSettled) {
        hoverFrameRef.current = null
        return
      }

      hoverFrameRef.current = window.requestAnimationFrame(tick)
    }

    hoverFrameRef.current = window.requestAnimationFrame(tick)
  }, [writeGlowVars])

  const clearSweepAnimations = useCallback(
    (card: HTMLDivElement | null = cardRef.current) => {
      animationHandlesRef.current.forEach((handle) => handle.cancel())
      animationHandlesRef.current = []
      isSweepingRef.current = false
      card?.classList.remove('sweep-active')
      cancelHoverFrame()
    },
    [cancelHoverFrame],
  )

  const getCenterOfElement = useCallback((el: HTMLElement) => {
    const { width, height } = el.getBoundingClientRect()
    return [width / 2, height / 2]
  }, [])

  const getEdgeProximity = useCallback(
    (el: HTMLElement, x: number, y: number) => {
      const [centerX, centerY] = getCenterOfElement(el)
      const dx = x - centerX
      const dy = y - centerY
      let kx = Infinity
      let ky = Infinity

      if (dx !== 0) {
        kx = centerX / Math.abs(dx)
      }

      if (dy !== 0) {
        ky = centerY / Math.abs(dy)
      }

      return Math.min(Math.max(1 / Math.min(kx, ky), 0), 1)
    },
    [getCenterOfElement],
  )

  const getCursorAngle = useCallback(
    (el: HTMLElement, x: number, y: number) => {
      const [centerX, centerY] = getCenterOfElement(el)
      const dx = x - centerX
      const dy = y - centerY

      if ((dx === 0 && dy === 0) || centerX === 0 || centerY === 0) {
        return 0
      }

      const nx = dx / centerX
      const ny = dy / centerY
      const radians = Math.atan2(ny, nx)
      let degrees = radians * (180 / Math.PI) + 90

      if (degrees < 0) {
        degrees += 360
      }

      return degrees
    },
    [getCenterOfElement],
  )

  const handlePointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const card = cardRef.current
      if (!card) {
        return
      }

      const rect = card.getBoundingClientRect()
      const x = event.clientX - rect.left
      const y = event.clientY - rect.top
      const edge = getEdgeProximity(card, x, y)
      const angle = getCursorAngle(card, x, y)

      isPointerInsideRef.current = true
      targetProximityRef.current = edge * 100
      targetAngleRef.current = angle
      scheduleHoverFrame()
    },
    [getCursorAngle, getEdgeProximity, scheduleHoverFrame],
  )

  const handlePointerLeave = useCallback(() => {
    isPointerInsideRef.current = false
    targetProximityRef.current = 0
    scheduleHoverFrame()
  }, [scheduleHoverFrame])

  const runSweep = useCallback(() => {
    const card = cardRef.current

    if (!card || hasSweptRef.current) {
      return
    }

    hasSweptRef.current = true
    const angleStart = 110
    const angleEnd = 465

    clearSweepAnimations(card)
    isSweepingRef.current = true
    card.classList.add('sweep-active')
    card.style.setProperty('--cursor-angle', `${angleStart}deg`)

    const handles = [
      animateValue({
        duration: 500,
        onUpdate: (value) => card.style.setProperty('--edge-proximity', `${value}`),
      }),
      animateValue({
        ease: easeInCubic,
        duration: 1500,
        end: 50,
        onUpdate: (value) => {
          card.style.setProperty('--cursor-angle', `${(angleEnd - angleStart) * (value / 100) + angleStart}deg`)
        },
      }),
      animateValue({
        ease: easeOutCubic,
        delay: 1500,
        duration: 2250,
        start: 50,
        end: 100,
        onUpdate: (value) => {
          card.style.setProperty('--cursor-angle', `${(angleEnd - angleStart) * (value / 100) + angleStart}deg`)
        },
      }),
      animateValue({
        ease: easeInCubic,
        delay: 2500,
        duration: 1500,
        start: 100,
        end: 0,
        onUpdate: (value) => card.style.setProperty('--edge-proximity', `${value}`),
        onEnd: () => {
          card.classList.remove('sweep-active')
          isSweepingRef.current = false
          animationHandlesRef.current = []
          if (!isPointerInsideRef.current) {
            targetProximityRef.current = 0
          }
          syncCurrentGlowVars(card)
          scheduleHoverFrame()
        },
      }),
    ]

    animationHandlesRef.current = handles
  }, [clearSweepAnimations, scheduleHoverFrame, syncCurrentGlowVars])

  useEffect(() => {
    const card = cardRef.current

    if (!animated || !card || hasSweptRef.current || prefersReducedMotion()) {
      return undefined
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const isVisible = entries.some((entry) => entry.isIntersecting && entry.intersectionRatio >= 0.35)

        if (!isVisible || hasSweptRef.current) {
          return
        }

        observer.disconnect()
        runSweep()
      },
      { threshold: [0, 0.35] },
    )

    observer.observe(card)

    return () => {
      observer.disconnect()
      clearSweepAnimations(card)
    }
  }, [animated, clearSweepAnimations, runSweep])

  useEffect(() => {
    return () => {
      clearSweepAnimations()
      cancelHoverFrame()
    }
  }, [cancelHoverFrame, clearSweepAnimations])

  const glowVars = buildGlowVars(glowColor, glowIntensity)
  const gradientVars = buildGradientVars(colors)

  const style: GlowStyle = {
    '--card-bg': backgroundColor,
    '--edge-sensitivity': edgeSensitivity,
    '--border-radius': `${borderRadius}px`,
    '--glow-padding': `${glowRadius}px`,
    '--cone-spread': coneSpread,
    '--fill-opacity': fillOpacity,
    ...glowVars,
    ...gradientVars,
  }

  return (
    <div
      ref={cardRef}
      className={`border-glow-card ${className}`.trim()}
      style={style}
      onPointerEnter={handlePointerMove}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
    >
      <span className="edge-light" />
      <div className="border-glow-inner">{children}</div>
    </div>
  )
}

export default BorderGlow
