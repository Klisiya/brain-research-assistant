export type BrainHotspotSide = 'left' | 'right'

export type BrainHotspot = {
  id: string
  label: string
  description: string
  position: string
  normal: string
  url: string
  priority: number
  side: BrainHotspotSide
  alignment: BrainHotspotSide
}

export const brainHotspots: BrainHotspot[] = [
  {
    id: 'frontal-lobe',
    label: 'Frontal Lobe',
    description: '',
    position: '-0.445m 0.298m -0.300m',
    normal: '-0.83m 0.45m 0.23m',
    url: '/brain-region/frontal-lobe',
    priority: 1,
    side: 'left',
    alignment: 'left',
  },
  {
    id: 'parietal-lobe',
    label: 'Parietal Lobe',
    description: '',
    position: '0.006m 0.535m 0.118m',
    normal: '0.02m 0.97m 0.22m',
    url: '/brain-region/parietal-lobe',
    priority: 2,
    side: 'right',
    alignment: 'right',
  },
  {
    id: 'temporal-lobe',
    label: 'Temporal Lobe',
    description: '',
    position: '-0.328m -0.066m 0.361m',
    normal: '-0.62m -0.12m 0.78m',
    url: '/brain-region/temporal-lobe',
    priority: 3,
    side: 'left',
    alignment: 'left',
  },
  {
    id: 'occipital-lobe',
    label: 'Occipital Lobe',
    description: '',
    position: '0.533m 0.190m 0.160m',
    normal: '0.94m 0.27m 0.20m',
    url: '/brain-region/occipital-lobe',
    priority: 4,
    side: 'right',
    alignment: 'right',
  },
  {
    id: 'cerebellum',
    label: 'Cerebellum',
    description: '',
    position: '0.247m -0.303m 0.331m',
    normal: '0.41m -0.76m 0.50m',
    url: '/brain-region/cerebellum',
    priority: 5,
    side: 'right',
    alignment: 'right',
  },
  {
    id: 'brainstem',
    label: 'Brainstem',
    description: '',
    position: '0.113m -0.403m 0.138m',
    normal: '0.25m -0.92m 0.30m',
    url: '/brain-region/brainstem',
    priority: 6,
    side: 'left',
    alignment: 'left',
  },
]
