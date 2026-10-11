import type { AuthUser } from '../types/auth'

export default function ManagementPage({ currentUser }: { currentUser: AuthUser }) {
  return <section className="management-overview">
    <header><h1>Management</h1><p>Choose an available workspace above.</p></header>
    <h2>{currentUser.role === 'admin' ? 'Admin responsibilities' : 'Teacher responsibilities'}</h2>
    <p>{currentUser.role === 'admin' ? 'Manage accounts, invitations, account audit records, and existing content tools.' : 'Manage your Papers and any workspaces already assigned to your account.'}</p>
    <p>Course Maintenance retains existing internal tools. Course teaching content is maintained through the code and data layer.</p>
  </section>
}
