import type { CSSProperties } from 'react'
import type { Paper } from '../../types/paper'

type PaperMarqueeWallProps = {
  loading?: boolean
  papers: readonly Paper[]
}

const COLUMN_DURATIONS = ['38s', '44s', '40s', '48s'] as const
const MINIMUM_VISUAL_ITEMS = 8

function buildMarqueeItems(
  papers: readonly Paper[],
  minimumItems = MINIMUM_VISUAL_ITEMS,
) {
  if (papers.length === 0) return []
  if (papers.length >= 6) return [...papers]

  return Array.from(
    { length: minimumItems },
    (_, index) => papers[index % papers.length],
  )
}

function rotateItems(items: readonly Paper[], offset: number) {
  if (items.length === 0) return []
  const normalizedOffset = offset % items.length
  return [...items.slice(normalizedOffset), ...items.slice(0, normalizedOffset)]
}

function PaperMarqueeCard({ paper }: { paper: Paper }) {
  const primaryAuthor = paper.authors[0] || 'Author unavailable'
  const additionalAuthorCount = paper.authors.length - 1
  const author = additionalAuthorCount > 0
    ? `${primaryAuthor} +${additionalAuthorCount}`
    : primaryAuthor
  const publicationDetails = [paper.year?.toString(), paper.difficulty]
    .filter(Boolean)
    .join(' · ')

  return (
    <article className="paper-marquee-card">
      <span className="paper-marquee-type">{paper.publicationType}</span>
      <h2>{paper.title}</h2>
      <p className="paper-marquee-author">{author}</p>
      {paper.journal?.trim() && (
        <p className="paper-marquee-journal">{paper.journal}</p>
      )}
      <div className="paper-marquee-meta">
        <span>{publicationDetails}</span>
        {paper.topics[0] && <span className="paper-marquee-topic">{paper.topics[0]}</span>}
      </div>
    </article>
  )
}

function PaperMarqueePlaceholder() {
  return (
    <div className="paper-marquee-card is-placeholder">
      <span className="paper-marquee-placeholder-block is-badge" />
      <span className="paper-marquee-placeholder-block is-title" />
      <span className="paper-marquee-placeholder-block is-line" />
      <span className="paper-marquee-placeholder-block is-line is-short" />
      <span className="paper-marquee-placeholder-block is-meta" />
    </div>
  )
}

function PaperMarqueeColumn({
  columnIndex,
  papers,
  showPlaceholders,
}: {
  columnIndex: number
  papers: readonly Paper[]
  showPlaceholders: boolean
}) {
  const columnPapers = rotateItems(papers, columnIndex)
  const direction = columnIndex % 2 === 0 ? 'is-down' : 'is-up'
  const style = {
    '--paper-marquee-duration': COLUMN_DURATIONS[columnIndex],
  } as CSSProperties

  return (
    <div className={`paper-marquee-column ${direction}`} style={style}>
      <div className="paper-marquee-track">
        {[0, 1].map((sequenceIndex) => (
          <div aria-hidden="true" className="paper-marquee-sequence" key={sequenceIndex}>
            {showPlaceholders
              ? Array.from({ length: MINIMUM_VISUAL_ITEMS }, (_, itemIndex) => (
                <PaperMarqueePlaceholder key={`${sequenceIndex}-${itemIndex}`} />
              ))
              : columnPapers.map((paper, itemIndex) => (
                <PaperMarqueeCard
                  key={`${sequenceIndex}-${itemIndex}-${paper.id}`}
                  paper={paper}
                />
              ))}
          </div>
        ))}
      </div>
    </div>
  )
}

function PaperMarqueeWall({ loading = false, papers }: PaperMarqueeWallProps) {
  const visualPapers = buildMarqueeItems(papers)
  const showPlaceholders = loading || visualPapers.length === 0

  return (
    <div aria-hidden="true" className="paper-marquee-perspective">
      <div className="paper-marquee-wall">
        {COLUMN_DURATIONS.map((_, columnIndex) => (
          <PaperMarqueeColumn
            columnIndex={columnIndex}
            key={columnIndex}
            papers={visualPapers}
            showPlaceholders={showPlaceholders}
          />
        ))}
      </div>
    </div>
  )
}

export default PaperMarqueeWall
