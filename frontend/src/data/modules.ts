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
  id: string
  learningFocus: string
  number: number
  slug: string
  title: string
  titleZh: string
}

export const learningModules: LearningModule[] = [
  {
    id: 'module-01',
    number: 1,
    slug: 'brain-science-overview',
    title: 'Brain Science: An Overview',
    titleZh: '脑科学总论',
    durationHours: 3,
    category: 'Brain Foundations',
    description: 'Introduces the scope, methods, applications, translation pathways, and interdisciplinary development of brain science, connecting major research questions with medicine and emerging scientific frontiers.',
    learningFocus: 'Research methods, scientific applications, clinical translation, interdisciplinary development, and the broader importance of brain science.',
    coverVariant: 'overview',
  },
  {
    id: 'module-02',
    number: 2,
    slug: 'brain-function-structure-microstructure-networks-one',
    title: 'Brain Function and Structure: From Microstructure to Networks I',
    titleZh: '脑功能与结构：从微观到网络-1',
    durationHours: 3,
    category: 'Structure and Networks',
    description: 'Examines brain cells, tissue organization, interregional connectivity, and the structural principles that support basic and higher brain functions.',
    learningFocus: 'Brain cells, tissue architecture, connectivity between brain regions, and structure–function relationships.',
    coverVariant: 'microstructure',
  },
  {
    id: 'module-03',
    number: 3,
    slug: 'brain-function-structure-microstructure-networks-two',
    title: 'Brain Function and Structure: From Microstructure to Networks II',
    titleZh: '脑功能与结构：从微观到网络-2',
    durationHours: 3,
    category: 'Structure and Networks',
    description: 'Explores synaptic transmission, circuit tracing, optogenetics, structural plasticity, connectomics, cortical organization, the glymphatic system, and circuit-level decoding of advanced brain functions.',
    learningFocus: 'Synapses, neural circuits, optogenetics, plasticity, connectomics, cortical parcellation, perception, movement, emotion, memory, and social cognition.',
    coverVariant: 'connectome',
  },
  {
    id: 'module-04',
    number: 4,
    slug: 'clinical-frontiers-brain-disorders-one',
    title: 'Clinical Frontiers in Brain Disorders I',
    titleZh: '脑疾病诊疗的临床前沿-1',
    durationHours: 3,
    category: 'Clinical Frontiers',
    description: 'Introduces major categories of brain disorders, emphasizing neurodegenerative and psychiatric conditions, their cellular and circuit mechanisms, evolving diagnostic strategies, treatment, and neuroethics.',
    learningFocus: 'Neurodegeneration, psychiatric disorders, learning and memory mechanisms, diagnosis, treatment, patient-centered care, and equitable brain health.',
    coverVariant: 'neurodegeneration',
  },
  {
    id: 'module-05',
    number: 5,
    slug: 'clinical-frontiers-brain-disorders-two',
    title: 'Clinical Frontiers in Brain Disorders II',
    titleZh: '脑疾病诊疗的临床前沿-2',
    durationHours: 3,
    category: 'Clinical Frontiers',
    description: 'Focuses on cerebrovascular disease mechanisms, precision diagnosis and therapy, neuromodulation technologies, prevention strategies, and ethical access to emerging treatments.',
    learningFocus: 'Cerebrovascular disease, precision medicine, DBS, TMS, tES, prevention, public health, and clinical ethics.',
    coverVariant: 'vascular',
  },
  {
    id: 'module-06',
    number: 6,
    slug: 'clinical-frontiers-brain-disorders-three',
    title: 'Clinical Frontiers in Brain Disorders III',
    titleZh: '脑疾病诊疗的临床前沿-3',
    durationHours: 3,
    category: 'Clinical Frontiers',
    description: 'Examines neuroimmune disorders, their mechanisms, diagnostic and therapeutic advances, immune-treatment breakthroughs, rare-disease care, and related neuroethical questions.',
    learningFocus: 'Neuroimmunology, autoimmune encephalitis, diagnosis, immune therapy, rare diseases, clinical uncertainty, and patient rights.',
    coverVariant: 'neuroimmune',
  },
  {
    id: 'module-07',
    number: 7,
    slug: 'clinical-frontiers-brain-disorders-four',
    title: 'Clinical Frontiers in Brain Disorders IV',
    titleZh: '脑疾病诊疗的临床前沿-4',
    durationHours: 3,
    category: 'Clinical Frontiers',
    description: 'Investigates brain tumors, especially glioma, covering disease mechanisms, modern diagnosis and treatment, multidisciplinary clinical collaboration, translational research, and neuroethics.',
    learningFocus: 'Brain tumors, glioma, diagnosis, treatment, MDT collaboration, immunotherapy, and clinical translation.',
    coverVariant: 'neurooncology',
  },
  {
    id: 'module-08',
    number: 8,
    slug: 'brain-science-ai-bidirectional-integration',
    title: 'Brain Science and AI: Bidirectional Integration',
    titleZh: '脑科学与AI的双向融合',
    durationHours: 3,
    category: 'Brain and AI',
    description: 'Connects brain-inspired artificial intelligence with AI-enabled brain science, spanning spiking neural networks, neuromorphic chips, attention and memory models, neuroimaging, EEG, behavioral data, and computational discovery.',
    learningFocus: 'Brain-inspired AI, AI-assisted brain research, neural computation, neuroimaging analysis, EEG, behavioral data, cognitive models, and responsible innovation.',
    coverVariant: 'brain-ai',
  },
  {
    id: 'module-09',
    number: 9,
    slug: 'frontier-literature-seminar-one',
    title: 'Frontier Literature Seminar I',
    titleZh: '前沿文献研讨-1',
    durationHours: 3,
    category: 'Literature Seminar',
    description: 'Analyzes milestone discoveries and emerging scientific questions through instructor-guided discussion, critical reading, and dynamically organized literature resources.',
    learningFocus: 'Landmark discoveries, key scientific questions, research methods, reproducibility, critical evaluation, and academic integrity.',
    coverVariant: 'literature-one',
  },
  {
    id: 'module-10',
    number: 10,
    slug: 'frontier-literature-seminar-two',
    title: 'Frontier Literature Seminar II',
    titleZh: '前沿文献研讨-2',
    durationHours: 3,
    category: 'Literature Seminar',
    description: 'Uses frontier studies from leading journals and conferences for group-led close reading, methodological critique, critical commentary, and reflective writing on the relationship between brain science and artificial intelligence.',
    learningFocus: 'Nature, Science, Neuron, NeurIPS, group presentations, critical review, scientific writing, and the boundary between brain science and AI.',
    coverVariant: 'literature-two',
  },
  {
    id: 'module-11',
    number: 11,
    slug: 'industry-education-integration-workshop-one',
    title: 'Industry–Education Integration Workshop I',
    titleZh: '产教融合坊',
    durationHours: 3,
    category: 'Industry–Education Integration',
    description: 'Explores brain–machine intelligence frameworks, digital-twin brain mechanisms, and the neural foundations of AGI through expert-led discussion of research, development, clinical translation, and industrial application.',
    learningFocus: 'Brain–machine intelligence, digital-twin brains, AGI, enterprise research, technology development, and clinical translation.',
    coverVariant: 'workshop-one',
  },
  {
    id: 'module-12',
    number: 12,
    slug: 'industry-education-integration-workshop-two',
    title: 'Industry–Education Integration Workshop II',
    titleZh: '产教融合坊2',
    durationHours: 3,
    category: 'Industry–Education Integration',
    description: 'Applies digital-twin brain concepts and AGI-assisted clinical tools to biomedical research and healthcare, combining product demonstrations, practical experience, and discussion of responsible innovation.',
    learningFocus: 'Digital twins, AGI-assisted diagnosis, clinical research, medical products, hands-on experience, ethical boundaries, and physician decision authority.',
    coverVariant: 'workshop-two',
  },
]
