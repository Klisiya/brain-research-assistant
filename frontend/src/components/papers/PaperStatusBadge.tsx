import type { PaperStatus } from '../../types/paper'

const STATUS_LABELS: Record<PaperStatus, string> = {
  archived: 'Archived',
  draft: 'Draft',
  published: 'Published',
}

function PaperStatusBadge({ status }: { status: PaperStatus }) {
  return (
    <span className={`paper-status-badge is-${status}`}>
      {STATUS_LABELS[status]}
    </span>
  )
}

export default PaperStatusBadge
