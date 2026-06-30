import { useEffect, useRef } from 'react'
import './Hero.css'

type Particle = {
  baseOpacity: number
  baseRadius: number
  opacity: number
  radius: number
  speed: number
  vx: number
  vy: number
  x: number
  y: number
}

const particleSpeedScale = 0.35
const particleCountScale = 1.15
const maxParticleCount = 156

const particleConfig = {
  particles: {
    number: {
      value: 110,
      density: {
        valueArea: 900,
      },
    },
    color: '#60a5fa',
    opacity: {
      value: 0.42,
      random: true,
    },
    size: {
      value: 3,
      random: true,
    },
    lineLinked: {
      distance: 150,
      color: '#38bdf8',
      opacity: 0.25,
      width: 1,
    },
    move: {
      speed: 1.3,
    },
  },
  interactivity: {
    grab: {
      distance: 175,
      opacity: 0.5,
    },
    push: {
      particlesNumber: 3,
    },
    bubble: {
      distance: 165,
      size: 3.6,
      opacity: 0.55,
      speed: 2,
    },
  },
}

function createParticle(width: number, height: number, x?: number, y?: number): Particle {
  const angle = Math.random() * Math.PI * 2
  const speed =
    particleConfig.particles.move.speed * particleSpeedScale * (0.35 + Math.random() * 0.65)
  const radius = Math.max(0.8, Math.random() * particleConfig.particles.size.value)
  const opacity = particleConfig.particles.opacity.random
    ? Math.random() * particleConfig.particles.opacity.value
    : particleConfig.particles.opacity.value

  return {
    baseOpacity: opacity,
    baseRadius: radius,
    opacity,
    radius,
    speed,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    x: x ?? Math.random() * width,
    y: y ?? Math.random() * height,
  }
}

function hexToRgb(hex: string) {
  const normalized = hex.replace('#', '')
  const value = Number.parseInt(normalized, 16)

  return {
    b: value & 255,
    g: (value >> 8) & 255,
    r: (value >> 16) & 255,
  }
}

function Hero() {
  const particleLayerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const particleLayer = particleLayerRef.current

    if (!particleLayer) {
      return undefined
    }

    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')

    if (!context) {
      return undefined
    }

    canvas.className = 'hero-particles-canvas'
    canvas.setAttribute('aria-hidden', 'true')
    particleLayer.querySelectorAll('canvas').forEach((existingCanvas) => existingCanvas.remove())
    particleLayer.appendChild(canvas)

    const particleColor = hexToRgb(particleConfig.particles.color)
    const lineColor = hexToRgb(particleConfig.particles.lineLinked.color)
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const pointerQuery = window.matchMedia('(hover: hover) and (pointer: fine)')

    let animationFrame = 0
    let dpr = 1
    let height = 0
    let particles: Particle[] = []
    let previousFrameTime = 0
    let width = 0
    let enableParticleMouseFollow = !motionQuery.matches && pointerQuery.matches

    const pointer = {
      active: false,
      x: 0,
      y: 0,
    }

    const getParticleCount = () => {
      const densityBase = 1440 * particleConfig.particles.number.density.valueArea
      const scaledCount = Math.round(
        (particleConfig.particles.number.value * width * height) / densityBase,
      )

      return Math.min(maxParticleCount, Math.max(64, Math.round(scaledCount * particleCountScale)))
    }

    const resetParticles = () => {
      particles = Array.from({ length: getParticleCount() }, () => createParticle(width, height))
    }

    const resizeCanvas = () => {
      const rect = particleLayer.getBoundingClientRect()

      width = Math.max(1, rect.width)
      height = Math.max(1, rect.height)
      dpr = Math.min(window.devicePixelRatio || 1, 2)

      canvas.width = Math.floor(width * dpr)
      canvas.height = Math.floor(height * dpr)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`

      context.setTransform(dpr, 0, 0, dpr, 0, 0)
      resetParticles()
    }

    const updatePointer = (event: MouseEvent) => {
      const rect = canvas.getBoundingClientRect()
      const x = event.clientX - rect.left
      const y = event.clientY - rect.top

      pointer.active = x >= 0 && x <= width && y >= 0 && y <= height
      pointer.x = x
      pointer.y = y
    }

    const clearPointer = () => {
      pointer.active = false
    }

    const handleClick = (event: MouseEvent) => {
      updatePointer(event)

      if (!pointer.active) {
        return
      }

      for (let index = 0; index < particleConfig.interactivity.push.particlesNumber; index += 1) {
        particles.push(createParticle(width, height, pointer.x, pointer.y))
      }
    }

    const handleMediaQueryChange = () => {
      enableParticleMouseFollow = !motionQuery.matches && pointerQuery.matches

      if (!enableParticleMouseFollow) {
        clearPointer()
      }
    }

    const drawParticle = (particle: Particle) => {
      context.beginPath()
      context.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2)
      context.fillStyle = `rgba(${particleColor.r}, ${particleColor.g}, ${particleColor.b}, ${particle.opacity})`
      context.fill()
    }

    const drawParticleLines = () => {
      for (let firstIndex = 0; firstIndex < particles.length; firstIndex += 1) {
        const firstParticle = particles[firstIndex]

        for (let secondIndex = firstIndex + 1; secondIndex < particles.length; secondIndex += 1) {
          const secondParticle = particles[secondIndex]
          const distance = Math.hypot(
            firstParticle.x - secondParticle.x,
            firstParticle.y - secondParticle.y,
          )

          if (distance > particleConfig.particles.lineLinked.distance) {
            continue
          }

          const opacity =
            particleConfig.particles.lineLinked.opacity *
            (1 - distance / particleConfig.particles.lineLinked.distance)

          context.beginPath()
          context.moveTo(firstParticle.x, firstParticle.y)
          context.lineTo(secondParticle.x, secondParticle.y)
          context.strokeStyle = `rgba(${lineColor.r}, ${lineColor.g}, ${lineColor.b}, ${opacity})`
          context.lineWidth = particleConfig.particles.lineLinked.width
          context.stroke()
        }
      }
    }

    const applyPointerInteraction = (particle: Particle) => {
      if (!enableParticleMouseFollow || !pointer.active) {
        particle.radius += (particle.baseRadius - particle.radius) * 0.08
        particle.opacity += (particle.baseOpacity - particle.opacity) * 0.08
        return
      }

      const distance = Math.hypot(particle.x - pointer.x, particle.y - pointer.y)

      if (distance <= particleConfig.interactivity.bubble.distance) {
        const influence = 1 - distance / particleConfig.interactivity.bubble.distance
        particle.radius +=
          (particleConfig.interactivity.bubble.size - particle.radius) *
          influence *
          0.08 *
          particleConfig.interactivity.bubble.speed
        particle.opacity +=
          (particleConfig.interactivity.bubble.opacity - particle.opacity) * influence * 0.08
      } else {
        particle.radius += (particle.baseRadius - particle.radius) * 0.08
        particle.opacity += (particle.baseOpacity - particle.opacity) * 0.08
      }

      if (distance <= particleConfig.interactivity.grab.distance) {
        const opacity =
          particleConfig.interactivity.grab.opacity *
          (1 - distance / particleConfig.interactivity.grab.distance)

        context.beginPath()
        context.moveTo(particle.x, particle.y)
        context.lineTo(pointer.x, pointer.y)
        context.strokeStyle = `rgba(${lineColor.r}, ${lineColor.g}, ${lineColor.b}, ${opacity})`
        context.lineWidth = particleConfig.particles.lineLinked.width
        context.stroke()
      }
    }

    const moveParticle = (particle: Particle, frameFactor: number) => {
      particle.x += particle.vx * frameFactor
      particle.y += particle.vy * frameFactor

      if (particle.x < -particle.radius) {
        particle.x = width + particle.radius
      } else if (particle.x > width + particle.radius) {
        particle.x = -particle.radius
      }

      if (particle.y < -particle.radius) {
        particle.y = height + particle.radius
      } else if (particle.y > height + particle.radius) {
        particle.y = -particle.radius
      }
    }

    const animate = (frameTime = 0) => {
      const elapsed = previousFrameTime ? frameTime - previousFrameTime : 16.67
      const frameFactor = Math.min(2, elapsed / 16.67)

      previousFrameTime = frameTime
      context.clearRect(0, 0, width, height)
      drawParticleLines()

      particles.forEach((particle) => {
        applyPointerInteraction(particle)
        moveParticle(particle, frameFactor)
        drawParticle(particle)
      })

      animationFrame = window.requestAnimationFrame(animate)
    }

    resizeCanvas()
    animate()

    window.addEventListener('resize', resizeCanvas)
    window.addEventListener('mousemove', updatePointer)
    window.addEventListener('mouseout', clearPointer)
    window.addEventListener('click', handleClick)
    motionQuery.addEventListener('change', handleMediaQueryChange)
    pointerQuery.addEventListener('change', handleMediaQueryChange)

    return () => {
      window.cancelAnimationFrame(animationFrame)
      window.removeEventListener('resize', resizeCanvas)
      window.removeEventListener('mousemove', updatePointer)
      window.removeEventListener('mouseout', clearPointer)
      window.removeEventListener('click', handleClick)
      motionQuery.removeEventListener('change', handleMediaQueryChange)
      pointerQuery.removeEventListener('change', handleMediaQueryChange)
      canvas.remove()
      particles = []
    }
  }, [])

  return (
    <>
      <div id="particles-js" ref={particleLayerRef} aria-hidden="true" />

      <header className="hero hero-intro">
        <span className="hero-kicker">Interactive Brain Research Platform</span>

        <h1>
          <span className="hero-title-line">Frontiers in Brain Science and</span>{' '}
          <span className="hero-title-line">Brain-Inspired Intelligence</span>
        </h1>

        <p>
          Explore neuroscience, cognitive science, brain-computer interfaces,
          brain-inspired Intelligence, and artificial intelligence through an immersive
          learning experience.
        </p>
      </header>
    </>
  )
}

export default Hero
