import { useCallback, useContext, useId, useLayoutEffect, useRef } from 'react'
import { EditScopeContext, UnsavedContext } from './unsaved-context'

export function useUnsavedChanges(dirty: boolean, busy = false, overrideScope?: string) {
  const guard = useContext(UnsavedContext), inheritedScope = useContext(EditScopeContext), id = useId()
  const scope = overrideScope ?? inheritedScope
  if (!guard) throw new Error('Unsaved changes protection requires its provider.')
  const { register, unregister } = guard
  useLayoutEffect(() => {
    register(id, { dirty, busy, scope })
    return () => unregister(id)
  }, [id, dirty, busy, scope, register, unregister])
  return guard.requestExit
}

export function useEditorMounted() {
  const mounted = useRef(true)
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  return useCallback(() => mounted.current, [])
}
