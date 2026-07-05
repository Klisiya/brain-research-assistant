export type ModuleVisual = 'neuron' | 'synapse' | 'brain'

export type LearningModule = {
  id: string
  moduleLabel: string
  title: string
  shortDescription: string
  backTitle: string
  backDescription: string
  keyConcepts: string[]
  estimatedTime: string
  link: string
  visual: ModuleVisual
}

export const learningModules: LearningModule[] = [
  {
    id: 'nervous-system-basics',
    moduleLabel: 'Module 1',
    title: 'Nervous System Basics',
    shortDescription: 'Basic structure and function of the nervous system',
    backTitle: 'Nervous System Basics',
    backDescription: 'Key Concepts',
    keyConcepts: [
      'Central and peripheral nervous systems',
      'Brain regions and core functions',
      'Neural communication overview',
    ],
    estimatedTime: 'Estimated time: 20 min',
    link: ' ',
    visual: 'neuron',
  },
  {
    id: 'neurons-and-synapses',
    moduleLabel: 'Module 2',
    title: 'Neurons and Synapses',
    shortDescription: 'Neurons, synapses, and neural signal transmission',
    backTitle: 'Neurons and Synapses',
    backDescription: 'Key Concepts',
    keyConcepts: [
      'Neuron structure and signal flow',
      'Synaptic transmission',
      'Excitatory and inhibitory signals',
    ],
    estimatedTime: 'Estimated time: 25 min',
    link: '#',
    visual: 'synapse',
  },
  {
    id: 'memory-and-intelligence',
    moduleLabel: 'Module 3',
    title: 'Memory and Intelligence',
    shortDescription: 'Memory, learning, cognition, and intelligence',
    backTitle: 'Memory and Intelligence',
    backDescription: 'Key Concepts',
    keyConcepts: [
      'Memory encoding and retrieval',
      'Learning and plasticity',
      'Cognition and intelligent behavior',
    ],
    estimatedTime: 'Estimated time: 30 min',
    link: '#',
    visual: 'brain',
  },
]
