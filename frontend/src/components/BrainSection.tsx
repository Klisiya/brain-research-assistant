import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import './BrainSection.css'

const brainModelPath = '/models/brain.glb'
const cameraPolarAngle = THREE.MathUtils.degToRad(72)
const cameraDistance = 3
const targetModelSize = 1.42

function disposeMaterial(material: THREE.Material) {
  Object.values(material).forEach((value) => {
    if (value instanceof THREE.Texture) {
      value.dispose()
    }
  })

  material.dispose()
}

function disposeObject3D(object: THREE.Object3D) {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh

    if (mesh.geometry) {
      mesh.geometry.dispose()
    }

    if (mesh.material) {
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]

      materials.forEach(disposeMaterial)
    }
  })
}

function resolveMaterialColor(material: THREE.Material | THREE.Material[] | undefined) {
  const source = Array.isArray(material) ? material[0] : material

  if (
    source &&
    'emissive' in source &&
    source.emissive instanceof THREE.Color &&
    source.emissive.getHex() !== 0
  ) {
    return source.emissive.clone()
  }

  if (
    source &&
    'color' in source &&
    source.color instanceof THREE.Color &&
    source.color.getHex() !== 0
  ) {
    return source.color.clone()
  }

  return new THREE.Color(0x38bdf8)
}

function BrainSection() {
  const mountRef = useRef<HTMLDivElement>(null)
  const [loadError, setLoadError] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const mount = mountRef.current

    if (!mount) {
      return undefined
    }

    mount.querySelectorAll('canvas').forEach((canvas) => canvas.remove())

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(28, 1, 0.01, 100)
    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: 'high-performance',
    })
    const loader = new GLTFLoader()
    const modelGroup = new THREE.Group()
    const targetRotation = new THREE.Vector2(0, 0)
    const currentRotation = new THREE.Vector2(0, 0)
    const pointerState = {
      dragging: false,
      lastX: 0,
      lastY: 0,
    }

    let animationFrame = 0
    let disposed = false
    let loadedRoot: THREE.Object3D | null = null

    renderer.setClearColor(0x000000, 0)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.25
    mount.appendChild(renderer.domElement)

    scene.add(modelGroup)

    const ambientLight = new THREE.AmbientLight(0x7dd3fc, 0.55)
    const keyLight = new THREE.DirectionalLight(0x93c5fd, 1.35)
    const cyanLight = new THREE.PointLight(0x38bdf8, 2.1, 8)
    const violetLight = new THREE.PointLight(0xa855f7, 1.15, 7)

    keyLight.position.set(1.4, 2.6, 3.2)
    cyanLight.position.set(-1.8, 0.8, 2.2)
    violetLight.position.set(1.9, -0.8, -1.5)
    scene.add(ambientLight, keyLight, cyanLight, violetLight)

    const setCameraFromFlaskOrbit = () => {
      camera.position.set(
        Math.sin(cameraPolarAngle) * Math.sin(0) * cameraDistance,
        Math.cos(cameraPolarAngle) * cameraDistance,
        Math.sin(cameraPolarAngle) * Math.cos(0) * cameraDistance,
      )
      camera.lookAt(0, 0, 0)
    }

    const resizeRenderer = () => {
      const { clientHeight, clientWidth } = mount
      const width = Math.max(1, clientWidth)
      const height = Math.max(1, clientHeight)

      renderer.setSize(width, height, false)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      setCameraFromFlaskOrbit()
    }

    const styleLoadedBrain = (root: THREE.Object3D) => {
      root.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) {
          return
        }

        const color = resolveMaterialColor(child.material)
        const originalMaterials = Array.isArray(child.material) ? child.material : [child.material]
        const pointMaterial = new THREE.PointsMaterial({
          blending: THREE.AdditiveBlending,
          color,
          depthWrite: false,
          opacity: 0.86,
          size: 0.008,
          sizeAttenuation: true,
          transparent: true,
        })
        const wireMaterial = new THREE.MeshBasicMaterial({
          blending: THREE.AdditiveBlending,
          color,
          depthWrite: false,
          opacity: 0.12,
          transparent: true,
          wireframe: true,
        })
        const particleOverlay = new THREE.Points(child.geometry.clone(), pointMaterial)

        child.material = wireMaterial
        child.add(particleOverlay)
        originalMaterials.forEach(disposeMaterial)
      })

      modelGroup.add(root)

      const box = new THREE.Box3().setFromObject(modelGroup)
      const size = box.getSize(new THREE.Vector3())
      const center = box.getCenter(new THREE.Vector3())
      const maxSize = Math.max(size.x, size.y, size.z, 0.001)

      modelGroup.position.sub(center)
      modelGroup.scale.setScalar(targetModelSize / maxSize)
    }

    const animate = () => {
      currentRotation.x += (targetRotation.x - currentRotation.x) * 0.16
      currentRotation.y += (targetRotation.y - currentRotation.y) * 0.16
      modelGroup.rotation.x = currentRotation.x
      modelGroup.rotation.y = currentRotation.y
      renderer.render(scene, camera)
      animationFrame = window.requestAnimationFrame(animate)
    }

    const handlePointerDown = (event: PointerEvent) => {
      pointerState.dragging = true
      pointerState.lastX = event.clientX
      pointerState.lastY = event.clientY
      renderer.domElement.classList.add('is-dragging')
      renderer.domElement.setPointerCapture(event.pointerId)
    }

    const handlePointerMove = (event: PointerEvent) => {
      if (!pointerState.dragging) {
        return
      }

      const deltaX = event.clientX - pointerState.lastX
      const deltaY = event.clientY - pointerState.lastY

      pointerState.lastX = event.clientX
      pointerState.lastY = event.clientY
      targetRotation.y += deltaX * 0.004
      targetRotation.x = THREE.MathUtils.clamp(targetRotation.x + deltaY * 0.003, -0.55, 0.55)
    }

    const handlePointerUp = (event: PointerEvent) => {
      pointerState.dragging = false
      renderer.domElement.classList.remove('is-dragging')

      if (renderer.domElement.hasPointerCapture(event.pointerId)) {
        renderer.domElement.releasePointerCapture(event.pointerId)
      }
    }

    const handlePointerLeave = () => {
      pointerState.dragging = false
      renderer.domElement.classList.remove('is-dragging')
    }

    resizeRenderer()
    animate()

    window.addEventListener('resize', resizeRenderer)
    renderer.domElement.addEventListener('pointerdown', handlePointerDown)
    renderer.domElement.addEventListener('pointermove', handlePointerMove)
    renderer.domElement.addEventListener('pointerup', handlePointerUp)
    renderer.domElement.addEventListener('pointercancel', handlePointerUp)
    renderer.domElement.addEventListener('pointerleave', handlePointerLeave)

    loader.load(
      brainModelPath,
      (gltf) => {
        if (disposed) {
          disposeObject3D(gltf.scene)
          return
        }

        loadedRoot = gltf.scene
        styleLoadedBrain(gltf.scene)
        setIsLoading(false)
      },
      undefined,
      (error) => {
        if (!disposed) {
          console.error('Failed to load brain model:', error)
          setLoadError(true)
          setIsLoading(false)
        }
      },
    )

    return () => {
      disposed = true
      window.cancelAnimationFrame(animationFrame)
      window.removeEventListener('resize', resizeRenderer)
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown)
      renderer.domElement.removeEventListener('pointermove', handlePointerMove)
      renderer.domElement.removeEventListener('pointerup', handlePointerUp)
      renderer.domElement.removeEventListener('pointercancel', handlePointerUp)
      renderer.domElement.removeEventListener('pointerleave', handlePointerLeave)

      if (loadedRoot) {
        modelGroup.remove(loadedRoot)
      }

      disposeObject3D(modelGroup)
      renderer.dispose()
      renderer.forceContextLoss()
      renderer.domElement.remove()
    }
  }, [])

  return (
    <section className="brain-section" aria-label="Interactive 3D brain model">
      <div className="brain-section-stage">
        <div className="brain-section-glow" aria-hidden="true" />
        <div className="brain-section-orbit brain-section-orbit-one" aria-hidden="true" />
        <div className="brain-section-orbit brain-section-orbit-two" aria-hidden="true" />

        <div ref={mountRef} className="brain-scene" aria-label="3D brain model viewer" />

        {(isLoading || loadError) && (
          <div className="brain-scene-status" role="status">
            {loadError ? 'Unable to load brain model.' : 'Loading brain model...'}
          </div>
        )}
      </div>
    </section>
  )
}

export default BrainSection
