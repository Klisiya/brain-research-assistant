import { useLocation } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth'
import { readSearchOrigin, searchReturn } from './searchOrigin'

export function useSearchReturn(enabled = true) {
  const location = useLocation(), { state: auth } = useAuth()
  const origin = enabled ? readSearchOrigin(location.search, auth) : null
  return origin ? searchReturn(origin) : null
}
