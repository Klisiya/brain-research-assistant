import { Link } from 'react-router-dom'
import { PAPER_VIEW_OPTIONS } from '../../data/papers'
import type { PaperView } from '../../types/paper'

type PapersTabsProps = {
  activeView: PaperView
  searchParams: URLSearchParams
}

function getPaperViewPath(view: PaperView, currentParams: URLSearchParams) {
  const nextParams = new URLSearchParams(currentParams)
  nextParams.set('page', '1')
  if (view === 'all') nextParams.delete('view')
  else nextParams.set('view', view)
  const query = nextParams.toString()
  return query ? `/papers?${query}` : '/papers'
}

function PapersTabs({ activeView, searchParams }: PapersTabsProps) {
  return (
    <nav aria-label="Paper Library views" className="papers-tabs">
      {PAPER_VIEW_OPTIONS.map((option) => (
        <Link
          aria-current={activeView === option.value ? 'page' : undefined}
          className={activeView === option.value ? 'is-active' : undefined}
          key={option.value}
          to={getPaperViewPath(option.value, searchParams)}
        >
          {option.label}
        </Link>
      ))}
    </nav>
  )
}

export default PapersTabs
