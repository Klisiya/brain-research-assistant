import { useEffect } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import type { AuthUser } from '../../types/auth'
import { MANAGEMENT_ORIGIN, listPage, readManagementOrigin, type ManagementKind } from './managementOrigin'
import './ManagementReturn.css'

export function useManagementOrigin(user: AuthUser | null, allowed: readonly ManagementKind[]) {
  const location = useLocation(), navigate = useNavigate()
  const origin = user ? readManagementOrigin(location.search, user, allowed) : null
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    if (user && params.has(MANAGEMENT_ORIGIN) && !origin) {
      params.delete(MANAGEMENT_ORIGIN)
      void navigate({ pathname: location.pathname, search: params.toString(), hash: location.hash }, { replace: true, state: location.state })
    }
  }, [user, origin, location, navigate])
  return origin
}

// Clamp only after the current request succeeds. An error must not look like an empty list.
export function useManagementListPosition(data: { totalPages: number } | null | undefined, enabled = true) {
  const [params, setParams] = useSearchParams(), location = useLocation()
  const total = data?.totalPages
  useEffect(() => {
    if (!enabled || total === undefined || !Number.isSafeInteger(total) || total < 0) return
    const page = listPage(params.get('page')), last = Math.max(1, total)
    if (page > last) { const next = new URLSearchParams(params); next.set('page', String(last)); setParams(next, { replace: true }); return }
    if (!/^#(?:faculty|industry|discussions|reports|papers)-[1-9]\d*$/.test(location.hash)) return
    const row = [...document.querySelectorAll<HTMLElement>('[data-management-row]')]
      .find(element => element.dataset.managementRow === location.hash.slice(1) && element.getClientRects().length > 0)
    if (row) { row.focus({ preventScroll: true }); row.scrollIntoView({ block: 'nearest' }) }
  }, [enabled, total, params, setParams, location.hash, location.key])
}
