import { Link } from 'react-router-dom'
import { PAPER_VIEW_OPTIONS } from '../../data/papers'
import type { PaperView } from '../../types/paper'

type PapersTabsProps = {
  activeView: PaperView
}

function getPaperViewPath(view: PaperView) {
  return view === 'all' ? '/papers' : `/papers?view=${view}`
}

function PapersTabs({ activeView }: PapersTabsProps) {
  return (
    <nav aria-label="Paper Library views" className="papers-tabs">
      {PAPER_VIEW_OPTIONS.map((option) => (
        <Link
          aria-current={activeView === option.value ? 'page' : undefined}
          className={activeView === option.value ? 'is-active' : undefined}
          key={option.value}
          to={getPaperViewPath(option.value)}
        >
          {option.label}
        </Link>
      ))}
    </nav>
  )
}

export default PapersTabs
