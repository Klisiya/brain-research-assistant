import type {
  PaperDifficulty,
  PaperPublicationType,
  PaperSort,
  PaperView,
} from '../types/paper'

export const PAPER_DIFFICULTIES: readonly PaperDifficulty[] = [
  'Beginner',
  'Intermediate',
  'Advanced',
]

export const PAPER_PUBLICATION_TYPES: readonly PaperPublicationType[] = [
  'Research Article',
  'Review',
  'Book Chapter',
  'Learning Resource',
]

export const PAPER_VIEW_OPTIONS: readonly {
  label: string
  value: PaperView
}[] = [
  { label: 'All Papers', value: 'all' },
  { label: 'Recommended', value: 'recommended' },
  { label: 'Learning Resources', value: 'resources' },
  { label: 'Reading Progress', value: 'progress' },
]

export const PAPER_SORT_OPTIONS: readonly {
  label: string
  value: PaperSort
}[] = [
  { label: 'Recommended', value: 'recommended' },
  { label: 'Newest', value: 'newest' },
  { label: 'Oldest', value: 'oldest' },
  { label: 'Reading Time', value: 'readingTime' },
  { label: 'Title', value: 'title' },
]
