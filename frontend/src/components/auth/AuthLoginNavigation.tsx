import { Link, Navigate, useLocation, type LinkProps } from 'react-router-dom'
import { authLoginState, type LoginNotice } from './authOrigin'

export function AuthLoginLink({ notice, ...props }: Omit<LinkProps, 'to' | 'state'> & { notice?: LoginNotice }) {
  const location = useLocation()
  return <Link {...props} to="/login" state={authLoginState(location, notice)} />
}

export function AuthLoginRedirect({ notice }: { notice?: LoginNotice }) {
  const location = useLocation()
  // BrowserRouter transitions may still render the previous route after logout
  // has already navigated Home. Never capture that obsolete protected location.
  if (`${location.pathname}${location.search}${location.hash}` !== `${window.location.pathname}${window.location.search}${window.location.hash}`) return null
  return <Navigate replace to="/login" state={authLoginState(location, notice)} />
}
