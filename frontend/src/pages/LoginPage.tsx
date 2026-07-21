import { useEffect, useState, type FormEvent, type MouseEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import Footer from '../components/Footer'
import LoginShaderBackground from './LoginShaderBackground'
import './LoginPage.css'

type AuthUser = {
  id: number
  username: string
  email: string
  role: string
}

type LoginStatus = {
  type: 'error' | 'info'
  message: string
}

const INVALID_CREDENTIALS_MESSAGE = 'Invalid email or password.'
const UNEXPECTED_LOGIN_ERROR = 'Unable to sign in right now. Please try again.'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isAuthUser(value: unknown): value is AuthUser {
  return (
    isRecord(value) &&
    typeof value.id === 'number' &&
    typeof value.username === 'string' &&
    typeof value.email === 'string' &&
    typeof value.role === 'string'
  )
}

function isAuthenticatedPayload(payload: unknown): payload is { authenticated: true; user: AuthUser } {
  return isRecord(payload) && payload.authenticated === true && isAuthUser(payload.user)
}

function isAuthRequiredLocationState(value: unknown): value is { authRequired: true } {
  return isRecord(value) && value.authRequired === true
}

function getPayloadError(payload: unknown) {
  if (isRecord(payload) && typeof payload.error === 'string') {
    return payload.error
  }

  return null
}

async function readJsonPayload(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

function LoginPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isPasswordVisible, setIsPasswordVisible] = useState(false)
  const [remember, setRemember] = useState(false)
  const [status, setStatus] = useState<LoginStatus | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    const controller = new AbortController()

    const checkSession = async () => {
      try {
        const response = await fetch('/api/auth/me', {
          credentials: 'include',
          signal: controller.signal,
        })
        const payload = await readJsonPayload(response)

        if (!controller.signal.aborted && response.ok && isAuthenticatedPayload(payload)) {
          navigate('/', { replace: true })
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return
        }
      }
    }

    checkSession()

    return () => {
      controller.abort()
    }
  }, [navigate])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const trimmedEmail = email.trim()

    if (!trimmedEmail || !password || isSubmitting) {
      setStatus({ type: 'error', message: 'Email and password are required.' })
      return
    }

    setIsSubmitting(true)
    setStatus(null)

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          email: trimmedEmail,
          password,
          remember,
        }),
      })
      const payload = await readJsonPayload(response)

      if (!response.ok) {
        setStatus({
          type: 'error',
          message: response.status === 401 ? INVALID_CREDENTIALS_MESSAGE : getPayloadError(payload) || UNEXPECTED_LOGIN_ERROR,
        })
        return
      }

      if (!isAuthenticatedPayload(payload)) {
        setStatus({ type: 'error', message: UNEXPECTED_LOGIN_ERROR })
        return
      }

      navigate('/', { replace: true })
    } catch {
      setStatus({ type: 'error', message: UNEXPECTED_LOGIN_ERROR })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleForgotPassword = () => {
    setStatus({ type: 'info', message: 'Coming soon.' })
  }

  const handlePasswordChange = (nextPassword: string) => {
    setPassword(nextPassword)

    if (!nextPassword) {
      setIsPasswordVisible(false)
    }
  }

  const handleCardMouseMove = (event: MouseEvent<HTMLElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    const rotateY = ((event.clientX - bounds.left) / bounds.width - 0.5) * 18
    const rotateX = ((event.clientY - bounds.top) / bounds.height - 0.5) * -18

    event.currentTarget.style.setProperty('--card-rotate-x', `${rotateX}deg`)
    event.currentTarget.style.setProperty('--card-rotate-y', `${rotateY}deg`)
  }

  const handleCardMouseLeave = (event: MouseEvent<HTMLElement>) => {
    event.currentTarget.style.setProperty('--card-rotate-x', '0deg')
    event.currentTarget.style.setProperty('--card-rotate-y', '0deg')
  }

  const shouldShowTutorNotice = isAuthRequiredLocationState(location.state) && !status

  return (
    <div className="react-login-page">
      <section className="login-screen">
        <LoginShaderBackground />

        <Link className="login-home-link" to="/">
          Back Home
        </Link>

        <main className="login-shell">
          <section
            className="login-panel"
            aria-labelledby="login-title"
            onMouseLeave={handleCardMouseLeave}
            onMouseMove={handleCardMouseMove}
          >
            <span className="login-label">Brain Research Tutor</span>

            <h1 id="login-title">Welcome Back</h1>
            <p>Sign in to continue your brain science learning journey with the AI tutor.</p>

            <form className="login-form" onSubmit={handleSubmit}>
              <label className="login-field">
                <span>Email</span>
                <input
                  autoComplete="email"
                  disabled={isSubmitting}
                  name="email"
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="name@example.com"
                  required
                  type="email"
                  value={email}
                />
              </label>

              <div className="login-field">
                <label htmlFor="login-password">Password</label>
                <div className="password-input-shell">
                  <input
                    autoComplete="current-password"
                    disabled={isSubmitting}
                    id="login-password"
                    name="password"
                    onChange={(event) => handlePasswordChange(event.target.value)}
                    placeholder="Enter your password"
                    required
                    type={isPasswordVisible ? 'text' : 'password'}
                    value={password}
                  />

                  {password ? (
                    <button
                      aria-label={isPasswordVisible ? 'Hide password' : 'Show password'}
                      aria-pressed={isPasswordVisible}
                      className="password-visibility-button"
                      disabled={isSubmitting}
                      onClick={() => setIsPasswordVisible((currentValue) => !currentValue)}
                      type="button"
                    >
                      {isPasswordVisible ? (
                        <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
                          <path d="M3 3l18 18" />
                          <path d="M10.73 5.08A10.96 10.96 0 0 1 12 5c5 0 8.5 4.5 9.5 7a12.42 12.42 0 0 1-2.3 3.52" />
                          <path d="M6.61 6.61A12.08 12.08 0 0 0 2.5 12c1 2.5 4.5 7 9.5 7a9.6 9.6 0 0 0 4.1-.92" />
                          <path d="M9.88 9.88a3 3 0 0 0 4.24 4.24" />
                        </svg>
                      ) : (
                        <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
                          <path d="M2.5 12c1-2.5 4.5-7 9.5-7s8.5 4.5 9.5 7c-1 2.5-4.5 7-9.5 7s-8.5-4.5-9.5-7z" />
                          <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
                        </svg>
                      )}
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="login-options">
                <label className="remember-option">
                  <input
                    checked={remember}
                    disabled={isSubmitting}
                    name="remember"
                    onChange={(event) => setRemember(event.target.checked)}
                    type="checkbox"
                  />
                  <span>Remember me</span>
                </label>

                <button className="forgot-password-button" disabled={isSubmitting} type="button" onClick={handleForgotPassword}>
                  Forgot password?
                </button>
              </div>

              <button className="login-submit" disabled={isSubmitting} type="submit">
                {isSubmitting ? 'Signing In...' : 'Sign In'}
              </button>

              {shouldShowTutorNotice ? <p className="login-status error">Please sign in to use the AI Tutor.</p> : null}
              {status ? <p className={`login-status ${status.type}`}>{status.message}</p> : null}
            </form>
          </section>
        </main>
      </section>

      <section className="login-footer-screen">
        <Footer />
      </section>
    </div>
  )
}

export default LoginPage
