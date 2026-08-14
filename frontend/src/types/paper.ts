export type PaperPublicationType =
  | 'Research Article'
  | 'Review'
  | 'Book Chapter'
  | 'Learning Resource'

export type PaperDifficulty = 'Beginner' | 'Intermediate' | 'Advanced'

export type PaperResourceCategory =
  | 'Foundational'
  | 'Recommended'
  | 'Course Resource'
  | 'Emerging Research'

export type PaperReadingStatus = 'Not Started' | 'In Progress' | 'Completed'

export type PaperTopic = string

export type PaperView = 'all' | 'recommended' | 'resources' | 'progress'

export type PaperSort = 'recommended' | 'newest' | 'oldest' | 'reading-time'

export type Paper = {
  id: number
  slug: string
  title: string
  authors: string[]
  year: number | null
  journal: string | null
  publicationType: PaperPublicationType
  topics: string[]
  difficulty: PaperDifficulty
  estimatedReadingMinutes: number
  abstract: string
  learningObjectives: string[]
  keywords: string[]
  featured: boolean
  openAccess: boolean
  externalUrl: string | null
  resourceCategory: PaperResourceCategory
  createdAt: string
  updatedAt: string
  publishedAt: string | null
}

export type LegacyDemoPaper = Omit<
  Paper,
  'createdAt' | 'externalUrl' | 'id' | 'journal' | 'publishedAt' | 'updatedAt' | 'year'
> & {
  id: string
  year: number
  journal: string
  externalUrl: string
  readingStatus: PaperReadingStatus
}
