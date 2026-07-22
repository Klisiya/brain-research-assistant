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

export type PaperTopic =
  | 'Neuroscience'
  | 'Memory'
  | 'Neuroplasticity'
  | 'Cognition'
  | 'Brain Imaging'
  | 'Brain-Computer Interfaces'
  | 'Brain Disorders'
  | 'AI & Brain Science'

export type PaperView = 'all' | 'recommended' | 'resources' | 'progress'

export type PaperSort = 'recommended' | 'newest' | 'oldest' | 'reading-time'

export type Paper = {
  id: string
  slug: string
  title: string
  authors: string[]
  year: number
  journal: string
  publicationType: PaperPublicationType
  topics: PaperTopic[]
  difficulty: PaperDifficulty
  estimatedReadingMinutes: number
  abstract: string
  learningObjectives: string[]
  keywords: string[]
  featured: boolean
  openAccess: boolean
  externalUrl: string
  resourceCategory: PaperResourceCategory
  readingStatus: PaperReadingStatus
}
