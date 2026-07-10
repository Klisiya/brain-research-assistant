import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import BrainHotspots from './BrainHotspots'
import './BrainSection.css'
import { brainHotspots, type BrainHotspot } from '../data/brainHotspots'

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

type BrainRegionLabelState = {
  region: BrainHotspot
  hotspot: HTMLButtonElement
  line: SVGPathElement
  label: HTMLAnchorElement
  x: number | null
  y: number | null
  opacity: number
  hovered: boolean
  side: number | null
}

type BrainRegionLabelCandidate = {
  state: BrainRegionLabelState
  side: number
  dotX: number
  dotY: number
  targetLeft: number
  targetTop: number
  width: number
  height: number
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

function hotspotIsVisible(hotspot: HTMLButtonElement) {
  return hotspot.hasAttribute('visible') || hotspot.hasAttribute('data-visible')
}

function resolveLabelColumn(
  items: BrainRegionLabelCandidate[],
  minTop: number,
  maxTop: number,
) {
  const minGap = window.innerWidth < 760 ? 8 : 12

  items.sort((a, b) => a.targetTop - b.targetTop)

  items.forEach((current, index) => {
    const previous = items[index - 1]

    if (previous) {
      current.targetTop = Math.max(current.targetTop, previous.targetTop + previous.height + minGap)
    }

    current.targetTop = Math.max(current.targetTop, minTop)
  })

  for (let index = items.length - 1; index >= 0; index -= 1) {
    const next = items[index + 1]
    const current = items[index]

    if (next) {
      current.targetTop = Math.min(current.targetTop, next.targetTop - current.height - minGap)
    }

    current.targetTop = Math.min(current.targetTop, maxTop - current.height)
    current.targetTop = Math.max(current.targetTop, minTop)
  }
}

function BrainSection() {
  const navigate = useNavigate()
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
  const regionLineLayerRef = useRef<SVGSVGElement>(null)
  const regionLabelLayerRef = useRef<HTMLDivElement>(null)
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
    const regionLineLayer = regionLineLayerRef.current
    const regionLabelLayer = regionLabelLayerRef.current
    const section = sectionRef.current

    if (!modelMount || !regionLineLayer || !regionLabelLayer || !section || !viewerReady) {
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
      labelOpacity: '',
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
    const labelStates: BrainRegionLabelState[] = []
    const siteNavbar = document.querySelector<HTMLElement>('.navbar')
    const hotspotListenerCleanups: Array<() => void> = []

    let animationFrame = 0
    let isBrainDragging = false
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
    regionLineLayer.replaceChildren()
    regionLabelLayer.replaceChildren()

    const applyHiddenRegionState = (state: BrainRegionLabelState, immediate = false) => {
      const ease = motionQuery.matches || immediate ? 1 : 0.28

      state.opacity = lerp(state.opacity, 0, ease)

      if (state.opacity < 0.01) {
        state.opacity = 0
      }

      const opacity = state.opacity.toFixed(3)
      const visibility = state.opacity > 0.02 ? 'visible' : 'hidden'

      state.label.style.opacity = opacity
      state.label.style.pointerEvents = 'none'
      state.label.style.visibility = visibility
      state.label.tabIndex = -1
      state.label.setAttribute('aria-hidden', 'true')
      state.line.style.opacity = opacity
      state.line.style.visibility = visibility
      state.hotspot.style.visibility = visibility
    }

    const createBrainRegionHotspots = () => {
      const svgNamespace = 'http://www.w3.org/2000/svg'

      brainHotspots.forEach((region) => {
        const hotspot = document.createElement('button')
        hotspot.type = 'button'
        hotspot.className = 'brain-hotspot'
        hotspot.slot = `hotspot-${region.id}`
        hotspot.dataset.regionId = region.id
        hotspot.dataset.position = region.position
        hotspot.dataset.normal = region.normal
        hotspot.dataset.visibilityAttribute = 'visible'
        hotspot.setAttribute('aria-hidden', 'true')
        hotspot.tabIndex = -1

        const dot = document.createElement('span')
        dot.className = 'brain-hotspot-dot'
        hotspot.appendChild(dot)

        const line = document.createElementNS(svgNamespace, 'path')
        line.classList.add('brain-region-line')
        line.dataset.regionId = region.id
        line.setAttribute('aria-hidden', 'true')
        regionLineLayer.appendChild(line)

        const label = document.createElement('a')
        label.className = 'brain-region-label'
        label.href = region.url
        label.textContent = region.label
        label.dataset.regionId = region.id
        label.dataset.priority = String(region.priority)
        label.dataset.url = region.url
        label.dataset.side = region.side
        label.tabIndex = -1
        label.setAttribute('aria-hidden', 'true')
        label.setAttribute('aria-label', `Open ${region.label} overview`)

        regionLabelLayer.appendChild(label)
        model.appendChild(hotspot)

        const labelState: BrainRegionLabelState = {
          region,
          hotspot,
          line,
          label,
          x: null,
          y: null,
          opacity: 0,
          hovered: false,
          side: null,
        }

        const handlePointerEnter = () => {
          labelState.hovered = true
        }
        const handlePointerLeave = () => {
          labelState.hovered = false
        }
        const handlePointerDown = (event: PointerEvent) => {
          event.stopPropagation()
        }
        const handleClick = (event: MouseEvent) => {
          event.preventDefault()
          event.stopPropagation()
          navigate(region.url)
        }

        label.addEventListener('pointerenter', handlePointerEnter)
        label.addEventListener('pointerleave', handlePointerLeave)
        label.addEventListener('focus', handlePointerEnter)
        label.addEventListener('blur', handlePointerLeave)
        label.addEventListener('pointerdown', handlePointerDown)
        label.addEventListener('click', handleClick)
        hotspotListenerCleanups.push(() => {
          label.removeEventListener('pointerenter', handlePointerEnter)
          label.removeEventListener('pointerleave', handlePointerLeave)
          label.removeEventListener('focus', handlePointerEnter)
          label.removeEventListener('blur', handlePointerLeave)
          label.removeEventListener('pointerdown', handlePointerDown)
          label.removeEventListener('click', handleClick)
        })

        labelStates.push(labelState)
      })
    }

    const updateRegionLabels = () => {
      const labelOpacity = Number(section.style.getPropertyValue('--brain-label-opacity') || 0)
      const sectionRect = section.getBoundingClientRect()
      const sectionVisible = sectionRect.bottom > 0 && sectionRect.top < window.innerHeight
      const labelsActive = sectionVisible && labelOpacity > 0.02

      section.classList.toggle('brain-labels-enabled', labelsActive)

      if (!labelsActive) {
        labelStates.forEach((state) => applyHiddenRegionState(state))
        return
      }

      const overlayRect = regionLabelLayer.getBoundingClientRect()
      const modelRect = model.getBoundingClientRect()

      if (overlayRect.width <= 0 || overlayRect.height <= 0 || modelRect.width <= 0) {
        labelStates.forEach((state) => applyHiddenRegionState(state, true))
        return
      }

      const navRect = siteNavbar ? siteNavbar.getBoundingClientRect() : null
      const isPhone = window.innerWidth < 680
      const connectorGap = window.innerWidth < 760 ? 24 : 42
      const columnGap = window.innerWidth < 760 ? 34 : 56
      const horizontalFollowLimit = window.innerWidth < 760 ? 10 : 18
      const minLeft = window.innerWidth < 760 ? 10 : 18
      const maxLeft = overlayRect.width - minLeft
      const navSafeTop = navRect ? Math.max(18, navRect.bottom - overlayRect.top + 14) : 24
      const minTop = Math.max(18, navSafeTop)
      const maxTop = Math.max(minTop + 80, overlayRect.height - 24)
      const modelLeft = modelRect.left - overlayRect.left
      const modelTop = modelRect.top - overlayRect.top
      const modelWidth = modelRect.width
      const modelHeight = modelRect.height
      const modelCenterX = modelLeft + modelWidth / 2
      const modelInsetX = modelWidth * (isPhone ? 0.06 : 0.08)
      const modelInsetY = modelHeight * (isPhone ? 0.08 : 0.1)
      const brainBounds = {
        bottom: modelTop + modelHeight - modelInsetY,
        left: modelLeft + modelInsetX,
        right: modelLeft + modelWidth - modelInsetX,
        top: modelTop + modelInsetY,
      }
      const candidates: { left: BrainRegionLabelCandidate[]; right: BrainRegionLabelCandidate[] } =
        {
          left: [],
          right: [],
        }

      regionLineLayer.setAttribute('viewBox', `0 0 ${overlayRect.width} ${overlayRect.height}`)
      regionLineLayer.setAttribute('width', String(overlayRect.width))
      regionLineLayer.setAttribute('height', String(overlayRect.height))

      labelStates.forEach((state) => {
        const { region, hotspot, label } = state
        const hiddenOnPhone = window.innerWidth < 760 && region.priority > 4
        const visible = !hiddenOnPhone && hotspotIsVisible(hotspot)

        if (!visible) {
          applyHiddenRegionState(state)
          return
        }

        const hotspotRect = hotspot.getBoundingClientRect()
        const labelWidth = label.offsetWidth || 148
        const labelHeight = label.offsetHeight || 42
        const dotX = hotspotRect.left + hotspotRect.width / 2 - overlayRect.left
        const dotY = hotspotRect.top + hotspotRect.height / 2 - overlayRect.top
        const dotInBounds =
          Number.isFinite(dotX) &&
          Number.isFinite(dotY) &&
          dotX >= 0 &&
          dotX <= overlayRect.width &&
          dotY >= 0 &&
          dotY <= overlayRect.height

        if (!dotInBounds) {
          applyHiddenRegionState(state)
          return
        }

        const preferredSide = region.side === 'left' ? -1 : 1
        const canFitRight = brainBounds.right + columnGap + labelWidth <= maxLeft
        const canFitLeft = brainBounds.left - columnGap - labelWidth >= minLeft
        let side = state.hovered && state.side ? state.side : preferredSide

        if (side > 0 && !canFitRight && canFitLeft) {
          side = -1
        } else if (side < 0 && !canFitLeft && canFitRight) {
          side = 1
        }

        const horizontalNudge = clamp(
          (dotX - modelCenterX) * 0.1,
          -horizontalFollowLimit,
          horizontalFollowLimit,
        )
        let rawLeft =
          side > 0
            ? brainBounds.right + columnGap + Math.max(0, horizontalNudge)
            : brainBounds.left - columnGap - labelWidth + Math.min(0, horizontalNudge)

        rawLeft =
          side > 0
            ? Math.max(rawLeft, dotX + connectorGap)
            : Math.min(rawLeft, dotX - connectorGap - labelWidth)

        const targetLeft = clamp(rawLeft, minLeft, maxLeft - labelWidth)
        const targetTop = clamp(
          dotY - labelHeight / 2,
          Math.max(minTop, brainBounds.top - labelHeight * 0.8),
          Math.min(maxTop - labelHeight, brainBounds.bottom + labelHeight * 0.8),
        )
        const groupName = side < 0 ? 'left' : 'right'

        candidates[groupName].push({
          state,
          side,
          dotX,
          dotY,
          targetLeft,
          targetTop,
          width: labelWidth,
          height: labelHeight,
        })
      })

      resolveLabelColumn(candidates.left, minTop, maxTop)
      resolveLabelColumn(candidates.right, minTop, maxTop)

      ;[...candidates.left, ...candidates.right].forEach((item) => {
        const { state, side, dotX, dotY, targetLeft, targetTop } = item
        const ease = motionQuery.matches ? 1 : state.hovered ? 0.035 : 0.12
        const deadzone = state.hovered ? 28 : 1.8
        const targetOpacity = labelOpacity

        if (state.x === null) {
          state.x = targetLeft
        } else if (Math.abs(targetLeft - state.x) > deadzone) {
          state.x = lerp(state.x, targetLeft, ease)
        }

        if (state.y === null) {
          state.y = targetTop
        } else if (Math.abs(targetTop - state.y) > deadzone) {
          state.y = lerp(state.y, targetTop, ease)
        }

        state.opacity = lerp(state.opacity, targetOpacity, ease)
        state.side = side

        state.label.style.left = `${state.x.toFixed(1)}px`
        state.label.style.top = `${state.y.toFixed(1)}px`
        state.label.style.transform = 'none'
        state.label.style.opacity = state.opacity.toFixed(3)
        state.label.style.pointerEvents = state.opacity > 0.35 && !isBrainDragging ? 'auto' : 'none'
        state.label.style.visibility = state.opacity > 0.02 ? 'visible' : 'hidden'
        state.label.tabIndex = state.opacity > 0.35 && !isBrainDragging ? 0 : -1
        state.label.setAttribute('aria-hidden', state.opacity > 0.02 ? 'false' : 'true')
        state.label.dataset.side = side > 0 ? 'right' : 'left'
        state.hotspot.style.visibility = state.opacity > 0.02 ? 'visible' : 'hidden'

        const labelRect = state.label.getBoundingClientRect()
        const labelInset = window.innerWidth < 760 ? 5 : 8
        const labelEdgeX =
          side > 0
            ? labelRect.left - overlayRect.left + labelInset
            : labelRect.right - overlayRect.left - labelInset
        const labelCenterY = labelRect.top + labelRect.height / 2 - overlayRect.top
        const lineDeltaX = labelEdgeX - dotX
        const lineDeltaY = labelCenterY - dotY
        const lineDistance = Math.hypot(lineDeltaX, lineDeltaY) || 1
        const dotRadius = window.innerWidth < 760 ? 5 : 6
        const lineStartX = dotX + (lineDeltaX / lineDistance) * dotRadius
        const lineStartY = dotY + (lineDeltaY / lineDistance) * dotRadius
        const direction = side > 0 ? 1 : -1
        const spanX = Math.abs(labelEdgeX - lineStartX)
        const curveReach = clamp(spanX * 0.52, 24, window.innerWidth < 760 ? 58 : 118)
        const naturalBend = (state.region.priority % 2 === 0 ? -1 : 1) * (window.innerWidth < 760 ? 7 : 14)
        const curveLift = clamp((labelCenterY - lineStartY) * 0.18 + naturalBend, -34, 34)
        const controlOneX = lineStartX + direction * curveReach * 0.52
        const controlOneY = lineStartY + curveLift
        const controlTwoX = labelEdgeX - direction * curveReach
        const controlTwoY = labelCenterY + curveLift * 0.62
        const connectorPath = [
          `M ${lineStartX.toFixed(1)} ${lineStartY.toFixed(1)}`,
          `C ${controlOneX.toFixed(1)} ${controlOneY.toFixed(1)}`,
          `${controlTwoX.toFixed(1)} ${controlTwoY.toFixed(1)}`,
          `${labelEdgeX.toFixed(1)} ${labelCenterY.toFixed(1)}`,
        ].join(' ')

        state.line.setAttribute('d', connectorPath)
        state.line.style.opacity = state.opacity.toFixed(3)
        state.line.style.visibility = state.opacity > 0.02 ? 'visible' : 'hidden'
      })
    }

    createBrainRegionHotspots()

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
      const labelProgress = smoothstep(0.62, 0.72, progress) * (1 - smoothstep(0.9, 0.98, progress))
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
      const nextLabelOpacity = (isCompact ? 1 : clamp(labelProgress, 0, 1)).toFixed(3)
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

      if (renderedScrollState.labelOpacity !== nextLabelOpacity) {
        renderedScrollState.labelOpacity = nextLabelOpacity
        section.style.setProperty('--brain-label-opacity', nextLabelOpacity)
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
      updateRegionLabels()
      animationFrame = window.requestAnimationFrame(animate)
    }

    const handlePointerDown = () => {
      isBrainDragging = true
      section.classList.add('is-brain-dragging')

      if (scrollState.currentProgress >= 0.6) {
        userAdjustedCamera = true
      }
    }

    const handlePointerRelease = () => {
      isBrainDragging = false
      section.classList.remove('is-brain-dragging')
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
    window.addEventListener('pointerup', handlePointerRelease)
    window.addEventListener('pointercancel', handlePointerRelease)
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
      window.removeEventListener('pointerup', handlePointerRelease)
      window.removeEventListener('pointercancel', handlePointerRelease)
      motionQuery.removeEventListener('change', updateScrollTarget)
      model.removeEventListener('load', handleModelLoad)
      model.removeEventListener('error', handleModelError)
      model.removeEventListener('pointerdown', handlePointerDown)
      hotspotListenerCleanups.forEach((cleanup) => cleanup())
      section.classList.remove('brain-labels-enabled', 'is-brain-dragging')
      regionLineLayer.replaceChildren()
      regionLabelLayer.replaceChildren()
      model.remove()
    }
  }, [viewerReady, brainViewerSignature, navigate])

  return (
    <section ref={sectionRef} className="brain-section" aria-label="Interactive 3D brain model">
      <div className="brain-section-stage">
        <div className="brain-section-visual">
          <div className="brain-section-glow" aria-hidden="true" />
          <div className="brain-section-orbit brain-section-orbit-one" aria-hidden="true" />
          <div className="brain-section-orbit brain-section-orbit-two" aria-hidden="true" />
          <BrainHotspots lineLayerRef={regionLineLayerRef} labelLayerRef={regionLabelLayerRef} />

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
