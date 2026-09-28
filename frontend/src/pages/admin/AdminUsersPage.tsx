import { useEffect, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AdminApiError, adminErrorMessage, fetchAdminUsers, type AdminUsersResponse, type UserFilters } from '../../api/admin'
import { useAuth } from '../../auth/useAuth'
import UserDialog from './UserDialog'
import InvitationsPanel from './InvitationsPanel'
import { readUserFilters, userFilterParams } from './user-filters'
import './AdminUsersPage.css'
function SearchForm({ query, onSearch }: { query: string; onSearch: (q: string) => void }) {
  const [draft, setDraft] = useState(query)
  function submit(event: FormEvent) { event.preventDefault(); onSearch(draft.trim()) }
  return <form onSubmit={submit} role="search"><label htmlFor="users-search">Search users</label><div className="admin-search-row"><input id="users-search" type="search" placeholder="Username or email" maxLength={200} value={draft} onChange={event => setDraft(event.target.value)} /><button type="submit">Search Users</button></div></form>
}
function dateLabel(value: string | null, fallback: string) {
  if (!value) return fallback
  const date = new Date(value.endsWith('Z') || /[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`)
  return Number.isNaN(date.getTime()) ? 'Unavailable' : date.toLocaleString()
}
export default function AdminUsersPage() {
  const [params, setParams] = useSearchParams()
  const filters = readUserFilters(params)
  const canonical = userFilterParams(filters).toString()
  const { refreshAuth } = useAuth()
  const [revision, setRevision] = useState(0)
  const key = `${canonical}:${revision}`
  const [result, setResult] = useState<{ key: string; payload: AdminUsersResponse | null; error: string | null } | null>(null)
  const current = result?.key === key ? result : null
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const raw = params.toString()
  useEffect(() => { if (raw !== canonical) setParams(canonical, { replace: true }) }, [raw, canonical, setParams])
  useEffect(() => {
    const controller = new AbortController()
    const requested = readUserFilters(new URLSearchParams(canonical))
    fetchAdminUsers(requested, controller.signal).then(payload => {
      if (controller.signal.aborted) return
      const maxPage = Math.max(1, payload.pagination.totalPages)
      if (requested.page > maxPage) { setParams(userFilterParams({ ...requested, page: maxPage }), { replace: true }); return }
      setResult({ key, payload, error: null })
    }).catch(async (error: unknown) => {
      if (controller.signal.aborted) return
      setResult({ key, payload: null, error: adminErrorMessage(error) })
      if (error instanceof AdminApiError && error.status === 403) await refreshAuth()
    })
    return () => controller.abort()
  }, [canonical, key, refreshAuth, setParams])
  function update(values: Partial<UserFilters>) { setParams(userFilterParams({ ...filters, page: 1, ...values })) }
  const payload = current?.payload
  const filtered = Boolean(filters.q || filters.role || filters.status)
  return <div className="admin-users-page">
    <header className="paper-management-header"><div><span>Admin Console</span><h1 id="admin-users-title" tabIndex={-1}>Users</h1><p>Manage account roles and access.</p></div></header>
    <section className="admin-filters admin-glass" aria-label="User filters">
      <SearchForm key={filters.q} query={filters.q} onSearch={q => update({ q })} />
      <label htmlFor="users-role">Role</label><select id="users-role" value={filters.role} onChange={event => update({ role: event.target.value as UserFilters['role'] })}><option value="">All roles</option><option value="student">Student</option><option value="teacher">Teacher</option><option value="admin">Admin</option></select>
      <label htmlFor="users-status">Status</label><select id="users-status" value={filters.status} onChange={event => update({ status: event.target.value as UserFilters['status'] })}><option value="">All statuses</option><option value="active">Active</option><option value="disabled">Disabled</option></select>
      <button onClick={() => setParams(new URLSearchParams())}>Clear Filters</button>
    </section>
    <section className="admin-results admin-glass" aria-label="User results" aria-busy={!current}>
      {!current ? <p role="status">Loading users...</p> : current.error ? <div role="alert"><p className="admin-error">{current.error}</p><button onClick={() => setRevision(value => value + 1)}>Retry</button></div> : payload && payload.users.length === 0 ? <div role="status"><h2>{filtered ? 'No Matching Users' : 'No Users Yet'}</h2><p>{filtered ? 'Try another search or clear the filters.' : 'There are no accounts to display.'}</p></div> : payload ? <>
        <p role="status">{payload.pagination.total} users</p>
        <div className="admin-table-scroll" tabIndex={0} role="region" aria-label="Users table, scroll horizontally on smaller screens"><table><caption className="admin-sr-only">User accounts</caption><thead><tr>{['Username', 'Email', 'Role', 'Status', 'Created', 'Last Login', 'Actions'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead><tbody>{payload.users.map(user => <tr key={user.id}><th scope="row">{user.username}</th><td>{user.email}</td><td className="admin-role">{user.role}</td><td><span className={`admin-status ${user.isActive ? 'active' : 'disabled'}`}>{user.isActive ? 'Active' : 'Disabled'}</span></td><td>{dateLabel(user.createdAt, 'Unavailable')}</td><td>{dateLabel(user.lastLoginAt, 'Never')}</td><td><button id={`manage-user-${user.id}`} aria-label={`Manage ${user.username}`} onClick={() => setSelectedId(user.id)}>Manage</button></td></tr>)}</tbody></table></div>
      </> : null}
      {payload ? <nav className="admin-pagination" aria-label="Users pagination"><button disabled={payload.pagination.page <= 1} onClick={() => update({ page: filters.page - 1 })}>Previous</button><span>Page {payload.pagination.totalPages === 0 ? 0 : payload.pagination.page} of {payload.pagination.totalPages}</span><button disabled={payload.pagination.page >= payload.pagination.totalPages} onClick={() => update({ page: filters.page + 1 })}>Next</button></nav> : null}
    </section>
    <InvitationsPanel />
    {selectedId !== null ? <UserDialog key={selectedId} id={selectedId} onClose={() => setSelectedId(null)} onChanged={() => setRevision(value => value + 1)} /> : null}
  </div>
}
