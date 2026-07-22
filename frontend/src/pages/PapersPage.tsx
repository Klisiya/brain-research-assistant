import { useEffect, useMemo, useState } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import Footer from '../components/Footer'
import Navbar from '../components/Navbar'
import PageParticleBackground from '../components/PageParticleBackground'
import PaperCard from '../components/papers/PaperCard'
import PaperFilters from '../components/papers/PaperFilters'
import PapersHero from '../components/papers/PapersHero'
import PapersTabs from '../components/papers/PapersTabs'
import ReadingProgressPanel from '../components/papers/ReadingProgressPanel'
import { papers } from '../data/papers'
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

function PapersPage() {
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const [searchTerm, setSearchTerm] = useState('')
  const [topic, setTopic] = useState<PaperTopic | 'all'>('all')
  const [difficulty, setDifficulty] = useState<PaperDifficulty | 'all'>('all')
  const [publicationType, setPublicationType] = useState<PaperPublicationType | 'all'>('all')
  const [sort, setSort] = useState<PaperSort>('recommended')

  const requestedView = searchParams.get('view')
  const activeView: PaperView = isPaperView(requestedView) ? requestedView : 'all'
  const returnPath = `${location.pathname}${location.search}`

  useEffect(() => {
    window.scrollTo({ left: 0, top: 0 })
  }, [])

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
        paper.journal,
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
      if (sort === 'newest') return secondPaper.year - firstPaper.year
      if (sort === 'oldest') return firstPaper.year - secondPaper.year
      if (sort === 'reading-time') {
        return firstPaper.estimatedReadingMinutes - secondPaper.estimatedReadingMinutes
      }

      const scoreDifference = getRecommendationScore(secondPaper)
        - getRecommendationScore(firstPaper)
      return scoreDifference || secondPaper.year - firstPaper.year
    })
  }, [activeView, difficulty, publicationType, searchTerm, sort, topic])

  const topicCount = useMemo(
    () => new Set(papers.flatMap((paper) => paper.topics)).size,
    [],
  )
  const difficultyLevelCount = useMemo(
    () => new Set(papers.map((paper) => paper.difficulty)).size,
    [],
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

  return (
    <div className="papers-page">
      <PageParticleBackground />
      <Navbar />

      <main className="papers-main">
        <PapersHero
          difficultyLevelCount={difficultyLevelCount}
          resourceCount={papers.length}
          topicCount={topicCount}
        />

        <PapersTabs activeView={activeView} />

        <PaperFilters
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

        {activeView === 'progress' ? (
          <ReadingProgressPanel papers={visiblePapers} returnPath={returnPath} />
        ) : visiblePapers.length > 0 ? (
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
