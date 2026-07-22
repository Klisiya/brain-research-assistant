import { Link } from 'react-router-dom'
import { PAPER_READING_STATUSES } from '../../data/papers'
import type { Paper } from '../../types/paper'

type ReadingProgressPanelProps = {
  papers: Paper[]
  returnPath: string
}

function ReadingProgressPanel({ papers, returnPath }: ReadingProgressPanelProps) {
  return (
    <section aria-labelledby="reading-progress-title" className="reading-progress-panel">
      <div className="reading-progress-heading">
        <div>
          <span>Demo · Local Preview</span>
          <h2 id="reading-progress-title">Reading Progress</h2>
        </div>
        <p>
          Progress is illustrative front-end data and is not connected to a learner account.
        </p>
      </div>

      <div className="reading-progress-grid">
        {PAPER_READING_STATUSES.map((status) => {
          const statusPapers = papers.filter((paper) => paper.readingStatus === status)

          return (
            <section className="reading-progress-column" key={status}>
              <div className="reading-progress-column-title">
                <h3>{status}</h3>
                <span>{statusPapers.length}</span>
              </div>
              {statusPapers.length > 0 ? (
                <ul>
                  {statusPapers.map((paper) => (
                    <li key={paper.id}>
                      <Link state={{ from: returnPath }} to={`/papers/${paper.slug}`}>
                        <strong>{paper.title}</strong>
                        <span>{paper.estimatedReadingMinutes} min · {paper.difficulty}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="reading-progress-empty">No papers in this group.</p>
              )}
            </section>
          )
        })}
      </div>
    </section>
  )
}

export default ReadingProgressPanel
