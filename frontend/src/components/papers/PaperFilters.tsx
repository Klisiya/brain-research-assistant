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
  availableTopics: readonly string[]
  difficulty: PaperDifficulty | 'all'
  hasActiveFilters: boolean
  onClear: () => void
  onDifficultyChange: (difficulty: PaperDifficulty | 'all') => void
  onPublicationTypeChange: (publicationType: PaperPublicationType | 'all') => void
  onSearchChange: (searchTerm: string) => void
  onSortChange: (sort: PaperSort) => void
  onTopicChange: (topic: PaperTopic | 'all') => void
  publicationType: PaperPublicationType | 'all'
  resultCount: number
  searchTerm: string
  sort: PaperSort
  topic: PaperTopic | 'all'
}

function PaperFilters({
  availableTopics,
  difficulty,
  hasActiveFilters,
  onClear,
  onDifficultyChange,
  onPublicationTypeChange,
  onSearchChange,
  onSortChange,
  onTopicChange,
  publicationType,
  resultCount,
  searchTerm,
  sort,
  topic,
}: PaperFiltersProps) {
  return (
    <section aria-label="Paper search and filters" className="paper-filters">
      <div className="paper-filter-grid">
        <label className="paper-search-field">
          <span>Search library</span>
          <input
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search papers, authors, topics, or keywords..."
            type="search"
            value={searchTerm}
          />
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
