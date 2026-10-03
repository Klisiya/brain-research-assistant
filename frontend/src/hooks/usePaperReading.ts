import { useCallback } from 'react'
import { getPaperReading } from '../api/reading'
import { usePersonalState } from './usePersonalState'

export function usePaperReading(slug: string) {
  const reader = useCallback((signal: AbortSignal) => slug ? getPaperReading(slug, signal) : Promise.resolve(null), [slug])
  return usePersonalState(`paper:${slug}`, reader)
}
export type PaperReadingController = ReturnType<typeof usePaperReading>
