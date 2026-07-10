import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import Footer from '../components/Footer'
import Navbar from '../components/Navbar'
import './BrainRegionPage.css'

type BrainRegionSection = {
  id: string
  title: string
  content?: string
  items?: string[]
}

type BrainRegion = {
  slug: string
  name: string
  subtitle: string
  overview: string
  keyFunctions: string[]
  relatedCognitiveProcesses: string[]
  clinicalRelevance: string
  researchHighlights: string[]
  sections: BrainRegionSection[]
}

type RegionPageState =
  | { status: 'loading' }
  | { status: 'success'; region: BrainRegion }
  | { status: 'not-found' }
  | { status: 'error' }

const knownSectionIds = new Set([
  'main-functions',
  'related-cognitive-processes',
  'clinical-relevance',
  'research-highlights',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function readStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
}

function readSections(value: unknown): BrainRegionSection[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.reduce<BrainRegionSection[]>((sections, item, index) => {
    if (!isRecord(item)) {
      return sections
    }

    const title = readString(item.title)
    const content = readString(item.content)
    const items = readStringArray(item.items)

    if (!title || (!content && items.length === 0)) {
      return sections
    }

    sections.push({
      id: readString(item.id) || `section-${index + 1}`,
      title,
      ...(content ? { content } : {}),
      ...(items.length > 0 ? { items } : {}),
    })

    return sections
  }, [])
}

function parseBrainRegionResponse(payload: unknown): BrainRegion | null {
  if (!isRecord(payload) || !isRecord(payload.region)) {
    return null
  }

  const region = payload.region
  const slug = readString(region.slug)
  const name = readString(region.name)

  if (!slug || !name) {
    return null
  }

  return {
    slug,
    name,
    subtitle: readString(region.subtitle) || 'Brain Region',
    overview: readString(region.overview),
    keyFunctions: readStringArray(region.keyFunctions),
    relatedCognitiveProcesses: readStringArray(region.relatedCognitiveProcesses),
    clinicalRelevance: readString(region.clinicalRelevance),
    researchHighlights: readStringArray(region.researchHighlights),
    sections: readSections(region.sections),
  }
}

function hasSectionContent(section: BrainRegionSection) {
  return Boolean(section.content || (section.items && section.items.length > 0))
}

function RegionStatus({ message }: { message: string }) {
  return (
    <main className="brain-region-main brain-region-main-status">
      <section className="brain-region-hero brain-region-status-card">
        <Link className="brain-region-back-link" to="/">
          Back to Home
        </Link>
        <p>{message}</p>
      </section>
    </main>
  )
}

function RegionItemGrid({ items, title }: { items: string[]; title: string }) {
  if (items.length === 0) {
    return null
  }

  return (
    <section className="brain-region-section">
      <div className="brain-region-section-heading">
        <span>Neural Profile</span>
        <h2>{title}</h2>
      </div>

      <div className="brain-region-card-grid">
        {items.map((item) => (
          <article className="brain-region-info-card" key={item}>
            <p>{item}</p>
          </article>
        ))}
      </div>
    </section>
  )
}

function RegionTextBlock({ children, title }: { children: string; title: string }) {
  if (!children) {
    return null
  }

  return (
    <section className="brain-region-section">
      <article className="brain-region-glass-block">
        <span>Applied Context</span>
        <h2>{title}</h2>
        <p>{children}</p>
      </article>
    </section>
  )
}

function RegionAdditionalSections({ sections }: { sections: BrainRegionSection[] }) {
  const additionalSections = sections.filter(
    (section) => !knownSectionIds.has(section.id) && hasSectionContent(section),
  )

  if (additionalSections.length === 0) {
    return null
  }

  return (
    <section className="brain-region-section">
      <div className="brain-region-section-heading">
        <span>Reference Notes</span>
        <h2>Additional Sections</h2>
      </div>

      <div className="brain-region-detail-list">
        {additionalSections.map((section) => (
          <article className="brain-region-glass-block" key={section.id}>
            <h3>{section.title}</h3>
            {section.content ? <p>{section.content}</p> : null}
            {section.items && section.items.length > 0 ? (
              <ul>
                {section.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  )
}

function BrainRegionPage() {
  const { slug } = useParams<{ slug: string }>()
  const [pageState, setPageState] = useState<RegionPageState>({ status: 'loading' })
  const displayedState: RegionPageState = slug ? pageState : { status: 'not-found' }

  useEffect(() => {
    if (!slug) {
      return undefined
    }

    const controller = new AbortController()
    const regionSlug = slug

    async function loadBrainRegion() {
      setPageState({ status: 'loading' })

      try {
        const response = await fetch(`/api/brain-regions/${encodeURIComponent(regionSlug)}`, {
          credentials: 'include',
          signal: controller.signal,
        })

        if (response.status === 404) {
          setPageState({ status: 'not-found' })
          return
        }

        if (!response.ok) {
          setPageState({ status: 'error' })
          return
        }

        const payload: unknown = await response.json()
        const region = parseBrainRegionResponse(payload)

        if (!region) {
          setPageState({ status: 'error' })
          return
        }

        setPageState({ status: 'success', region })
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return
        }

        setPageState({ status: 'error' })
      }
    }

    void loadBrainRegion()

    return () => {
      controller.abort()
    }
  }, [slug])

  return (
    <div className="brain-region-page">
      <Navbar />

      {displayedState.status === 'loading' ? <RegionStatus message="Loading brain region..." /> : null}
      {displayedState.status === 'not-found' ? (
        <RegionStatus message="Brain region not found." />
      ) : null}
      {displayedState.status === 'error' ? (
        <RegionStatus message="Unable to load this brain region. Please try again." />
      ) : null}

      {displayedState.status === 'success' ? (
        <main className="brain-region-main">
          <section className="brain-region-hero">
            <Link className="brain-region-back-link" to="/">
              Back to Home
            </Link>
            <span className="brain-region-kicker">{displayedState.region.subtitle}</span>
            <h1>{displayedState.region.name}</h1>
            {displayedState.region.overview ? <p>{displayedState.region.overview}</p> : null}
          </section>

          <RegionItemGrid items={displayedState.region.keyFunctions} title="Key Functions" />
          <RegionItemGrid
            items={displayedState.region.relatedCognitiveProcesses}
            title="Related Cognitive Processes"
          />
          <RegionTextBlock title="Clinical Relevance">
            {displayedState.region.clinicalRelevance}
          </RegionTextBlock>
          <RegionItemGrid
            items={displayedState.region.researchHighlights}
            title="Research Highlights"
          />
          <RegionAdditionalSections sections={displayedState.region.sections} />
        </main>
      ) : null}

      <Footer />
    </div>
  )
}

export default BrainRegionPage
