import { useEffect, useRef, useState } from 'react'
import './BrainSection.css'

const brainModelPath = '/models/brain.glb'
const modelViewerScriptPath = '/vendor/model-viewer.min.js'
const sideViewStartAzimuth = 82
const sideViewEndAzimuth = 104
const sideViewRestAzimuth = 94
const sideViewDistance = 2.9
const sideViewStartDistance = 3.05
const sideViewEndDistance = 2.78
const brainModelExposure = '0.74'
const brainViewerRevision = 'section-progress-fit-v2'
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
  const cssBase = Math.min(450, window.innerWidth * 0.32)

  return Math.max(cssBase, Math.min(340, window.innerWidth * 0.72))
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
    sideViewEndAzimuth,
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
      decorOpacity: '',
      modelSize: '',
      phase: '',
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
      const baseModelSize = getBaseModelSize()
      const expandedModelSize = getExpandedModelSize(baseModelSize)
      const activeGrowProgress = reduceMotion ? growProgress * 0.55 : growProgress
      const compactModelSize = Math.min(window.innerWidth * 0.92, 420)
      const modelSize = isCompact
        ? compactModelSize
        : lerp(baseModelSize, expandedModelSize, activeGrowProgress) * (1 - exitProgress * 0.08)
      const stageY = isCompact ? 0 : lerp(-40, 0, growProgress)
      const phase =
        progress < 0.25 ? 'layout' : progress < 0.65 ? 'expand' : progress < 0.9 ? 'explore' : 'exit'
      const nextDecorOpacity = scrollState.decorActive ? 'visible' : 'hidden'
      const nextModelSize = `${modelSize.toFixed(1)}px`
      const nextStageY = `${stageY.toFixed(1)}px`

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
        const cameraGrowProgress = smoothstep(0.25, 0.65, cameraProgress)

        cameraOrbitTarget.azimuth = lerp(sideViewStartAzimuth, sideViewEndAzimuth, cameraGrowProgress)
        cameraOrbitTarget.distance = lerp(sideViewStartDistance, sideViewEndDistance, cameraGrowProgress)
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
    </section>
  )
}

export default BrainSection
