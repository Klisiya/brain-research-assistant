import { useEffect, useRef, useState } from 'react'
import './BrainSection.css'

const brainModelPath = '/models/brain.glb'
const modelViewerScriptPath = '/vendor/model-viewer.min.js'
const sideViewStartAzimuth = -30
const sideViewRotationRange = 120
const sideViewRestAzimuth = -30
const sideViewDistance = 2.9
const sideViewStartDistance = 3.05
const sideViewEndDistance = 2.78
const brainModelExposure = '0.74'
const brainViewerRevision = 'section-progress-orbit-v3'
const brainParticleEmissiveColor = [0.784, 0.957, 1] as const
const brainParticleBaseColor = [0, 0, 0, 1] as const
const showcaseScrollStartDelay = 0.12
const showcaseScrollEndOffset = 1

type ModelViewerRgbColor = readonly [number, number, number]
type ModelViewerRgbaColor = readonly [number, number, number, number]

type ModelViewerMaterial = {
  pbrMetallicRoughness?: {
    setBaseColorFactor?: (color: ModelViewerRgbaColor) => void
  }
  setEmissiveFactor?: (color: ModelViewerRgbColor) => void
}

type BrainModelViewerElement = HTMLElement & {
  loaded?: boolean
  model?: {
    materials?: ModelViewerMaterial[]
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function lerp(start: number, end: number, amount: number) {
  return start + (end - start) * amount
}

function smoothstep(start: number, end: number, value: number) {
  const amount = clamp((value - start) / (end - start), 0, 1)

  return amount * amount * (3 - 2 * amount)
}

function getBaseModelSize() {
  const cssBase = Math.min(480, window.innerWidth * 0.34)

  return Math.max(cssBase, Math.min(360, window.innerWidth * 0.72))
}

function getExpandedModelSize(baseSize: number) {
  const heightLimit = window.innerHeight * 0.78
  const widthLimit = window.innerWidth * (window.innerWidth < 900 ? 0.86 : 0.72)

  return Math.max(baseSize, Math.min(heightLimit, widthLimit, 860))
}

function getShowcaseProgress(section: HTMLElement) {
  const sectionTop = section.getBoundingClientRect().top + window.scrollY
  const scrollStart = sectionTop + window.innerHeight * showcaseScrollStartDelay
  const scrollEnd = sectionTop + section.offsetHeight - window.innerHeight * showcaseScrollEndOffset
  const scrollableDistance = Math.max(1, scrollEnd - scrollStart)

  return clamp((window.scrollY - scrollStart) / scrollableDistance, 0, 1)
}

function ensureModelViewerScript() {
  if (customElements.get('model-viewer')) {
    return Promise.resolve()
  }

  const existingScript = document.querySelector<HTMLScriptElement>(
    `script[src="${modelViewerScriptPath}"]`,
  )

  if (!existingScript) {
    const script = document.createElement('script')
    script.src = modelViewerScriptPath
    script.type = 'module'
    document.head.appendChild(script)
  }

  return customElements.whenDefined('model-viewer')
}

function applyUnifiedBrainParticleColor(model: BrainModelViewerElement) {
  model.model?.materials?.forEach((material) => {
    material.pbrMetallicRoughness?.setBaseColorFactor?.(brainParticleBaseColor)
    material.setEmissiveFactor?.(brainParticleEmissiveColor)
  })
}

function BrainSection() {
  const brainViewerSignature = [
    brainViewerRevision,
    sideViewStartAzimuth,
    sideViewRotationRange,
    sideViewRestAzimuth,
    sideViewDistance,
    sideViewStartDistance,
    sideViewEndDistance,
    brainModelExposure,
  ].join(':')
  const modelMountRef = useRef<HTMLDivElement>(null)
  const sectionRef = useRef<HTMLElement>(null)
  const [loadError, setLoadError] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [viewerReady, setViewerReady] = useState(() => customElements.get('model-viewer') !== undefined)

  useEffect(() => {
    let disposed = false

    ensureModelViewerScript()
      .then(() => {
        if (!disposed) {
          setViewerReady(true)
        }
      })
      .catch((error: unknown) => {
        if (!disposed) {
          console.error('Failed to load model-viewer:', error)
          setLoadError(true)
          setIsLoading(false)
        }
      })

    return () => {
      disposed = true
    }
  }, [])

  useEffect(() => {
    const modelMount = modelMountRef.current
    const section = sectionRef.current

    if (!modelMount || !section || !viewerReady) {
      return undefined
    }

    const model = document.createElement('model-viewer') as BrainModelViewerElement
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const scrollState = {
      currentProgress: Number.NaN,
      decorActive: false,
      targetProgress: 0,
      isCompact: false,
      reduceMotion: false,
    }
    const renderedScrollState = {
      cameraOrbit: '',
      copyOpacity: '',
      copyPointerEvents: '',
      copyVisibility: '',
      copyY: '',
      decorOpacity: '',
      leftX: '',
      modelSize: '',
      phase: '',
      rightX: '',
      stageY: '',
    }
    const cameraOrbitTarget = {
      azimuth: sideViewRestAzimuth,
      distance: sideViewDistance,
    }
    const cameraOrbitCurrent = {
      azimuth: sideViewRestAzimuth,
      distance: sideViewDistance,
    }

    let animationFrame = 0
    let userAdjustedCamera = false

    const modelAttributes = {
      alt: '3D brain model',
      'camera-controls': '',
      'camera-orbit': `${sideViewRestAzimuth}deg 72deg ${sideViewDistance}m`,
      'camera-target': '0m 0m 0m',
      crossorigin: 'anonymous',
      'disable-zoom': '',
      exposure: brainModelExposure,
      'field-of-view': '28deg',
      'interaction-prompt': 'none',
      loading: 'eager',
      'max-camera-orbit': 'auto auto 3.5m',
      'min-camera-orbit': 'auto auto 2.35m',
      'shadow-intensity': '0',
      src: brainModelPath,
    }

    Object.entries(modelAttributes).forEach(([name, value]) => {
      model.setAttribute(name, value)
    })
    modelMount.replaceChildren(model)

    const setCameraOrbit = () => {
      const nextCameraOrbit = `${cameraOrbitCurrent.azimuth.toFixed(2)}deg 72deg ${cameraOrbitCurrent.distance.toFixed(2)}m`

      if (renderedScrollState.cameraOrbit !== nextCameraOrbit) {
        renderedScrollState.cameraOrbit = nextCameraOrbit
        model.setAttribute('camera-orbit', nextCameraOrbit)
        model.setAttribute('camera-target', '0m 0m 0m')
      }
    }

    const updateScrollTarget = () => {
      const rect = section.getBoundingClientRect()
      scrollState.isCompact = window.innerWidth < 760
      scrollState.reduceMotion = motionQuery.matches
      scrollState.decorActive =
        scrollState.isCompact || (rect.top <= 0 && rect.bottom >= window.innerHeight)
      scrollState.targetProgress = scrollState.isCompact ? 0.24 : getShowcaseProgress(section)
    }

    const applyScrollTransform = () => {
      if (!Number.isFinite(scrollState.currentProgress)) {
        scrollState.currentProgress = scrollState.targetProgress
      } else {
        const progressDelta = scrollState.targetProgress - scrollState.currentProgress
        scrollState.currentProgress += progressDelta * 0.85

        if (Math.abs(progressDelta) < 0.001) {
          scrollState.currentProgress = scrollState.targetProgress
        }
      }

      const { isCompact, reduceMotion } = scrollState
      const progress = scrollState.currentProgress
      const growProgress = smoothstep(0.25, 0.65, progress)
      const exitProgress = smoothstep(0.9, 1, progress)
      const textFadeProgress = reduceMotion ? 0 : smoothstep(0.25, 0.65, progress)
      const baseModelSize = getBaseModelSize()
      const expandedModelSize = getExpandedModelSize(baseModelSize)
      const activeGrowProgress = reduceMotion ? growProgress * 0.55 : growProgress
      const compactModelSize = Math.min(window.innerWidth * 0.92, 420)
      const modelSize = isCompact
        ? compactModelSize
        : lerp(baseModelSize, expandedModelSize, activeGrowProgress) * (1 - exitProgress * 0.08)
      const stageY = isCompact ? 0 : 45
      const copyOpacity = isCompact ? 1 : clamp(1 - textFadeProgress, 0, 1)
      const leftX = isCompact ? 0 : lerp(0, -86, textFadeProgress)
      const rightX = isCompact ? 0 : lerp(0, 86, textFadeProgress)
      const copyY = isCompact ? 0 : -40
      const phase =
        progress < 0.25 ? 'layout' : progress < 0.65 ? 'expand' : progress < 0.9 ? 'explore' : 'exit'
      const copyVisible = copyOpacity > 0.02
      const nextDecorOpacity = scrollState.decorActive ? 'visible' : 'hidden'
      const nextModelSize = `${modelSize.toFixed(1)}px`
      const nextStageY = `${stageY.toFixed(1)}px`
      const nextCopyOpacity = copyOpacity.toFixed(3)
      const nextLeftX = `${leftX.toFixed(1)}px`
      const nextRightX = `${rightX.toFixed(1)}px`
      const nextCopyY = `${copyY}px`
      const nextCopyVisibility = copyVisible ? 'visible' : 'hidden'
      const nextCopyPointerEvents = copyVisible ? 'auto' : 'none'

      if (renderedScrollState.decorOpacity !== nextDecorOpacity) {
        renderedScrollState.decorOpacity = nextDecorOpacity
        section.style.setProperty('--brain-stage-glow-opacity', scrollState.decorActive ? '1' : '0')
        section.style.setProperty('--brain-glow-opacity', scrollState.decorActive ? '0.78' : '0')
        section.style.setProperty('--brain-orbit-opacity', scrollState.decorActive ? '0.62' : '0')
      }

      if (renderedScrollState.phase !== phase) {
        renderedScrollState.phase = phase
        section.dataset.showcasePhase = phase
      }

      if (renderedScrollState.copyOpacity !== nextCopyOpacity) {
        renderedScrollState.copyOpacity = nextCopyOpacity
        section.style.setProperty('--brain-copy-opacity', nextCopyOpacity)
      }

      if (renderedScrollState.copyVisibility !== nextCopyVisibility) {
        renderedScrollState.copyVisibility = nextCopyVisibility
        section.style.setProperty('--brain-copy-visibility', nextCopyVisibility)
      }

      if (renderedScrollState.copyPointerEvents !== nextCopyPointerEvents) {
        renderedScrollState.copyPointerEvents = nextCopyPointerEvents
        section.style.setProperty('--brain-copy-pointer-events', nextCopyPointerEvents)
      }

      if (renderedScrollState.leftX !== nextLeftX) {
        renderedScrollState.leftX = nextLeftX
        section.style.setProperty('--brain-left-x', nextLeftX)
      }

      if (renderedScrollState.rightX !== nextRightX) {
        renderedScrollState.rightX = nextRightX
        section.style.setProperty('--brain-right-x', nextRightX)
      }

      if (renderedScrollState.copyY !== nextCopyY) {
        renderedScrollState.copyY = nextCopyY
        section.style.setProperty('--brain-copy-y', nextCopyY)
      }

      if (renderedScrollState.modelSize !== nextModelSize) {
        renderedScrollState.modelSize = nextModelSize
        section.style.setProperty('--brain-model-size', nextModelSize)
      }

      if (renderedScrollState.stageY !== nextStageY) {
        renderedScrollState.stageY = nextStageY
        section.style.setProperty('--brain-stage-y', nextStageY)
      }

      if (!userAdjustedCamera && !reduceMotion && !isCompact) {
        const cameraProgress = Math.min(progress, 0.65)

        cameraOrbitTarget.azimuth = sideViewStartAzimuth + cameraProgress * sideViewRotationRange
        cameraOrbitTarget.distance = lerp(sideViewStartDistance, sideViewEndDistance, growProgress)
      } else if (!userAdjustedCamera) {
        cameraOrbitTarget.azimuth = sideViewRestAzimuth
        cameraOrbitTarget.distance = sideViewDistance
      }
    }

    const animate = () => {
      applyScrollTransform()
      cameraOrbitCurrent.azimuth += (cameraOrbitTarget.azimuth - cameraOrbitCurrent.azimuth) * 0.14
      cameraOrbitCurrent.distance += (cameraOrbitTarget.distance - cameraOrbitCurrent.distance) * 0.14
      setCameraOrbit()
      animationFrame = window.requestAnimationFrame(animate)
    }

    const handlePointerDown = () => {
      if (scrollState.currentProgress >= 0.6) {
        userAdjustedCamera = true
      }
    }

    const handleModelLoad = () => {
      applyUnifiedBrainParticleColor(model)
      setIsLoading(false)
      setLoadError(false)
    }

    const handleModelError = (error: Event) => {
      console.error('Failed to load brain model:', error)
      setLoadError(true)
      setIsLoading(false)
    }

    const handleResize = () => {
      updateScrollTarget()
    }

    updateScrollTarget()
    applyScrollTransform()
    setCameraOrbit()
    animate()

    window.addEventListener('scroll', updateScrollTarget, { passive: true })
    window.addEventListener('resize', handleResize)
    motionQuery.addEventListener('change', updateScrollTarget)
    model.addEventListener('load', handleModelLoad)
    model.addEventListener('error', handleModelError)
    model.addEventListener('pointerdown', handlePointerDown)

    if ('loaded' in model && model.loaded) {
      handleModelLoad()
    }

    return () => {
      window.cancelAnimationFrame(animationFrame)
      window.removeEventListener('scroll', updateScrollTarget)
      window.removeEventListener('resize', handleResize)
      motionQuery.removeEventListener('change', updateScrollTarget)
      model.removeEventListener('load', handleModelLoad)
      model.removeEventListener('error', handleModelError)
      model.removeEventListener('pointerdown', handlePointerDown)
      model.remove()
    }
  }, [viewerReady, brainViewerSignature])

  return (
    <section ref={sectionRef} className="brain-section" aria-label="Interactive 3D brain model">
      <div className="brain-section-stage">
        <div className="brain-section-visual">
          <div className="brain-section-glow" aria-hidden="true" />
          <div className="brain-section-orbit brain-section-orbit-one" aria-hidden="true" />
          <div className="brain-section-orbit brain-section-orbit-two" aria-hidden="true" />

          <div className="brain-section-model-layer">
            <div ref={modelMountRef} className="brain-scene" aria-label="3D brain model viewer" />

            {(isLoading || loadError) && (
              <div className="brain-scene-status" role="status">
                {loadError ? 'Unable to load brain model.' : 'Loading brain model...'}
              </div>
            )}
          </div>
        </div>

        <div className="brain-section-content" aria-label="Brain visualization overview">
          <div className="brain-showcase-copy brain-showcase-left">
            <span className="brain-section-tag">Neural Visualization</span>

            <h2>A digital brain built from signals, data, and cognition.</h2>

            <p>
              This interactive model represents the brain as a dynamic system of neural activity,
              information flow, and intelligent computation.
            </p>

            <div className="brain-showcase-mini-stats">
              <div>
                <strong>3D</strong>
                <span>Interactive Model</span>
              </div>

              <div>
                <strong>AI</strong>
                <span>Learning Support</span>
              </div>
            </div>
          </div>

          <div className="brain-showcase-right" aria-label="Brain research learning areas">
            <div className="brain-showcase-info-card">
              <span>01</span>
              <h3>Brain Science</h3>
              <p>Understand neural structure, cognitive function, memory, learning, and brain activity.</p>
            </div>

            <div className="brain-showcase-info-card">
              <span>02</span>
              <h3>Brain-Inspired Intelligence</h3>
              <p>Explore how biological neural systems inspire artificial intelligence and intelligent computing.</p>
            </div>

            <div className="brain-showcase-info-card">
              <span>03</span>
              <h3>AI Tutor</h3>
              <p>Ask questions and receive guided explanations for complex brain research topics.</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

export default BrainSection
