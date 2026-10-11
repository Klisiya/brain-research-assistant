import { useCallback } from 'react'
import { NavLink } from 'react-router-dom'
import { courseRequest, type ManagedCourse } from '../../api/courseManagement'
import { getResearchList } from '../../api/research'
import type { AuthUser } from '../../types/auth'
import { useManagementRead } from './useManagementRead'

export default function ManagementNavigation({ user }: { user: AuthUser }) {
  const reader = useCallback(async (signal: AbortSignal) => {
    if (user.role === 'admin') return { courses: true, research: true, failed: false }
    const [courses, research] = await Promise.allSettled([
      courseRequest<{ courses: ManagedCourse[] }>('/api/courses/manage', { signal }),
      getResearchList(true, signal),
    ])
    return {
      courses: courses.status === 'fulfilled' && courses.value.courses.length > 0,
      research: research.status === 'fulfilled' && research.value.length > 0,
      failed: [courses, research].some(result => result.status === 'rejected' && (!(result.reason instanceof Error) || !('status' in result.reason) || result.reason.status !== 403)),
    }
  }, [user.role])
  const access = useManagementRead(`navigation:${user.id}:${user.role}`, reader)
  return <div className="management-navigation">
    <nav aria-label="Management navigation">
      <NavLink end to="/manage">Management</NavLink>
      <NavLink to="/manage/papers">Papers</NavLink>
      {user.role === 'admin' && <><NavLink to="/admin/users">Users & Invitations</NavLink><NavLink to="/admin/audit-log">Audit Log</NavLink></>}
      {access.data?.research && <NavLink to="/manage/research-areas">Research Maintenance</NavLink>}
      {access.data?.courses && <NavLink to="/manage/courses">Course Maintenance</NavLink>}
    </nav>
    {access.loading && <p role="status">Checking assigned workspaces…</p>}
    {(access.error || access.data?.failed) && <p role="status">Some assigned workspaces could not be checked. <button type="button" onClick={access.retry}>Retry access check</button></p>}
  </div>
}
