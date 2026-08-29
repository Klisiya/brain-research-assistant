import { Link } from 'react-router-dom'
import type { ManagedPaper } from '../../types/paper'
import PaperStatusBadge from './PaperStatusBadge'

function formatUpdatedAt(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unavailable'

  return new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date)
}

function PaperActions({ paper }: { paper: ManagedPaper }) {
  return (
    <div className="management-row-actions">
      <Link to={`/manage/papers/${paper.id}/edit`}>Edit</Link>
      {paper.status === 'published' ? (
        <Link to={`/papers/${paper.slug}`}>Preview</Link>
      ) : null}
    </div>
  )
}

function PaperManagementTable({ papers }: { papers: readonly ManagedPaper[] }) {
  return (
    <>
      <div className="paper-management-table-shell">
        <table className="paper-management-table">
          <thead>
            <tr>
              <th scope="col">Title</th>
              <th scope="col">Status</th>
              <th scope="col">Type</th>
              <th scope="col">Updated</th>
              <th scope="col">Created by</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {papers.map((paper) => (
              <tr key={paper.id}>
                <td>
                  <strong>{paper.title}</strong>
                  <span>{paper.slug}</span>
                </td>
                <td><PaperStatusBadge status={paper.status} /></td>
                <td>{paper.publicationType}</td>
                <td>{formatUpdatedAt(paper.updatedAt)}</td>
                <td>{paper.createdBy?.username || 'System'}</td>
                <td><PaperActions paper={paper} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="paper-management-cards" aria-label="Managed papers">
        {papers.map((paper) => (
          <article className="paper-management-card" key={paper.id}>
            <div>
              <PaperStatusBadge status={paper.status} />
              <span>{paper.publicationType}</span>
            </div>
            <h2>{paper.title}</h2>
            <dl>
              <div><dt>Updated</dt><dd>{formatUpdatedAt(paper.updatedAt)}</dd></div>
              <div><dt>Created by</dt><dd>{paper.createdBy?.username || 'System'}</dd></div>
            </dl>
            <PaperActions paper={paper} />
          </article>
        ))}
      </div>
    </>
  )
}

export default PaperManagementTable
