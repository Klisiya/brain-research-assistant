import { useEffect, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { adminErrorMessage, fetchAudit, type AccountAuditEntry, type Pagination } from '../../api/admin'
import './AdminUsersPage.css'
const actions = ['role_changed', 'account_disabled', 'account_enabled', 'invitation_created', 'invitation_revoked', 'invitation_accepted', 'password_reset_requested', 'password_reset_completed', 'password_changed']
function Filters({ params, submit }: { params: URLSearchParams; submit: (values: URLSearchParams) => void }) {
  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget); const next = new URLSearchParams()
    for (const name of ['action', 'actorId', 'targetId']) { const value = String(data.get(name) || '').trim(); if (value) next.set(name, value) }
    submit(next)
  }
  return <form className="admin-filters admin-glass" onSubmit={apply} aria-label="Audit filters">
    <label htmlFor="audit-action">Action</label><select id="audit-action" name="action" defaultValue={params.get('action') || ''}><option value="">All actions</option>{actions.map(action => <option key={action}>{action}</option>)}</select>
    <label htmlFor="audit-actor">Actor ID</label><input id="audit-actor" name="actorId" type="number" min="1" step="1" defaultValue={params.get('actorId') || ''} />
    <label htmlFor="audit-target">Target user ID</label><input id="audit-target" name="targetId" type="number" min="1" step="1" defaultValue={params.get('targetId') || ''} />
    <button>Filter Audit Log</button><button type="button" onClick={() => submit(new URLSearchParams())}>Clear Filters</button>
  </form>
}
function details(entry: AccountAuditEntry) {
  return Object.entries(entry.details).filter(([key, value]) => key === 'invitationId' ? Number.isSafeInteger(value) : ['oldRole', 'newRole'].includes(key) ? ['student', 'teacher', 'admin'].includes(String(value)) : ['oldStatus', 'newStatus'].includes(key) && ['active', 'disabled'].includes(String(value))).map(([key, value]) => `${key}: ${value}`).join('; ') || '—'
}
export default function AdminAuditPage() {
  const [params, setParams] = useSearchParams()
  const query = params.toString()
  const [revision, setRevision] = useState(0)
  const key = `${query}:${revision}`
  const [result, setResult] = useState<{ key: string; logs: AccountAuditEntry[]; pagination?: Pagination; error?: string } | null>(null)
  const current = result?.key === key ? result : null
  useEffect(() => {
    const controller = new AbortController(); const request = new URLSearchParams(query); request.set('perPage', '20')
    fetchAudit(request, controller.signal).then(data => { if (!controller.signal.aborted) setResult({ key, ...data }) }).catch(reason => { if (!controller.signal.aborted) setResult({ key, logs: [], error: adminErrorMessage(reason) }) })
    return () => controller.abort()
  }, [key, query])
  function page(number: number) { const next = new URLSearchParams(params); next.set('page', String(number)); setParams(next) }
  return <div className="admin-users-page"><header className="paper-management-header"><div><span>Admin Console</span><h1>Audit Log</h1><Link to="/admin/users">Users and Invitations</Link></div></header>
    <Filters key={query} params={params} submit={setParams} />
    <section className="admin-glass admin-results" aria-label="Audit results" aria-busy={!current}>
      {!current ? <p role="status">Loading audit log...</p> : current.error ? <div role="alert"><p>{current.error}</p><button onClick={() => setRevision(value => value + 1)}>Retry</button></div> : <><p role="status">{current.pagination?.total} events</p><div className="admin-table-scroll" tabIndex={0} role="region" aria-label="Audit log table, scroll horizontally on smaller screens"><table><caption className="admin-sr-only">Account operation audit</caption><thead><tr>{['Actor', 'Target', 'Action', 'Time', 'Details'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead><tbody>{current.logs.map(entry => <tr key={entry.id}><td>{entry.actor ? `${entry.actor.username} (#${entry.actor.id})` : 'System / public request'}</td><td>{entry.target ? `${entry.target.username} (#${entry.target.id})` : entry.details.invitationId ? `Invitation #${entry.details.invitationId}` : '—'}</td><th scope="row">{entry.action}</th><td>{new Date(entry.createdAt.endsWith('Z') ? entry.createdAt : `${entry.createdAt}Z`).toLocaleString()}</td><td>{details(entry)}</td></tr>)}</tbody></table></div>{current.logs.length === 0 && <p>No matching events.</p>}</>}
      {current?.pagination && <nav className="admin-pagination" aria-label="Audit pagination"><button disabled={current.pagination.page <= 1} onClick={() => page(current.pagination!.page - 1)}>Previous</button><span>Page {current.pagination.totalPages ? current.pagination.page : 0} of {current.pagination.totalPages}</span><button disabled={current.pagination.page >= current.pagination.totalPages} onClick={() => page(current.pagination!.page + 1)}>Next</button></nav>}
    </section>
  </div>
}
