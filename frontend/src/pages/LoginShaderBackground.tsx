import { useEffect, useRef } from 'react'

const VERTEX_SHADER_SOURCE = `
  attribute vec2 position;

  void main() {
    gl_Position = vec4(position, 0.0, 1.0);
  }
`

const FRAGMENT_SHADER_SOURCE = `
  #define TWO_PI 6.2831853072
  #define PI 3.14159265359

  precision highp float;
  uniform vec2 resolution;
  uniform float time;

  void main(void) {
    vec2 uv = (gl_FragCoord.xy * 2.0 - resolution.xy) / min(resolution.x, resolution.y);
    float t = time * 0.05;
    float lineWidth = 0.002;

    vec3 color = vec3(0.0);
    for (int j = 0; j < 3; j++) {
      for (int i = 0; i < 5; i++) {
        color[j] += lineWidth * float(i * i) / abs(fract(t - 0.01 * float(j) + float(i) * 0.01) * 5.0 - length(uv) + mod(uv.x + uv.y, 0.2));
      }
    }

    gl_FragColor = vec4(color[0], color[1], color[2], 1.0);
  }
`

function createShader(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)

  if (!shader) {
    return null
  }

  gl.shaderSource(shader, source)
  gl.compileShader(shader)

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader)
    return null
  }

  return shader
}

function LoginShaderBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current

    if (!canvas) {
      return undefined
    }

    const gl = canvas.getContext('webgl', { antialias: true })

    if (!gl) {
      canvas.style.display = 'none'
      return undefined
    }

    const vertexShader = createShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SOURCE)
    const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SOURCE)
    const shaderProgram = gl.createProgram()
    const positionBuffer = gl.createBuffer()

    if (!vertexShader || !fragmentShader || !shaderProgram || !positionBuffer) {
      if (vertexShader) {
        gl.deleteShader(vertexShader)
      }
      if (fragmentShader) {
        gl.deleteShader(fragmentShader)
      }
      if (shaderProgram) {
        gl.deleteProgram(shaderProgram)
      }
      if (positionBuffer) {
        gl.deleteBuffer(positionBuffer)
      }
      return undefined
    }

    gl.attachShader(shaderProgram, vertexShader)
    gl.attachShader(shaderProgram, fragmentShader)
    gl.linkProgram(shaderProgram)

    if (!gl.getProgramParameter(shaderProgram, gl.LINK_STATUS)) {
      gl.deleteProgram(shaderProgram)
      gl.deleteShader(vertexShader)
      gl.deleteShader(fragmentShader)
      gl.deleteBuffer(positionBuffer)
      return undefined
    }

    gl.useProgram(shaderProgram)
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    )

    const positionLocation = gl.getAttribLocation(shaderProgram, 'position')
    const resolutionLocation = gl.getUniformLocation(shaderProgram, 'resolution')
    const timeLocation = gl.getUniformLocation(shaderProgram, 'time')

    if (positionLocation < 0 || !resolutionLocation || !timeLocation) {
      gl.deleteProgram(shaderProgram)
      gl.deleteShader(vertexShader)
      gl.deleteShader(fragmentShader)
      gl.deleteBuffer(positionBuffer)
      return undefined
    }

    gl.enableVertexAttribArray(positionLocation)
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0)

    let animationId: number | null = null
    let shaderTime = 1.0
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const drawShader = () => {
      shaderTime += 0.05
      gl.uniform1f(timeLocation, shaderTime)
      gl.drawArrays(gl.TRIANGLES, 0, 6)
    }

    const resizeShader = () => {
      const parentBounds = canvas.parentElement?.getBoundingClientRect()
      const width = Math.max(1, Math.floor(parentBounds?.width || window.innerWidth))
      const height = Math.max(1, Math.floor(parentBounds?.height || window.innerHeight))
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)

      canvas.width = Math.floor(width * pixelRatio)
      canvas.height = Math.floor(height * pixelRatio)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`

      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.uniform2f(resolutionLocation, canvas.width, canvas.height)
      if (prefersReducedMotion) {
        drawShader()
      }
    }

    const animateShader = () => {
      drawShader()
      animationId = window.requestAnimationFrame(animateShader)
    }

    window.addEventListener('resize', resizeShader)
    resizeShader()

    if (!prefersReducedMotion) {
      animateShader()
    }

    return () => {
      if (animationId !== null) {
        window.cancelAnimationFrame(animationId)
      }

      window.removeEventListener('resize', resizeShader)
      gl.deleteProgram(shaderProgram)
      gl.deleteShader(vertexShader)
      gl.deleteShader(fragmentShader)
      gl.deleteBuffer(positionBuffer)
    }
  }, [])

  return (
    <div className="react-login-background" aria-hidden="true">
      <canvas className="login-shader-canvas" ref={canvasRef} />
    </div>
  )
}

export default LoginShaderBackground
