import { useEffect, useMemo, useState } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import { fetchPapers } from '../api/papers'
import Footer from '../components/Footer'
import Navbar from '../components/Navbar'
import PageParticleBackground from '../components/PageParticleBackground'
import PaperCard from '../components/papers/PaperCard'
import PaperFilters from '../components/papers/PaperFilters'
import PapersHero from '../components/papers/PapersHero'
import PapersTabs from '../components/papers/PapersTabs'
import ReadingProgressPanel from '../components/papers/ReadingProgressPanel'
import type {
  Paper,
  PaperDifficulty,
  PaperPublicationType,
  PaperSort,
  PaperTopic,
  PaperView,
} from '../types/paper'
import './PapersPage.css'

function isPaperView(value: string | null): value is Exclude<PaperView, 'all'> {
  return value === 'recommended' || value === 'resources' || value === 'progress'
}

function getRecommendationScore(paper: Paper) {
  return Number(paper.featured) * 2 + Number(paper.resourceCategory === 'Recommended')
}

function compareYears(
  firstYear: number | null,
  secondYear: number | null,
  direction: 'newest' | 'oldest',
) {
  if (firstYear === null && secondYear === null) return 0
  if (firstYear === null) return 1
  if (secondYear === null) return -1
  return direction === 'newest' ? secondYear - firstYear : firstYear - secondYear
}

function PapersLoadingState() {
  return (
    <section aria-label="Loading research library" aria-live="polite" className="papers-loading-state">
      <p>Loading research library...</p>
      <div aria-hidden="true" className="paper-card-grid papers-skeleton-grid">
        {Array.from({ length: 6 }, (_, index) => (
          <article className="paper-card paper-skeleton-card" key={index}>
            <div className="paper-skeleton-line is-badge" />
            <div className="paper-skeleton-line is-title" />
            <div className="paper-skeleton-line is-byline" />
            <div className="paper-skeleton-line is-copy" />
            <div className="paper-skeleton-line is-copy is-short" />
            <div className="paper-skeleton-line is-meta" />
          </article>
        ))}
      </div>
    </section>
  )
}

function PapersPage() {
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const [searchTerm, setSearchTerm] = useState('')
  const [topic, setTopic] = useState<PaperTopic | 'all'>('all')
  const [difficulty, setDifficulty] = useState<PaperDifficulty | 'all'>('all')
  const [publicationType, setPublicationType] = useState<PaperPublicationType | 'all'>('all')
  const [sort, setSort] = useState<PaperSort>('recommended')
  const [papers, setPapers] = useState<Paper[]>([])
  const [resourceCount, setResourceCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [requestVersion, setRequestVersion] = useState(0)

  const requestedView = searchParams.get('view')
  const activeView: PaperView = isPaperView(requestedView) ? requestedView : 'all'
  const returnPath = `${location.pathname}${location.search}`

  useEffect(() => {
    window.scrollTo({ left: 0, top: 0 })
  }, [])

  useEffect(() => {
    const controller = new AbortController()

    fetchPapers({ signal: controller.signal })
      .then((payload) => {
        if (controller.signal.aborted) return
        setPapers(payload.papers)
        setResourceCount(payload.pagination.total)
        setTopic((currentTopic) => (
          currentTopic === 'all'
          || payload.papers.some((paper) => paper.topics.includes(currentTopic))
            ? currentTopic
            : 'all'
        ))
      })
      .catch((requestError: unknown) => {
        if (controller.signal.aborted) return
        console.error('Unable to load the research library.', requestError)
        setPapers([])
        setResourceCount(0)
        setError("We couldn't load the paper library right now.")
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [requestVersion])

  useEffect(() => {
    if (requestedView && !isPaperView(requestedView)) {
      const normalizedParams = new URLSearchParams(searchParams)
      normalizedParams.delete('view')
      setSearchParams(normalizedParams, { replace: true })
    }
  }, [requestedView, searchParams, setSearchParams])

  const visiblePapers = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLocaleLowerCase()

    const filteredPapers = papers.filter((paper) => {
      const matchesView = activeView === 'all'
        || activeView === 'progress'
        || (activeView === 'recommended'
          && (paper.featured || paper.resourceCategory === 'Recommended'))
        || (activeView === 'resources'
          && (paper.publicationType === 'Review'
            || paper.publicationType === 'Book Chapter'
            || paper.publicationType === 'Learning Resource'
            || paper.resourceCategory === 'Course Resource'))

      const searchableText = [
        paper.title,
        ...paper.authors,
        paper.journal ?? '',
        paper.year?.toString() ?? '',
        paper.abstract,
        ...paper.topics,
        ...paper.keywords,
        ...paper.learningObjectives,
        paper.publicationType,
        paper.resourceCategory,
      ].join(' ').toLocaleLowerCase()

      return matchesView
        && (!normalizedSearch || searchableText.includes(normalizedSearch))
        && (topic === 'all' || paper.topics.includes(topic))
        && (difficulty === 'all' || paper.difficulty === difficulty)
        && (publicationType === 'all' || paper.publicationType === publicationType)
    })

    return [...filteredPapers].sort((firstPaper, secondPaper) => {
      if (sort === 'newest') return compareYears(firstPaper.year, secondPaper.year, 'newest')
      if (sort === 'oldest') return compareYears(firstPaper.year, secondPaper.year, 'oldest')
      if (sort === 'reading-time') {
        return firstPaper.estimatedReadingMinutes - secondPaper.estimatedReadingMinutes
      }

      const scoreDifference = getRecommendationScore(secondPaper)
        - getRecommendationScore(firstPaper)
      return scoreDifference || compareYears(firstPaper.year, secondPaper.year, 'newest')
    })
  }, [activeView, difficulty, papers, publicationType, searchTerm, sort, topic])

  const availableTopics = useMemo(
    () => Array.from(new Set(papers.flatMap((paper) => paper.topics)))
      .sort((firstTopic, secondTopic) => firstTopic.localeCompare(secondTopic)),
    [papers],
  )
  const topicCount = availableTopics.length
  const difficultyLevelCount = useMemo(
    () => new Set(papers.map((paper) => paper.difficulty)).size,
    [papers],
  )

  const hasActiveFilters = Boolean(searchTerm)
    || topic !== 'all'
    || difficulty !== 'all'
    || publicationType !== 'all'

  const clearFilters = () => {
    setSearchTerm('')
    setTopic('all')
    setDifficulty('all')
    setPublicationType('all')
  }

  const retryPapers = () => {
    setLoading(true)
    setError(null)
    setPapers([])
    setResourceCount(0)
    setRequestVersion((version) => version + 1)
  }

  return (
    <div className="papers-page">
      <PageParticleBackground />
      <Navbar />

      <main className="papers-main">
        <PapersHero
          difficultyLevelCount={difficultyLevelCount}
          loading={loading}
          papers={papers}
          resourceCount={resourceCount}
          topicCount={topicCount}
        />

        <PapersTabs activeView={activeView} />

        {loading ? (
          <PapersLoadingState />
        ) : error ? (
          <section className="papers-empty-state papers-error-state" role="alert">
            <span>Research Library Unavailable</span>
            <h2>Research Library Unavailable</h2>
            <p>{error}</p>
            <button onClick={retryPapers} type="button">
              Try Again
            </button>
          </section>
        ) : activeView === 'progress' ? (
          <ReadingProgressPanel />
        ) : papers.length === 0 ? (
          <section className="papers-empty-state">
            <span>Research Library</span>
            <h2>No published resources yet</h2>
            <p>New learning resources will appear here once they are published.</p>
          </section>
        ) : (
          <>
            <PaperFilters
              availableTopics={availableTopics}
              difficulty={difficulty}
              hasActiveFilters={hasActiveFilters}
              onClear={clearFilters}
              onDifficultyChange={setDifficulty}
              onPublicationTypeChange={setPublicationType}
              onSearchChange={setSearchTerm}
              onSortChange={setSort}
              onTopicChange={setTopic}
              publicationType={publicationType}
              resultCount={visiblePapers.length}
              searchTerm={searchTerm}
              sort={sort}
              topic={topic}
            />

            {visiblePapers.length > 0 ? (
              <section aria-label="Paper results" className="paper-card-grid">
                {visiblePapers.map((paper) => (
                  <PaperCard key={paper.id} paper={paper} returnPath={returnPath} />
                ))}
              </section>
            ) : (
              <section className="papers-empty-state">
                <span>No matching resources</span>
                <h2>Try a broader search</h2>
                <p>Adjust your search terms or clear one or more library filters.</p>
                <button onClick={clearFilters} type="button">Clear Filters</button>
              </section>
            )}
          </>
        )}

        <p className="papers-library-boundary">
          This library is a curated learning resource. Publication management and learner
          submissions are not available in this preview.
        </p>
      </main>

      <Footer />
    </div>
  )
}

export default PapersPage
