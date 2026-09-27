import { useEffect, useRef, useState } from 'react'
import { AdminApiError, adminErrorMessage, changeUserRole, disableUser, enableUser, fetchAdminUser, type AdminUser } from '../../api/admin'
import { useAuth } from '../../auth/useAuth'
import type { UserRole } from '../../types/auth'
export default function UserDialog({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const { state, refreshAuth } = useAuth()
  const dialog = useRef<HTMLDialogElement>(null)
  const [user, setUser] = useState<AdminUser | null>(null)
  const [role, setRole] = useState<UserRole>('student')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [retry, setRetry] = useState(0)
  const [confirmDisable, setConfirmDisable] = useState(false)
  const [notice, setNotice] = useState('')
  useEffect(() => {
    dialog.current?.querySelector<HTMLHeadingElement>('h2')?.focus()
  }, [confirmDisable, busy, loaded])
  useEffect(() => {
    const previous = document.activeElement
    const element = dialog.current
    element?.showModal()
    return () => { element?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); else (document.getElementById(`manage-user-${id}`) || document.getElementById('admin-users-title'))?.focus() }
  }, [id])
  useEffect(() => {
    const controller = new AbortController()
    fetchAdminUser(id, controller.signal).then(value => {
      if (controller.signal.aborted) return
      setUser(value); setRole(value.role); setLoaded(true); setError(null)
    }).catch(async (reason: unknown) => {
      if (controller.signal.aborted) return
      setLoaded(true); setError(adminErrorMessage(reason))
      if (reason instanceof AdminApiError && reason.status === 403) await refreshAuth()
    })
    return () => controller.abort()
  }, [id, retry, refreshAuth])
  async function mutate(action: 'role' | 'disable' | 'enable') {
    if (!user || busy) return
    setBusy(true); setError(null); setNotice('')
    try {
      const updated = await (action === 'role' ? changeUserRole(user.id, role) : action === 'disable' ? disableUser(user.id) : enableUser(user.id))
      if (state.status === 'authenticated' && updated.id === state.user.id) {
        await refreshAuth()
      }
      setUser(updated); setRole(updated.role); setConfirmDisable(false)
      setNotice('Account updated.'); onChanged()
    } catch (reason) {
      setError(adminErrorMessage(reason))
      if (reason instanceof AdminApiError && reason.status === 403) await refreshAuth()
    } finally { setBusy(false) }
  }
  return <dialog ref={dialog} className="admin-user-dialog" aria-labelledby="manage-user-title" onCancel={event => { event.preventDefault(); if (!busy) onClose() }}>
    <div className="admin-dialog-heading"><h2 id="manage-user-title" tabIndex={-1}>{confirmDisable ? 'Disable this account?' : 'Manage User'}</h2><button aria-label="Close user management" disabled={busy} onClick={onClose}>Close</button></div>
    {!loaded ? <p role="status">Loading account...</p> : null}
    {error ? <p role="alert" className="admin-error">{error}</p> : null}
    {loaded && !user ? <button onClick={() => setRetry(value => value + 1)}>Retry</button> : null}
    {user ? <>
      <p className="admin-user-identity"><strong>{user.username}</strong><br />{user.email}</p>
      {confirmDisable ? <><p>This account will lose access and its existing sessions will be revoked.</p><div className="admin-actions"><button disabled={busy} onClick={() => setConfirmDisable(false)}>Cancel</button><button className="admin-danger" disabled={busy} onClick={() => void mutate('disable')}>{busy ? 'Disabling...' : 'Confirm Disable'}</button></div></> : <>
        <label htmlFor="managed-user-role">Role</label><select id="managed-user-role" disabled={busy} value={role} onChange={event => setRole(event.target.value as UserRole)}><option value="student">Student</option><option value="teacher">Teacher</option><option value="admin">Admin</option></select>
        <p>Changing a role revokes existing sessions, including your own if you edit this account.</p>
        <div className="admin-actions"><button disabled={busy || role === user.role} onClick={() => void mutate('role')}>{busy ? 'Saving...' : 'Save Role'}</button>
        {user.isActive ? <button className="admin-danger" disabled={busy} onClick={() => { setError(null); setConfirmDisable(true) }}>Disable Account</button> : <button disabled={busy} onClick={() => void mutate('enable')}>Enable Account</button>}</div>
      </>}
      <p role="status">{notice}</p>
    </> : null}
  </dialog>
}
