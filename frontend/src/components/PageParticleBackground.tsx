import { useEffect, useRef } from 'react'
import './PageParticleBackground.css'

type Particle = {
  baseOpacity: number
  baseRadius: number
  opacity: number
  radius: number
  vx: number
  vy: number
  x: number
  y: number
}

const particleConfig = {
  color: { b: 250, g: 165, r: 96 },
  count: 110,
  densityArea: 900,
  lineColor: { b: 248, g: 189, r: 56 },
  lineDistance: 150,
  lineOpacity: 0.25,
  countScale: 1.15,
  maxCount: 156,
  opacity: 0.42,
  pointSize: 3,
  bubbleDistance: 165,
  bubbleOpacity: 0.55,
  bubbleSize: 3.6,
  grabDistance: 175,
  grabOpacity: 0.5,
  pushCount: 3,
  speed: 1.3 * 0.35,
}

function createParticle(width: number, height: number, x?: number, y?: number): Particle {
  const angle = Math.random() * Math.PI * 2
  const speed = particleConfig.speed * (0.35 + Math.random() * 0.65)
  const opacity = Math.random() * particleConfig.opacity
  const radius = Math.max(0.8, Math.random() * particleConfig.pointSize)

  return {
    baseOpacity: opacity,
    baseRadius: radius,
    opacity,
    radius,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    x: x ?? Math.random() * width,
    y: y ?? Math.random() * height,
  }
}

function rgba(color: { b: number; g: number; r: number }, opacity: number) {
  return 'rgba(' + color.r + ', ' + color.g + ', ' + color.b + ', ' + opacity + ')'
}

function PageParticleBackground() {
  const layerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const layer = layerRef.current

    if (!layer) {
      return undefined
    }

    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')

    if (!context) {
      return undefined
    }

    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const pointerQuery = window.matchMedia('(hover: hover) and (pointer: fine)')
    let animationFrameId = 0
    let height = 1
    let particles: Particle[] = []
    let previousFrameTime = 0
    let width = 1
    let enablePointerInteraction = !motionQuery.matches && pointerQuery.matches

    const pointer = {
      active: false,
      x: 0,
      y: 0,
    }

    canvas.className = 'page-particles-canvas'
    canvas.setAttribute('aria-hidden', 'true')
    layer.replaceChildren(canvas)

    const getParticleCount = () => {
      const densityBase = 1440 * particleConfig.densityArea
      const count = Math.round((particleConfig.count * width * height) / densityBase)

      return Math.min(
        particleConfig.maxCount,
        Math.max(64, Math.round(count * particleConfig.countScale)),
      )
    }

    const resize = () => {
      const bounds = layer.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)

      width = Math.max(1, bounds.width)
      height = Math.max(1, bounds.height)
      canvas.width = Math.floor(width * dpr)
      canvas.height = Math.floor(height * dpr)
      canvas.style.width = width + 'px'
      canvas.style.height = height + 'px'
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
      particles = Array.from({ length: getParticleCount() }, () =>
        createParticle(width, height),
      )
    }

    const updatePointer = (event: MouseEvent) => {
      const bounds = canvas.getBoundingClientRect()
      pointer.x = event.clientX - bounds.left
      pointer.y = event.clientY - bounds.top
      pointer.active =
        pointer.x >= 0 && pointer.x <= width && pointer.y >= 0 && pointer.y <= height
    }

    const clearPointer = () => {
      pointer.active = false
    }

    const handleClick = (event: MouseEvent) => {
      updatePointer(event)
      if (!pointer.active) return

      for (let index = 0; index < particleConfig.pushCount; index += 1) {
        particles.push(createParticle(width, height, pointer.x, pointer.y))
      }
    }

    const applyPointerInteraction = (particle: Particle) => {
      if (!enablePointerInteraction || !pointer.active) {
        particle.radius += (particle.baseRadius - particle.radius) * 0.08
        particle.opacity += (particle.baseOpacity - particle.opacity) * 0.08
        return
      }

      const distance = Math.hypot(particle.x - pointer.x, particle.y - pointer.y)

      if (distance <= particleConfig.bubbleDistance) {
        const influence = 1 - distance / particleConfig.bubbleDistance
        particle.radius +=
          (particleConfig.bubbleSize - particle.radius) * influence * 0.16
        particle.opacity +=
          (particleConfig.bubbleOpacity - particle.opacity) * influence * 0.08
      } else {
        particle.radius += (particle.baseRadius - particle.radius) * 0.08
        particle.opacity += (particle.baseOpacity - particle.opacity) * 0.08
      }

      if (distance <= particleConfig.grabDistance) {
        const opacity =
          particleConfig.grabOpacity * (1 - distance / particleConfig.grabDistance)
        context.beginPath()
        context.moveTo(particle.x, particle.y)
        context.lineTo(pointer.x, pointer.y)
        context.strokeStyle = rgba(particleConfig.lineColor, opacity)
        context.lineWidth = 1
        context.stroke()
      }
    }

    const draw = (frameTime = 0) => {
      const elapsed = previousFrameTime ? frameTime - previousFrameTime : 16.67
      const frameFactor = Math.min(2, elapsed / 16.67)

      previousFrameTime = frameTime
      context.clearRect(0, 0, width, height)

      for (let firstIndex = 0; firstIndex < particles.length; firstIndex += 1) {
        const first = particles[firstIndex]

        for (let secondIndex = firstIndex + 1; secondIndex < particles.length; secondIndex += 1) {
          const second = particles[secondIndex]
          const distance = Math.hypot(first.x - second.x, first.y - second.y)

          if (distance > particleConfig.lineDistance) {
            continue
          }

          const opacity =
            particleConfig.lineOpacity * (1 - distance / particleConfig.lineDistance)
          context.beginPath()
          context.moveTo(first.x, first.y)
          context.lineTo(second.x, second.y)
          context.strokeStyle = rgba(particleConfig.lineColor, opacity)
          context.lineWidth = 1
          context.stroke()
        }
      }

      particles.forEach((particle) => {
        applyPointerInteraction(particle)

        if (!motionQuery.matches) {
          particle.x += particle.vx * frameFactor
          particle.y += particle.vy * frameFactor

          if (particle.x < -particle.radius) particle.x = width + particle.radius
          if (particle.x > width + particle.radius) particle.x = -particle.radius
          if (particle.y < -particle.radius) particle.y = height + particle.radius
          if (particle.y > height + particle.radius) particle.y = -particle.radius
        }

        context.beginPath()
        context.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2)
        context.fillStyle = rgba(particleConfig.color, particle.opacity)
        context.fill()
      })

      if (!motionQuery.matches) {
        animationFrameId = window.requestAnimationFrame(draw)
      }
    }

    const handleMotionPreference = () => {
      window.cancelAnimationFrame(animationFrameId)
      enablePointerInteraction = !motionQuery.matches && pointerQuery.matches
      if (!enablePointerInteraction) clearPointer()
      previousFrameTime = 0
      draw()
    }

    const handlePointerPreference = () => {
      enablePointerInteraction = !motionQuery.matches && pointerQuery.matches
      if (!enablePointerInteraction) clearPointer()
    }

    const handleResize = () => {
      resize()
      if (motionQuery.matches) draw()
    }

    resize()
    draw()
    window.addEventListener('resize', handleResize)
    window.addEventListener('mousemove', updatePointer)
    window.addEventListener('mouseout', clearPointer)
    window.addEventListener('click', handleClick)
    motionQuery.addEventListener('change', handleMotionPreference)
    pointerQuery.addEventListener('change', handlePointerPreference)

    return () => {
      window.cancelAnimationFrame(animationFrameId)
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('mousemove', updatePointer)
      window.removeEventListener('mouseout', clearPointer)
      window.removeEventListener('click', handleClick)
      motionQuery.removeEventListener('change', handleMotionPreference)
      pointerQuery.removeEventListener('change', handlePointerPreference)
      particles = []
      canvas.remove()
    }
  }, [])

  return <div aria-hidden="true" className="page-particle-background" ref={layerRef} />
}

export default PageParticleBackground
