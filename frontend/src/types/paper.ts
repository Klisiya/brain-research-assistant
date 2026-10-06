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

export type PaperTopic = string

export type PaperView = 'all' | 'recommended' | 'resources' | 'progress'

export type PaperSort = 'recommended' | 'newest' | 'oldest' | 'readingTime' | 'title'

export type PaperStatus = 'draft' | 'published' | 'archived'

export type PaperCreator = {
  id: number
  username: string
  role: 'student' | 'teacher' | 'admin'
}

export type Paper = {
  id: number
  slug: string
  title: string
  authors: string[]
  year: number | null
  journal: string | null
  doi?: string | null
  volume?: string | null
  issue?: string | null
  pages?: string | null
  publisher?: string | null
  publicationType: PaperPublicationType | ''
  topics: string[]
  difficulty: PaperDifficulty | ''
  estimatedReadingMinutes: number
  abstract: string
  learningObjectives: string[]
  keywords: string[]
  featured: boolean
  openAccess: boolean
  externalUrl: string | null
  resourceCategory: PaperResourceCategory | ''
  createdAt: string
  updatedAt: string
  publishedAt: string | null
}

export type ManagedPaper = Paper & {
  status: PaperStatus
  createdBy: PaperCreator | null
  updatedById: number | null
}

export type PreviewPaper = Paper & {
  status: PaperStatus
  preview: true
}

export type PaperWriteInput = {
  title: string
  authors: string[]
  year: number | null
  journal: string | null
  doi: string | null
  volume: string | null
  issue: string | null
  pages: string | null
  publisher: string | null
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
  status: PaperStatus
}

export type AttachmentFileType = 'pdf' | 'cover' | 'slides' | 'document'
export type AttachmentType = AttachmentFileType | 'external_link'
export type AttachmentAccessLevel = 'public' | 'authenticated' | 'staff'
export type PaperAttachment = {
  id: number
  paperId: number
  attachmentType: AttachmentType
  displayName: string
  description: string | null
  mimeType: string | null
  fileSize: number | null
  externalUrl: string | null
  accessLevel: AttachmentAccessLevel
  version: number
  sortOrder: number
  createdAt: string
  updatedAt: string
  downloadUrl: string | null
}
export type PaperAttachmentUploader = { id: number; username: string; role: PaperCreator['role'] | 'user' }
export type ManagedPaperAttachment = PaperAttachment & {
  originalFilename: string | null
  sha256: string | null
  uploadedBy: PaperAttachmentUploader
}
export type AttachmentWriteInput = {
  attachmentType: AttachmentType
  displayName: string
  description: string | null
  accessLevel: AttachmentAccessLevel
  sortOrder: number
}
export type AttachmentFileInput = AttachmentWriteInput & { attachmentType: AttachmentFileType; file: File }
export type AttachmentLinkInput = AttachmentWriteInput & { attachmentType: 'external_link'; externalUrl: string }
export type AttachmentMutationResult = { attachment: ManagedPaperAttachment; cleanupPending: boolean }
