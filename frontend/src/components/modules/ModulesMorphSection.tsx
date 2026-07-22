import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { learningModules } from '../../data/modules'
import ModulesMetricsText from './ModulesMetricsText'
import MorphModuleCard from './MorphModuleCard'
import './ModulesMorphSection.css'

type CardTarget = {
  depth: number
  opacity: number
  rotation: number
  scale: number
  x: number
  y: number
}

type LayoutContext = {
  cardHeight: number
  cardWidth: number
  circleCenterOffsetY: number
  height: number
  isMobile: boolean
  isTablet: boolean
  width: number
}

type CircleRadii = {
  x: number
  y: number
}

const INTRO_SCATTER_DURATION = 900
const INTRO_RIBBON_DURATION = 1300
const INTRO_CIRCLE_DURATION = 1700
const SCROLL_SMOOTHING_DURATION = 260
const INTRO_TOTAL_DURATION = (
  INTRO_SCATTER_DURATION + INTRO_RIBBON_DURATION + INTRO_CIRCLE_DURATION
)

const totalHours = learningModules.reduce(
  (sum, learningModule) => sum + learningModule.durationHours,
  0,
)
const thematicAreaCount = new Set(
  learningModules.map((learningModule) => learningModule.category),
).size

const clamp = (value: number, minimum = 0, maximum = 1) => (
  Math.min(Math.max(value, minimum), maximum)
)

const lerp = (start: number, end: number, progress: number) => (
  start + (end - start) * progress
)

const smoothstep = (start: number, end: number, value: number) => {
  const progress = clamp((value - start) / (end - start))
  return progress * progress * (3 - 2 * progress)
}

const interpolateTarget = (start: CardTarget, end: CardTarget, progress: number): CardTarget => ({
  depth: Math.round(lerp(start.depth, end.depth, progress)),
  opacity: lerp(start.opacity, end.opacity, progress),
  rotation: lerp(start.rotation, end.rotation, progress),
  scale: lerp(start.scale, end.scale, progress),
  x: lerp(start.x, end.x, progress),
  y: lerp(start.y, end.y, progress),
})

function getLayoutContext(width: number, height: number): LayoutContext {
  const isMobile = width < 768
  const isTablet = width >= 768 && width <= 1000
  const minimumDimension = Math.min(width, height)
  const cardWidth = isMobile
    ? clamp(width * 0.12, 42, 50)
    : isTablet
      ? clamp(minimumDimension * 0.085, 68, 80)
      : clamp(minimumDimension * 0.085, 78, 92)

  return {
    cardHeight: cardWidth * 1.48,
    cardWidth,
    circleCenterOffsetY: isMobile ? height * 0.12 : 0,
    height,
    isMobile,
    isTablet,
    width,
  }
}

function getScatterTarget(index: number, total: number, layout: LayoutContext): CardTarget {
  const angle = (index / total) * Math.PI * 2 - Math.PI / 2
  const radialPulse = 1 + Math.sin((index + 1) * 2.35) * 0.08

  return {
    depth: 12 + index,
    opacity: 1,
    rotation: clamp(Math.sin((index + 1) * 1.71) * 30, -32, 32),
    scale: 0.9,
    x: Math.cos(angle) * layout.width * 0.57 * radialPulse,
    y: Math.sin(angle) * layout.height * 0.5 * radialPulse,
  }
}

function getRibbonTarget(index: number, total: number, layout: LayoutContext): CardTarget {
  const normalizedIndex = total > 1 ? index / (total - 1) : 0.5
  const ribbonSpan = layout.width * (layout.isMobile ? 1.26 : layout.isTablet ? 0.94 : 0.84)
  const wave = Math.sin(normalizedIndex * Math.PI * 3) * layout.height * (
    layout.isMobile ? 0.018 : 0.027
  )

  return {
    depth: 30 + index,
    opacity: 1,
    rotation: Math.sin(normalizedIndex * Math.PI * 3) * 5,
    scale: 0.94,
    x: (normalizedIndex - 0.5) * ribbonSpan,
    y: layout.circleCenterOffsetY * 0.35 + wave,
  }
}

function getCircleRadii(layout: LayoutContext): CircleRadii {
  const horizontalGutter = layout.isMobile ? 18 : layout.isTablet ? 34 : 64
  const topGutter = layout.isMobile ? layout.height * 0.34 : layout.isTablet ? 92 : 72
  const bottomGutter = layout.isMobile ? 42 : 52
  const horizontalRadius = (layout.width - layout.cardWidth) / 2 - horizontalGutter
  const topRadius = (
    layout.height / 2
    + layout.circleCenterOffsetY
    - layout.cardHeight / 2
    - topGutter
  )
  const bottomRadius = (
    layout.height / 2
    - layout.circleCenterOffsetY
    - layout.cardHeight / 2
    - bottomGutter
  )
  const verticalRadius = Math.min(topRadius, bottomRadius)
  const radius = Math.min(
    horizontalRadius,
    verticalRadius,
    layout.isMobile ? layout.width * 0.4 : layout.height * 0.34,
  )

  return { x: radius, y: radius }
}

function getCircleTarget(index: number, total: number, layout: LayoutContext): CardTarget {
  const angle = (index / total) * Math.PI * 2 - Math.PI / 2
  const radii = getCircleRadii(layout)
  const radialRotation = ((angle * 180 / Math.PI + 270) % 360) - 180

  return {
    depth: 48,
    opacity: 1,
    rotation: radialRotation,
    scale: 1,
    x: Math.cos(angle) * radii.x,
    y: layout.circleCenterOffsetY + Math.sin(angle) * radii.y,
  }
}

function getArcBrowseTarget(
  index: number,
  focusIndex: number,
  layout: LayoutContext,
): CardTarget {
  const distanceFromFocus = Math.abs(index - focusIndex)
  const angleStep = layout.isMobile ? 22 : layout.isTablet ? 17 : 14
  const angle = -90 + (index - focusIndex) * angleStep
  const angleInRadians = angle * Math.PI / 180
  const radius = layout.isMobile
    ? Math.min(layout.width * 1.02, layout.height * 0.58)
    : layout.isTablet
      ? Math.min(layout.width * 0.72, layout.height * 0.78)
      : Math.min(layout.width * 0.62, layout.height * 0.82)
  const apexY = layout.height * (layout.isMobile ? 0.63 : layout.isTablet ? 0.6 : 0.58)
  const centerY = apexY + radius
  const focusScale = layout.isMobile ? 1.62 : layout.isTablet ? 1.46 : 1.38

  return {
    depth: Math.max(20, Math.round(220 - distanceFromFocus * 12)),
    opacity: layout.isMobile
      ? clamp(1 - distanceFromFocus * 0.2, 0.08, 1)
      : clamp(1 - distanceFromFocus * 0.09, 0.18, 1),
    rotation: clamp((angle + 90) * 0.34, -18, 18),
    scale: clamp(focusScale - distanceFromFocus * 0.065, 0.82, focusScale),
    x: Math.cos(angleInRadians) * radius,
    y: Math.sin(angleInRadians) * radius + centerY - layout.height / 2,
  }
}

function ModulesMorphSection() {
  const [activeModuleId, setActiveModuleId] = useState<string | null>(null)
  const sectionRef = useRef<HTMLElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const cardPositionerRefs = useRef<Array<HTMLDivElement | null>>([])

  useEffect(() => {
    const section = sectionRef.current
    const stage = stageRef.current

    if (!section || !stage) {
      return undefined
    }

    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    let hasIntroStarted = false
    let introComplete = false
    let introAnimationFrameId: number | null = null
    let introStartedAt = 0
    let scrollAnimationFrameId: number | null = null
    let previousLayoutKey = ''
    let previousScrollStage = ''
    let cachedLayout = getLayoutContext(stage.clientWidth, stage.clientHeight)
    let sectionTop = 0
    let scrollableDistance = 1
    let renderedScrollProgress = 0
    let hasRenderedScrollProgress = false
    let lastScrollFrameTime = 0

    const updateLayoutVariables = (layout: LayoutContext) => {
      const layoutKey = [
        Math.round(layout.width),
        Math.round(layout.height),
        layout.cardWidth.toFixed(2),
      ].join('-')

      if (layoutKey === previousLayoutKey) {
        return
      }

      previousLayoutKey = layoutKey
      const circleRadii = getCircleRadii(layout)
      section.style.setProperty('--module-card-width', `${layout.cardWidth}px`)
      section.style.setProperty('--module-card-height', `${layout.cardHeight}px`)
      section.style.setProperty('--modules-circle-radius-x', `${circleRadii.x}px`)
      section.style.setProperty('--modules-circle-radius-y', `${circleRadii.y}px`)
    }

    const measureLayout = () => {
      cachedLayout = getLayoutContext(stage.clientWidth, stage.clientHeight)
      const sectionRect = section.getBoundingClientRect()
      sectionTop = window.scrollY + sectionRect.top
      scrollableDistance = Math.max(section.offsetHeight - window.innerHeight, 1)
      updateLayoutVariables(cachedLayout)
    }

    const applyCardTarget = (index: number, target: CardTarget) => {
      const positioner = cardPositionerRefs.current[index]
      if (!positioner) {
        return
      }

      positioner.style.opacity = target.opacity.toFixed(3)
      positioner.style.zIndex = String(target.depth)
      positioner.style.transform = [
        `translate3d(calc(-50% + ${target.x.toFixed(2)}px), calc(-50% + ${target.y.toFixed(2)}px), 0)`,
        `rotateZ(${target.rotation.toFixed(2)}deg)`,
        `scale(${target.scale.toFixed(4)})`,
      ].join(' ')
    }

    const applyTargets = (targets: CardTarget[]) => {
      targets.forEach((target, index) => applyCardTarget(index, target))
    }

    const setMetrics = (copyY: number, opacity: number) => {
      stage.style.setProperty('--modules-copy-y', `${copyY.toFixed(2)}px`)
      stage.style.setProperty('--modules-metrics-opacity', opacity.toFixed(3))
    }

    const renderIntro = (elapsed: number) => {
      const layout = cachedLayout

      if (elapsed <= INTRO_SCATTER_DURATION) {
        const phaseProgress = smoothstep(0, 1, elapsed / INTRO_SCATTER_DURATION)
        stage.dataset.introPhase = 'scatter'
        stage.style.setProperty('--modules-circle-guide-opacity', '0')
        stage.style.setProperty('--modules-arc-guide-opacity', '0')
        setMetrics(layout.circleCenterOffsetY + 16, 0)
        applyTargets(learningModules.map((_, index) => {
          const scatterTarget = getScatterTarget(index, learningModules.length, layout)
          return interpolateTarget(
            { ...scatterTarget, opacity: 0, scale: 0.72 },
            scatterTarget,
            phaseProgress,
          )
        }))
        return false
      }

      const ribbonEnd = INTRO_SCATTER_DURATION + INTRO_RIBBON_DURATION
      if (elapsed <= ribbonEnd) {
        const phaseProgress = smoothstep(
          0,
          1,
          (elapsed - INTRO_SCATTER_DURATION) / INTRO_RIBBON_DURATION,
        )
        stage.dataset.introPhase = 'ribbon'
        stage.style.setProperty('--modules-circle-guide-opacity', '0')
        stage.style.setProperty('--modules-arc-guide-opacity', '0')
        setMetrics(layout.circleCenterOffsetY + 16, 0)
        applyTargets(learningModules.map((_, index) => interpolateTarget(
          getScatterTarget(index, learningModules.length, layout),
          getRibbonTarget(index, learningModules.length, layout),
          phaseProgress,
        )))
        return false
      }

      const phaseProgress = smoothstep(0, 1, (elapsed - ribbonEnd) / INTRO_CIRCLE_DURATION)
      const metricsProgress = smoothstep(0.24, 0.9, phaseProgress)
      stage.dataset.introPhase = 'circle'
      stage.style.setProperty(
        '--modules-circle-guide-opacity',
        (metricsProgress * 0.56).toFixed(3),
      )
      stage.style.setProperty('--modules-arc-guide-opacity', '0')
      setMetrics(
        layout.circleCenterOffsetY + lerp(18, 0, metricsProgress),
        metricsProgress,
      )
      applyTargets(learningModules.map((_, index) => interpolateTarget(
        getRibbonTarget(index, learningModules.length, layout),
        getCircleTarget(index, learningModules.length, layout),
        phaseProgress,
      )))
      return elapsed >= INTRO_TOTAL_DURATION
    }

    const getScrollProgress = () => {
      return clamp((window.scrollY - sectionTop) / scrollableDistance)
    }

    const updateScrollLayout = (frameTime: number) => {
      if (!introComplete) {
        scrollAnimationFrameId = null
        lastScrollFrameTime = 0
        return
      }

      const { height, width } = cachedLayout
      if (!width || !height) {
        scrollAnimationFrameId = null
        lastScrollFrameTime = 0
        return
      }

      const layout = cachedLayout
      const targetScrollProgress = getScrollProgress()

      if (motionQuery.matches || !hasRenderedScrollProgress) {
        renderedScrollProgress = targetScrollProgress
        hasRenderedScrollProgress = true
      } else {
        const frameDuration = lastScrollFrameTime
          ? Math.min(frameTime - lastScrollFrameTime, 50)
          : 16.67
        const smoothingFactor = 1 - Math.exp(-frameDuration / SCROLL_SMOOTHING_DURATION)
        renderedScrollProgress = lerp(
          renderedScrollProgress,
          targetScrollProgress,
          smoothingFactor,
        )
      }

      lastScrollFrameTime = frameTime
      const progress = renderedScrollProgress
      const morphProgress = motionQuery.matches
        ? 0
        : smoothstep(0.28, 0.52, progress)
      const metricsMorphProgress = motionQuery.matches
        ? 0
        : smoothstep(0.2, 0.44, progress)
      const browseProgress = motionQuery.matches ? 0 : smoothstep(0.62, 0.94, progress)
      const rotationProgress = motionQuery.matches ? 0 : smoothstep(0.28, 0.58, progress)
      const scrollRotation = rotationProgress * 360
      const focusIndex = browseProgress * (learningModules.length - 1)
      const circleCopyY = layout.circleCenterOffsetY
      const arcCopyY = -height * (
        layout.isMobile ? 0.06 : layout.isTablet ? 0.3 : 0.32
      )
      const metricsOpacity = motionQuery.matches || progress <= 0.2
        ? 1
        : progress < 0.275
          ? 1 - smoothstep(0.2, 0.275, progress)
          : progress < 0.5
            ? 0
            : smoothstep(0.5, 0.62, progress)

      stage.style.setProperty('--modules-progress', progress.toFixed(4))
      stage.style.setProperty('--modules-morph', morphProgress.toFixed(4))
      stage.style.setProperty('--modules-browse', browseProgress.toFixed(4))
      stage.style.setProperty('--modules-spin', scrollRotation.toFixed(2))
      stage.style.setProperty(
        '--modules-circle-guide-opacity',
        ((1 - morphProgress) * 0.56).toFixed(3),
      )
      stage.style.setProperty(
        '--modules-arc-guide-opacity',
        (morphProgress * 0.62).toFixed(3),
      )
      stage.style.setProperty(
        '--modules-scroll-cue-opacity',
        (1 - smoothstep(0.02, 0.2, progress)).toFixed(3),
      )
      stage.dataset.focusModule = String(Math.round(focusIndex) + 1).padStart(2, '0')
      setMetrics(
        lerp(circleCopyY, arcCopyY, metricsMorphProgress),
        metricsOpacity,
      )

      const nextScrollStage = motionQuery.matches
        ? 'reduced-circle'
        : progress <= 0.22
          ? 'circle-hold'
          : progress <= 0.62
            ? 'circle-to-arc'
            : progress <= 0.94
              ? 'arc-browsing'
              : 'final-hold'

      if (nextScrollStage !== previousScrollStage) {
        previousScrollStage = nextScrollStage
        stage.dataset.scrollStage = nextScrollStage
      }

      applyTargets(learningModules.map((_, index) => {
        const circleTarget = getCircleTarget(index, learningModules.length, layout)
        const arcTarget = getArcBrowseTarget(index, focusIndex, layout)
        const target = interpolateTarget(circleTarget, arcTarget, morphProgress)
        return {
          ...target,
          rotation: target.rotation + scrollRotation,
        }
      }))

      if (
        !motionQuery.matches
        && Math.abs(targetScrollProgress - renderedScrollProgress) > 0.0002
      ) {
        scrollAnimationFrameId = window.requestAnimationFrame(updateScrollLayout)
      } else {
        renderedScrollProgress = targetScrollProgress
        scrollAnimationFrameId = null
        lastScrollFrameTime = 0
      }
    }

    const scheduleScrollLayout = () => {
      if (scrollAnimationFrameId === null) {
        scrollAnimationFrameId = window.requestAnimationFrame(updateScrollLayout)
      }
    }

    const completeIntroWithoutMotion = () => {
      if (introAnimationFrameId !== null) {
        window.cancelAnimationFrame(introAnimationFrameId)
        introAnimationFrameId = null
      }
      hasIntroStarted = true
      introComplete = true
      stage.dataset.introPhase = 'reduced'
      scheduleScrollLayout()
    }

    const startIntro = () => {
      if (hasIntroStarted) {
        return
      }

      hasIntroStarted = true
      if (motionQuery.matches) {
        completeIntroWithoutMotion()
        return
      }

      introStartedAt = performance.now()
      const animateIntro = (frameTime: number) => {
        const elapsed = Math.min(frameTime - introStartedAt, INTRO_TOTAL_DURATION)
        const hasFinished = renderIntro(elapsed)

        if (hasFinished) {
          introAnimationFrameId = null
          introComplete = true
          stage.dataset.introPhase = 'complete'
          scheduleScrollLayout()
          return
        }

        introAnimationFrameId = window.requestAnimationFrame(animateIntro)
      }

      introAnimationFrameId = window.requestAnimationFrame(animateIntro)
    }

    const handleMotionPreference = () => {
      measureLayout()
      hasRenderedScrollProgress = false
      if (motionQuery.matches) {
        completeIntroWithoutMotion()
      } else if (introComplete) {
        scheduleScrollLayout()
      }
    }

    const intersectionObserver = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting && entry.intersectionRatio >= 0.5)) {
          startIntro()
        }
      },
      { threshold: [0, 0.5, 1] },
    )
    const resizeObserver = new ResizeObserver(() => {
      measureLayout()
      if (introComplete) {
        hasRenderedScrollProgress = false
        scheduleScrollLayout()
      }
    })

    measureLayout()
    if (motionQuery.matches) {
      completeIntroWithoutMotion()
    } else {
      renderIntro(0)
    }

    intersectionObserver.observe(stage)
    resizeObserver.observe(section)
    window.addEventListener('scroll', scheduleScrollLayout, { passive: true })
    window.addEventListener('resize', scheduleScrollLayout)
    motionQuery.addEventListener('change', handleMotionPreference)

    return () => {
      intersectionObserver.disconnect()
      resizeObserver.disconnect()
      window.removeEventListener('scroll', scheduleScrollLayout)
      window.removeEventListener('resize', scheduleScrollLayout)
      motionQuery.removeEventListener('change', handleMotionPreference)
      if (introAnimationFrameId !== null) {
        window.cancelAnimationFrame(introAnimationFrameId)
      }
      if (scrollAnimationFrameId !== null) {
        window.cancelAnimationFrame(scrollAnimationFrameId)
      }
    }
  }, [])

  const toggleModule = (moduleId: string) => {
    setActiveModuleId((currentModuleId) => (
      currentModuleId === moduleId ? null : moduleId
    ))
  }

  const closeModule = (moduleId: string) => {
    setActiveModuleId((currentModuleId) => (
      currentModuleId === moduleId ? null : currentModuleId
    ))
  }

  const handleStagePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (
      event.pointerType !== 'mouse'
      && !(event.target as HTMLElement).closest('.morph-module-card')
    ) {
      setActiveModuleId(null)
    }
  }

  return (
    <section
      aria-labelledby="modules-morph-heading"
      className="modules-morph-section"
      id="modules"
      ref={sectionRef}
    >
      <div className="modules-scroll-track">
        <div
          className="modules-sticky-stage"
          onPointerDown={handleStagePointerDown}
          ref={stageRef}
        >
          <div className="modules-ambient" aria-hidden="true">
            <div className="modules-orbit-guide modules-orbit-circle" />
            <div className="modules-orbit-guide modules-orbit-arc" />
          </div>

          <div className="modules-stage-inner">
            <ModulesMetricsText
              moduleCount={learningModules.length}
              thematicAreaCount={thematicAreaCount}
              totalHours={totalHours}
            />

            <div className="modules-card-field" aria-label="Interactive learning module cards">
              {learningModules.map((learningModule, index) => (
                <MorphModuleCard
                  isFlipped={activeModuleId === learningModule.id}
                  key={learningModule.id}
                  module={learningModule}
                  onClose={closeModule}
                  onToggle={toggleModule}
                  positionerRef={(element) => {
                    cardPositionerRefs.current[index] = element
                  }}
                />
              ))}
            </div>

            <p className="modules-scroll-cue" aria-hidden="true">
              Scroll to explore the learning arc
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}

export default ModulesMorphSection
