import { useContext, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { EditScopeContext } from './unsaved-context'
import { useUnsavedChanges } from './useUnsavedChanges'

function snapshot(form: HTMLFormElement) {
  return JSON.stringify(Array.from(form.elements).flatMap<unknown>(element => {
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) return []
    if (element instanceof HTMLInputElement && ['submit', 'button', 'reset', 'hidden'].includes(element.type)) return []
    if (element instanceof HTMLInputElement && element.type === 'file') return [[element.name, Array.from(element.files ?? []).map(f => [f.name, f.size, f.lastModified])]]
    return [[element.name, element.value, element instanceof HTMLInputElement && ['checkbox', 'radio'].includes(element.type) ? element.checked : null]]
  }))
}
// For existing uncontrolled upload/replacement forms only. No draft content leaves this component.
export function useUnsavedForm(ref: RefObject<HTMLFormElement | null>, busy: boolean, scope?: string, revision?: string) {
  const inheritedScope = useContext(EditScopeContext), id = useId()
  const localScope = scope ?? `${inheritedScope}/${id}`
  const observed = useRef(revision)
  const baseline = useRef(''), [dirty, setDirty] = useState(false)
  const requestExit = useUnsavedChanges(dirty, busy, localScope)
  useLayoutEffect(() => {
    const form = ref.current
    if (!form) return
    baseline.current = snapshot(form)
    const change = () => setDirty(snapshot(form) !== baseline.current)
    form.addEventListener('input', change); form.addEventListener('change', change)
    return () => { form.removeEventListener('input', change); form.removeEventListener('change', change) }
  }, [ref])
  useLayoutEffect(() => {
    if (!dirty && !busy && revision !== observed.current && ref.current) {
      // Only pristine uncontrolled fields follow a newer server revision.
      ref.current.reset(); baseline.current = snapshot(ref.current); observed.current = revision
    }
  }, [revision, dirty, busy, ref])
  const saved = () => { if (ref.current) { baseline.current = snapshot(ref.current); setDirty(false) } }
  return { dirty, requestExit: (action: () => void) => requestExit(action, localScope), saved }
}
