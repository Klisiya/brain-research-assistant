import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth'
import ConfirmDialog from '../papers/ConfirmDialog'
import { EditScopeContext, UnsavedContext, type EditState } from './unsaved-context'

export function UnsavedChangesScope({ name, children }: { name: string; children: ReactNode }) {
  return <EditScopeContext.Provider value={name}>{children}</EditScopeContext.Provider>
}

function Protection({ children }: { children: ReactNode }) {
  const location = useLocation(), navigate = useNavigate()
  const states = useRef(new Map<string, EditState>())
  const [flags, setFlags] = useState({ dirty: false, busy: false })
  const [pending, setPending] = useState<{ action: () => void; scope?: string; kind: 'dirty' | 'busy' } | null>(null)
  const pendingRef = useRef(false), replay = useRef(false), acceptedUnload = useRef(false)
  const exitTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(exitTimer.current), [])
  const summarize = useCallback(() => {
    const all = [...states.current.values()], dirty = all.some(s => s.dirty), busy = all.some(s => s.busy)
    setFlags(previous => previous.dirty === dirty && previous.busy === busy ? previous : { dirty, busy })
  }, [])
  const register = useCallback((id: string, state: EditState) => { states.current.set(id, state); summarize() }, [summarize])
  const unregister = useCallback((id: string) => { states.current.delete(id); summarize() }, [summarize])
  const requestExit = useCallback((action: () => void, scope?: string) => {
    const all = [...states.current.values()].filter(s => !scope || (s.scope === scope || s.scope.startsWith(scope + '/')))
    if (all.some(s => s.busy)) { setPending({ action: () => {}, scope, kind: 'busy' }); return }
    if (pendingRef.current) return
    if (all.some(s => s.dirty)) { pendingRef.current = true; setPending({ action, scope, kind: 'dirty' }) }
    else action()
  }, [])
  useEffect(() => {
    if (!flags.dirty && !flags.busy) return
    const click = (event: MouseEvent) => {
      if (replay.current || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      if (!(event.target instanceof Element)) return
      const anchor = event.target.closest<HTMLAnchorElement>('a[href]')
      // The existing Navbar has a single button menuitem: Sign Out. Do not change its auth handler.
      const signOut = event.target.closest<HTMLButtonElement>('.account-menu button[role="menuitem"]')
      const target = anchor ?? signOut
      if (!target || target.closest('dialog')) return
      if (anchor) {
        if (anchor.hasAttribute('download') || anchor.target && anchor.target !== '_self') return
        const url = new URL(anchor.href, window.location.href)
        if (url.origin !== window.location.origin || url.pathname.startsWith('/api/')) return
        if (url.pathname === location.pathname && url.search === location.search) return
      }
      const destination = anchor ? new URL(anchor.href, window.location.href) : null
      event.preventDefault(); event.stopImmediatePropagation()
      requestExit(() => {
        // Dropdowns may remove their Link when the dialog takes focus. The captured
        // same-origin path retains its validated management context query.
        if (!target.isConnected) { if (destination) navigate(destination.pathname + destination.search + destination.hash); return }
        replay.current = true; acceptedUnload.current = true
        window.setTimeout(() => { acceptedUnload.current = false }, 0)
        try { target.click() } finally { replay.current = false }
      })
    }
    const submitSearch = (event: SubmitEvent) => {
      const form = event.target
      if (replay.current || event.defaultPrevented || !(form instanceof HTMLFormElement) || !form.matches('form.search-box[role="search"]') || !form.querySelector<HTMLInputElement>('input')?.value.trim()) return
      event.preventDefault(); event.stopImmediatePropagation()
      requestExit(() => {
        if (!form.isConnected) return
        replay.current = true
        try { form.requestSubmit() } finally { replay.current = false }
      })
    }
    document.addEventListener('click', click, true)
    document.addEventListener('submit', submitSearch, true)
    return () => { document.removeEventListener('click', click, true); document.removeEventListener('submit', submitSearch, true) }
  }, [flags, location.pathname, location.search, navigate, requestExit])
  useEffect(() => {
    if (!flags.dirty) return
    const unload = (event: BeforeUnloadEvent) => { if (acceptedUnload.current) return; event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', unload)
    return () => window.removeEventListener('beforeunload', unload)
  }, [flags.dirty])
  const keep = () => { pendingRef.current = false; setPending(null) }
  const discard = () => {
    if (!pending) return
    if ([...states.current.values()].some(s => s.busy && (!pending.scope || (s.scope === pending.scope || s.scope.startsWith(pending.scope + '/'))))) return
    const action = pending.action
    pendingRef.current = false; setPending(null)
    // Let the dialog restore its trigger before a local switch unmounts that trigger.
    exitTimer.current = window.setTimeout(action, 0)
  }
  const value = useMemo(() => ({ register, unregister, requestExit }), [register, unregister, requestExit])
  const waiting = pending?.kind === 'busy' && flags.busy
  return <UnsavedContext.Provider value={value}>{children}
    {pending?.kind === 'dirty' && <ConfirmDialog title="Discard unsaved changes?" description="You have changes that have not been saved." cancelLabel="Keep editing" confirmLabel="Discard changes" busy={flags.busy} onCancel={keep} onConfirm={discard} />}
    {waiting && <ConfirmDialog title="Saving in progress" description="Please wait for the current operation to finish, then try leaving again." cancelLabel="Keep editing" confirmLabel="Please wait" busy onCancel={keep} onConfirm={() => {}} />}
  </UnsavedContext.Provider>
}

export default function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const { state } = useAuth()
  const account = state.status === 'authenticated' ? `${state.user.id}:${state.user.role}` : state.status
  // Account changes drop every draft registration, deferred action and dialog together.
  return <Protection key={account}>{children}</Protection>
}
