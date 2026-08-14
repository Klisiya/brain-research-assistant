import { Link } from 'react-router-dom'
import type { Paper } from '../../types/paper'

type PaperCardProps = {
  paper: Paper
  returnPath: string
}

function PaperCard({ paper, returnPath }: PaperCardProps) {
  const visibleTopics = paper.topics.slice(0, 3)
  const remainingTopicCount = paper.topics.length - visibleTopics.length
  const isRecommended = paper.featured || paper.resourceCategory === 'Recommended'
  const publicationDetails = [paper.journal?.trim(), paper.year?.toString()]
    .filter(Boolean)
    .join(' · ') || 'Publication details unavailable'

  return (
    <article className="paper-card">
      <div className="paper-card-badges" aria-label="Paper classification">
        <span>{paper.publicationType}</span>
        <span>{paper.difficulty}</span>
        {isRecommended && <span className="is-highlighted">Recommended</span>}
      </div>

      <div className="paper-card-heading">
        <h2>{paper.title}</h2>
        <p>{paper.authors.join(', ')}</p>
        <span>{publicationDetails}</span>
      </div>

      <p className="paper-card-abstract">{paper.abstract}</p>

      <div className="paper-topic-list" aria-label="Topics">
        {visibleTopics.map((topic) => <span key={topic}>{topic}</span>)}
        {remainingTopicCount > 0 && <span>+{remainingTopicCount} more</span>}
      </div>

      <dl className="paper-card-meta">
        <div>
          <dt>Reading time</dt>
          <dd>{paper.estimatedReadingMinutes} min</dd>
        </div>
        <div>
          <dt>Access</dt>
          <dd>{paper.openAccess ? 'Open Access' : 'Guided Access'}</dd>
        </div>
        <div>
          <dt>Resource</dt>
          <dd>{paper.resourceCategory}</dd>
        </div>
      </dl>

      <Link
        className="paper-card-link"
        state={{ from: returnPath }}
        to={`/papers/${paper.slug}`}
      >
        View Paper <span aria-hidden="true">→</span>
      </Link>
    </article>
  )
}

export default PaperCard
