// Presentation types only. Course content is served by the course API.
export type ModuleCoverVariant =
  | 'overview'
  | 'microstructure'
  | 'connectome'
  | 'neurodegeneration'
  | 'vascular'
  | 'neuroimmune'
  | 'neurooncology'
  | 'brain-ai'
  | 'literature-one'
  | 'literature-two'
  | 'workshop-one'
  | 'workshop-two'

export type LearningModule = {
  category: string
  coverVariant: ModuleCoverVariant
  description: string
  durationHours: number
  id: number
  learningFocus: string
  number: number
  slug: string
  title: string
  titleZh: string
}
