import { useEffect, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { lifecycleRequest } from '../api/account-lifecycle'
import { useAuth } from '../auth/useAuth'
import Footer from '../components/Footer'
import Navbar from '../components/Navbar'
import './AccountCredentialPage.css'
export default function AccountCredentialPage({ mode }: { mode: 'forgot' | 'reset' | 'accept' | 'change' }) {
  const [params] = useSearchParams()
  const token = params.get('token') || ''
  const { refreshAuth } = useAuth()
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  useEffect(() => {
    if (mode !== 'accept' || !token) return
    const controller = new AbortController()
    lifecycleRequest('/api/auth/invitation-details', { token }, controller.signal).then(data => {
      if (!controller.signal.aborted && typeof data === 'object' && data !== null && 'username' in data && typeof data.username === 'string') setUsername(current => current || String(data.username))
    }).catch(() => { /* Submission presents the authoritative credential error. */ })
    return () => controller.abort()
  }, [mode, token])
  const [current, setCurrent] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const titles = { forgot: 'Forgot Password', reset: 'Reset Password', accept: 'Accept Invitation', change: 'Change Password' }
  const missingToken = (mode === 'accept' || mode === 'reset') && !token
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setError('')
    if (mode !== 'forgot' && (password !== confirmation || password.length < 12 || password.length > 512)) {
      setError('Passwords must match and contain between 12 and 512 characters.'); return
    }
    setBusy(true)
    try {
      const data: Record<string, unknown> = mode === 'forgot' ? { email } : { password, confirmPassword: confirmation }
      if (mode === 'accept') { data.token = token; data.username = username }
      if (mode === 'reset') data.token = token
      if (mode === 'change') data.currentPassword = current
      await lifecycleRequest(`/api/auth/${mode === 'forgot' ? 'forgot-password' : mode === 'reset' ? 'reset-password' : mode === 'accept' ? 'accept-invitation' : 'change-password'}`, data)
      setPassword(''); setConfirmation(''); setCurrent('')
      setSuccess(mode === 'forgot' ? 'If an eligible account exists, a reset link will be sent. If no email arrives, try again later.' : mode === 'accept' ? 'Account created. Please sign in.' : 'Password updated. Please sign in again.')
      if (mode === 'reset' || mode === 'change') await refreshAuth()
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to complete the request.') }
    finally { setBusy(false) }
  }
  const content = <section className="credential-card" aria-labelledby="credential-title">
    <span>Account Security</span><h1 id="credential-title">{titles[mode]}</h1>
    {missingToken ? <p role="alert">This link is missing its token. Request a new link.</p> : success ? <div role="status"><p>{success}</p><Link to="/login">Sign In</Link></div> : <form onSubmit={submit}>
      {mode === 'forgot' ? <label>Email<input type="email" autoComplete="email" maxLength={255} required value={email} disabled={busy} onChange={event => setEmail(event.target.value)} /></label> : <>
        {mode === 'accept' ? <label>Display name<input autoComplete="nickname" required maxLength={80} value={username} disabled={busy} onChange={event => setUsername(event.target.value)} /></label> : null}
        {mode === 'change' ? <label>Current password<input type="password" autoComplete="current-password" required maxLength={512} value={current} disabled={busy} onChange={event => setCurrent(event.target.value)} /></label> : null}
        <label>New password<input type="password" autoComplete="new-password" required minLength={12} maxLength={512} value={password} disabled={busy} onChange={event => setPassword(event.target.value)} /></label>
        <label>Confirm password<input type="password" autoComplete="new-password" required minLength={12} maxLength={512} value={confirmation} disabled={busy} onChange={event => setConfirmation(event.target.value)} /></label>
        <p>Use 12 to 512 characters. A long, unique passphrase is welcome.</p>
      </>}
      {error ? <p role="alert">{error}</p> : null}<button disabled={busy}>{busy ? 'Submitting...' : mode === 'forgot' ? 'Send Reset Link' : mode === 'accept' ? 'Create Account' : 'Update Password'}</button>
    </form>}
    <Link to={mode === 'reset' ? '/forgot-password' : '/login'}>{mode === 'reset' ? 'Request a New Link' : 'Back to Sign In'}</Link>
  </section>
  return mode === 'change' ? content : <div className="credential-shell"><Navbar /><main className="credential-main">{content}</main><Footer /></div>
}
