import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { AdminApiError, adminErrorMessage, createAccount, type AdminUser } from '../../api/admin'
import { useAuth } from '../../auth/useAuth'
import type { UserRole } from '../../types/auth'

export default function CreateAccountDialog({ close, created }: { close: () => void; created: () => void }) {
  const { refreshAuth } = useAuth()
  const id = useId(), dialog = useRef<HTMLDialogElement>(null), controller = useRef<AbortController | null>(null)
  const [username, setUsername] = useState(''), [email, setEmail] = useState(''), [role, setRole] = useState<UserRole>('student')
  const [password, setPassword] = useState(''), [confirmAdmin, setConfirmAdmin] = useState(false)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [success, setSuccess] = useState<{ user: AdminUser; password: string } | null>(null)
  useEffect(() => {
    const previous = document.activeElement, element = dialog.current, overflow = document.body.style.overflow
    element?.showModal(); element?.querySelector<HTMLHeadingElement>('h2')?.focus(); document.body.style.overflow = 'hidden'
    return () => { controller.current?.abort(); element?.close(); document.body.style.overflow = overflow; if (previous instanceof HTMLElement && previous.isConnected) previous.focus() }
  }, [])
  useEffect(() => { if (success) dialog.current?.querySelector<HTMLHeadingElement>('h2')?.focus() }, [success])
  useEffect(() => { if (error) dialog.current?.querySelector<HTMLElement>('[role="alert"]')?.focus() }, [error])
  function generate() {
    try {
      const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
      const bytes = crypto.getRandomValues(new Uint8Array(24))
      setPassword(Array.from(bytes, byte => alphabet[byte & 63]).join('')); setNotice('Secure temporary password generated.'); setError('')
    } catch { setError('Secure password generation is unavailable. Enter a temporary password manually.') }
  }
  async function copy(value: string) {
    setNotice(''); setError('')
    try { await navigator.clipboard.writeText(value); if (!controller.current?.signal.aborted) setNotice('Copied to clipboard.') }
    catch { setError('Copy is unavailable. Select the password and copy it manually.') }
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (controller.current) return
    const request = new AbortController(); controller.current = request; setBusy(true); setError(''); setNotice('')
    try {
      const user = await createAccount({ username, email, role, temporaryPassword: password, confirmAdmin }, request.signal)
      if (!request.signal.aborted) { setSuccess({ user, password }); setPassword(''); created() }
    } catch (failure) {
      if (!request.signal.aborted) {
        setError(adminErrorMessage(failure))
        if (failure instanceof AdminApiError && failure.status === 403) await refreshAuth()
      }
    } finally { if (controller.current === request) controller.current = null; if (!request.signal.aborted) setBusy(false) }
  }
  return <dialog ref={dialog} className="admin-user-dialog admin-create-dialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`}
    onCancel={event => { event.preventDefault(); if (!busy) close() }}
    onKeyDown={event => {
      if (event.key !== 'Tab') return
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled)'))
      const first = controls[0], last = controls[controls.length - 1]
      if (!first) { event.preventDefault(); event.currentTarget.focus() }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }}>
    <div className="admin-dialog-heading"><h2 id={`${id}-title`} tabIndex={-1}>{success ? 'Account created' : 'Create Account'}</h2><button type="button" disabled={busy} onClick={close} aria-label="Close account creation">Close</button></div>
    <p id={`${id}-description`}>{success ? 'Copy these temporary credentials before closing. They will not be shown again.' : 'Create one active account directly. No invitation or email will be sent.'}</p>
    {error && <p role="alert" tabIndex={-1} className="admin-error">{error}</p>}
    {success ? <section aria-label="Temporary credentials" className="admin-created-credentials">
      <dl><dt>Username</dt><dd>{success.user.username}</dd><dt>Email</dt><dd>{success.user.email}</dd><dt>Role</dt><dd>{success.user.role}</dd></dl>
      <label htmlFor={`${id}-result-password`}>Temporary password<input id={`${id}-result-password`} value={success.password} readOnly autoComplete="off" onFocus={event => event.currentTarget.select()} /></label>
      <p>The user can change this password using the existing Change Password page.</p>
      <div className="admin-actions"><button type="button" onClick={() => void copy(success.password)}>Copy password</button><button type="button" onClick={() => void copy(`Username: ${success.user.username}\nEmail: ${success.user.email}\nRole: ${success.user.role}\nTemporary password: ${success.password}`)}>Copy credentials</button><button type="button" onClick={close}>Done</button></div>
    </section> : <form onSubmit={event => void submit(event)}>
      <label htmlFor={`${id}-username`}>Username<input id={`${id}-username`} required maxLength={80} value={username} autoComplete="off" disabled={busy} onChange={event => { setUsername(event.target.value); setConfirmAdmin(false) }} /></label>
      <label htmlFor={`${id}-email`}>Email<input id={`${id}-email`} type="email" required maxLength={255} value={email} autoComplete="off" disabled={busy} onChange={event => { setEmail(event.target.value); setConfirmAdmin(false) }} /></label>
      <label htmlFor={`${id}-role`}><span id={`${id}-role-label`}>Role</span><select id={`${id}-role`} aria-labelledby={`${id}-role-label`} value={role} disabled={busy} onChange={event => { setRole(event.target.value as UserRole); setConfirmAdmin(false) }}><option value="student">Student</option><option value="teacher">Teacher</option><option value="admin">Admin</option></select></label>
      <label htmlFor={`${id}-password`}>Temporary password<input id={`${id}-password`} type="password" required minLength={12} maxLength={512} value={password} autoComplete="new-password" disabled={busy} aria-describedby={`${id}-password-help`} onChange={event => { setPassword(event.target.value); setNotice('') }} /></label>
      <p id={`${id}-password-help`}>Use 12–512 characters. Share the temporary credentials securely.</p>
      <div className="admin-actions"><button type="button" disabled={busy} onClick={generate}>Generate secure password</button><button type="button" disabled={busy || !password} onClick={() => void copy(password)}>Copy password</button></div>
      {role === 'admin' && <label className="admin-create-confirm"><input type="checkbox" checked={confirmAdmin} disabled={busy} onChange={event => setConfirmAdmin(event.target.checked)} />I confirm this account should have administrator access.</label>}
      <button type="submit" className="admin-create-trigger" disabled={busy || role === 'admin' && !confirmAdmin}>{busy ? 'Creating account...' : 'Create Account'}</button>
    </form>}
    <p role="status">{notice}</p>
  </dialog>
}
