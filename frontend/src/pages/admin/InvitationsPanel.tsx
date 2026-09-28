import { useEffect, useRef, useState } from 'react'
import { fetchInvitations, inviteUser, revokeInvitation, type InvitationList } from '../../api/account-lifecycle'
import type { UserRole } from '../../types/auth'
function InviteDialog({ close, changed }: { close: () => void; changed: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const [email, setEmail] = useState(''), [role, setRole] = useState<UserRole>('student')
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [success, setSuccess] = useState(false)
  useEffect(() => { ref.current?.querySelector<HTMLHeadingElement>('h2')?.focus() }, [busy,success])
  useEffect(() => { const previous = document.activeElement, dialog = ref.current; dialog?.showModal(); return () => { dialog?.close(); if (previous instanceof HTMLElement) previous.focus() } }, [])
  return <dialog ref={ref} className="admin-user-dialog" aria-labelledby="invite-title" onCancel={event => { event.preventDefault(); if (!busy) close() }}><div className="admin-dialog-heading"><h2 id="invite-title" tabIndex={-1}>Invite User</h2><button disabled={busy} onClick={close}>Close Invitation</button></div>
    {success ? <p role="status">Invitation sent. The recipient can set their own password.</p> : <form onSubmit={async event => { event.preventDefault(); if (busy) return; setBusy(true); setError(''); try { await inviteUser(email,role); setSuccess(true); changed() } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to invite user.') } finally { setBusy(false) } }}>
      <label>Email<input type="email" required maxLength={255} value={email} disabled={busy} onChange={event => setEmail(event.target.value)} /></label>
      <label htmlFor="invitation-role">Role</label><select id="invitation-role" value={role} disabled={busy} onChange={event => setRole(event.target.value as UserRole)}><option value="student">Student</option><option value="teacher">Teacher</option><option value="admin">Admin</option></select>
      <p>The invitation expires after 48 hours.</p>{error ? <p role="alert" className="admin-error">{error}</p> : null}<button disabled={busy}>{busy ? 'Sending...' : 'Send Invitation'}</button>
    </form>}
  </dialog>
}
export default function InvitationsPanel() {
  const [open, setOpen] = useState(false), [page, setPage] = useState(1), [revision, setRevision] = useState(0)
  const key = `${page}:${revision}`
  const [result, setResult] = useState<{ key: string; data: InvitationList | null; error: string } | null>(null)
  const [busy, setBusy] = useState<number | null>(null), [actionError, setActionError] = useState('')
  const current = result?.key === key ? result : null
  useEffect(() => { const controller = new AbortController(); fetchInvitations(page,controller.signal).then(data => { if(!controller.signal.aborted) setResult({key,data,error:''}) }).catch((reason: unknown) => { if(!controller.signal.aborted) setResult({key,data:null,error:reason instanceof Error ? reason.message : 'Unable to load invitations.'}) }); return () => controller.abort() }, [page,key])
  return <section className="admin-glass admin-results" aria-labelledby="invitations-title"><div className="admin-dialog-heading"><h2 id="invitations-title">Invitations</h2><button onClick={() => setOpen(true)}>Invite User</button></div>
    {!current ? <p role="status">Loading invitations...</p> : current.error ? <div role="alert"><p>{current.error}</p><button onClick={() => setRevision(v=>v+1)}>Retry Invitations</button></div> : current.data ? <>
      {current.data.invitations.length === 0 ? <p>No invitations yet.</p> : <div className="admin-table-scroll" tabIndex={0} role="region" aria-label="Invitations table"><table><thead><tr>{['Email','Role','Created','Expires','Status','Actions'].map(value=><th scope="col" key={value}>{value}</th>)}</tr></thead><tbody>{current.data.invitations.map(entry=><tr key={entry.id}><th scope="row">{entry.email}</th><td>{entry.role}</td><td>{entry.createdAt.slice(0,10)}</td><td>{entry.expiresAt.slice(0,10)}</td><td>{entry.status}</td><td>{entry.status==='Pending'?<button disabled={busy!==null} aria-label={`Revoke invitation for ${entry.email}`} onClick={async()=>{setBusy(entry.id);setActionError('');try{await revokeInvitation(entry.id);setRevision(v=>v+1)}catch(reason){setActionError(reason instanceof Error?reason.message:'Unable to revoke invitation.')}finally{setBusy(null)}}}>Revoke</button>:null}</td></tr>)}</tbody></table></div>}
      <nav aria-label="Invitations pagination" className="admin-pagination"><button disabled={page===1} onClick={()=>setPage(v=>v-1)}>Previous Invitations</button><span>Page {current.data.pagination.totalPages===0?0:page} of {current.data.pagination.totalPages}</span><button disabled={page>=current.data.pagination.totalPages} onClick={()=>setPage(v=>v+1)}>Next Invitations</button></nav>
    </> : null}{actionError?<p role="alert">{actionError}</p>:null}{open?<InviteDialog close={()=>setOpen(false)} changed={()=>setRevision(v=>v+1)}/>:null}
  </section>
}
