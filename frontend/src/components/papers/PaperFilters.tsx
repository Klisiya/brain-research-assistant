import { useEffect, useState } from 'react'
import {
  PAPER_DIFFICULTIES,
  PAPER_PUBLICATION_TYPES,
  PAPER_SORT_OPTIONS,
} from '../../data/papers'
import type {
  PaperDifficulty,
  PaperPublicationType,
  PaperSort,
  PaperTopic,
} from '../../types/paper'

type PaperFiltersProps = {
  author: string
  availableAuthors: readonly string[]
  availableTopics: readonly string[]
  availableYears: readonly number[]
  difficulty: PaperDifficulty | 'all'
  hasActiveFilters: boolean
  onClear: () => void
  onAuthorChange: (author: string) => void
  onDifficultyChange: (difficulty: PaperDifficulty | 'all') => void
  onPublicationTypeChange: (publicationType: PaperPublicationType | 'all') => void
  onSearchChange: (searchTerm: string) => void
  onSortChange: (sort: PaperSort) => void
  onTopicChange: (topic: PaperTopic | 'all') => void
  onYearChange: (year: number | null) => void
  publicationType: PaperPublicationType | 'all'
  resultCount: number
  initialSearchTerm: string
  sort: PaperSort
  topic: PaperTopic | 'all'
  year: number | null
}

function PaperFilters({
  author,
  availableAuthors,
  availableTopics,
  availableYears,
  difficulty,
  hasActiveFilters,
  onClear,
  onAuthorChange,
  onDifficultyChange,
  onPublicationTypeChange,
  onSearchChange,
  onSortChange,
  onTopicChange,
  onYearChange,
  publicationType,
  resultCount,
  initialSearchTerm,
  sort,
  topic,
  year,
}: PaperFiltersProps) {
  const [searchTerm, setSearchTerm] = useState(initialSearchTerm)

  useEffect(() => {
    const normalizedSearch = searchTerm.trim()
    if (normalizedSearch === initialSearchTerm) return undefined
    const timeoutId = window.setTimeout(() => onSearchChange(normalizedSearch), 400)
    return () => window.clearTimeout(timeoutId)
  }, [initialSearchTerm, onSearchChange, searchTerm])

  return (
    <section aria-label="Paper search and filters" className="paper-filters">
      <div className="paper-filter-grid">
        <label className="paper-search-field">
          <span>Search library</span>
          <input
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Search papers, authors, topics, or keywords..."
            type="search"
            value={searchTerm}
          />
        </label>

        <label>
          <span>Author</span>
          <select onChange={(event) => onAuthorChange(event.target.value)} value={author}>
            <option value="">All Authors</option>
            {availableAuthors.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </label>

        <label>
          <span>Year</span>
          <select
            onChange={(event) => onYearChange(event.target.value ? Number(event.target.value) : null)}
            value={year ?? ''}
          >
            <option value="">All Years</option>
            {availableYears.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </label>

        <label>
          <span>Topic</span>
          <select
            onChange={(event) => onTopicChange(event.target.value as PaperTopic | 'all')}
            value={topic}
          >
            <option value="all">All Topics</option>
            {availableTopics.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </label>

        <label>
          <span>Difficulty</span>
          <select
            onChange={(event) => onDifficultyChange(event.target.value as PaperDifficulty | 'all')}
            value={difficulty}
          >
            <option value="all">All Levels</option>
            {PAPER_DIFFICULTIES.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </label>

        <label>
          <span>Type</span>
          <select
            onChange={(event) => onPublicationTypeChange(
              event.target.value as PaperPublicationType | 'all',
            )}
            value={publicationType}
          >
            <option value="all">All Types</option>
            {PAPER_PUBLICATION_TYPES.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </label>

        <label>
          <span>Sort</span>
          <select
            onChange={(event) => onSortChange(event.target.value as PaperSort)}
            value={sort}
          >
            {PAPER_SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="paper-filter-summary" aria-live="polite">
        <span>{resultCount} {resultCount === 1 ? 'result' : 'results'}</span>
        <button disabled={!hasActiveFilters} onClick={onClear} type="button">
          Clear Filters
        </button>
      </div>
    </section>
  )
}

export default PaperFilters
