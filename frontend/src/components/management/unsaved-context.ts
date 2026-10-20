import { createContext } from 'react'
export type EditState = { dirty: boolean; busy: boolean; scope: string }
export type ExitGuard = {
  register: (id: string, state: EditState) => void
  unregister: (id: string) => void
  requestExit: (action: () => void, scope?: string) => void
}
export const UnsavedContext = createContext<ExitGuard | null>(null)
export const EditScopeContext = createContext('page')
