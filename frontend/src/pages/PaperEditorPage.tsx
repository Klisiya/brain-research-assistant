import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  archivePaper,
  createPaper,
  deletePaper,
  fetchManagedPaper,
  PaperApiError,
  updatePaper,
} from '../api/papers'
import ConfirmDialog from '../components/papers/ConfirmDialog'
import PaperForm from '../components/papers/PaperForm'
import PaperStatusBadge from '../components/papers/PaperStatusBadge'
import type { AuthUser } from '../types/auth'
import type { ManagedPaper, PaperWriteInput } from '../types/paper'
import './PaperEditorPage.css'

type EditorLoadError = 'forbidden' | 'not-found' | 'session' | 'unavailable'

type EditorResult = {
  error: EditorLoadError | null
  paper: ManagedPaper | null
  requestId: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function getRouteNotice(value: unknown) {
  return isRecord(value) && typeof value.notice === 'string' ? value.notice : null
}

function PaperEditorLoading() {
  return (
    <section aria-busy="true" aria-label="Loading paper editor" className="paper-editor-loading">
      <div aria-hidden="true" className="paper-editor-skeleton">
        <span />
        <span />
        <span />
        <span />
      </div>
    </section>
  )
}

function PaperEditorPage({ currentUser }: { currentUser: AuthUser }) {
  const { id } = useParams<{ id: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const isCreateMode = !id
  const paperId = id ? Number(id) : null
  const isValidPaperId = paperId !== null && Number.isInteger(paperId) && paperId > 0
  const [requestVersion, setRequestVersion] = useState(0)
  const requestId = `${id ?? 'new'}:${requestVersion}`
  const [result, setResult] = useState<EditorResult | null>(null)
  const currentResult = result?.requestId === requestId ? result : null
  const [notice, setNotice] = useState<string | null>(() => getRouteNotice(location.state))
  const [actionError, setActionError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<'archive' | 'delete' | null>(null)
  const [isActionPending, setIsActionPending] = useState(false)

  useEffect(() => {
    if (isCreateMode || !isValidPaperId || paperId === null) return undefined

    const controller = new AbortController()

    fetchManagedPaper(paperId, { signal: controller.signal })
      .then((paper) => {
        if (!controller.signal.aborted) setResult({ error: null, paper, requestId })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        if (error instanceof DOMException && error.name === 'AbortError') return

        const errorType: EditorLoadError = error instanceof PaperApiError && error.status === 401
          ? 'session'
          : error instanceof PaperApiError && error.status === 403
            ? 'forbidden'
            : error instanceof PaperApiError && error.status === 404
              ? 'not-found'
              : 'unavailable'
        console.error('Unable to load the managed paper.', error)
        setResult({ error: errorType, paper: null, requestId })
      })

    return () => controller.abort()
  }, [isCreateMode, isValidPaperId, paperId, requestId])

  const paper = isCreateMode ? null : currentResult?.paper ?? null
  const loadError: EditorLoadError | null = !isCreateMode && !isValidPaperId
    ? 'not-found'
    : currentResult?.error ?? null
  const loading = !isCreateMode && isValidPaperId && !currentResult

  const handleSave = async (input: PaperWriteInput) => {
    setActionError(null)
    setNotice(null)

    if (isCreateMode) {
      const savedPaper = await createPaper(input)
      const message = input.status === 'published'
        ? 'Paper published successfully.'
        : 'Draft saved.'
      setNotice(message)
      navigate(`/manage/papers/${savedPaper.id}/edit`, {
        replace: true,
        state: { notice: message },
      })
      return savedPaper
    }

    if (!paperId) throw new Error('Paper id is unavailable')
    const savedPaper = await updatePaper(paperId, input)
    setResult({ error: null, paper: savedPaper, requestId })
    setNotice(input.status === 'published' && paper?.status !== 'published'
      ? 'Paper published successfully.'
      : 'Changes saved.')
    return savedPaper
  }

  const handleArchive = async () => {
    if (!paper || isActionPending) return
    setIsActionPending(true)
    setActionError(null)

    try {
      const archivedPaper = await archivePaper(paper.id)
      setResult({ error: null, paper: archivedPaper, requestId })
      setNotice('Paper archived successfully.')
      setDialog(null)
    } catch (error) {
      setActionError(error instanceof PaperApiError && error.status === 403
        ? 'You do not have permission to archive this paper.'
        : 'The paper could not be archived right now.')
    } finally {
      setIsActionPending(false)
    }
  }

  const handleDelete = async () => {
    if (!paper || currentUser.role !== 'admin' || isActionPending) return
    setIsActionPending(true)
    setActionError(null)

    try {
      await deletePaper(paper.id)
      navigate('/manage/papers', { replace: true })
    } catch (error) {
      setActionError(error instanceof PaperApiError && error.status === 403
        ? 'Only administrators can permanently delete papers.'
        : 'The paper could not be deleted right now.')
      setIsActionPending(false)
      setDialog(null)
    }
  }

  if (loading) return <PaperEditorLoading />

  if (loadError) {
    const heading = loadError === 'not-found'
      ? 'Paper Not Found'
      : loadError === 'forbidden'
        ? 'Access Denied'
        : loadError === 'session'
          ? 'Sign In Required'
          : 'Research Management Unavailable'
    const message = loadError === 'not-found'
      ? 'The requested paper does not exist.'
      : loadError === 'forbidden'
        ? 'You do not have permission to edit this paper.'
        : loadError === 'session'
          ? 'Your session has expired. Please sign in again.'
          : "We couldn't load this paper editor right now."

    return (
      <section aria-live="polite" className="management-state-panel">
        <span>Management</span>
        <h1>{heading}</h1>
        <p>{message}</p>
        {loadError === 'unavailable' ? (
          <button onClick={() => setRequestVersion((value) => value + 1)} type="button">Try Again</button>
        ) : loadError === 'session' ? (
          <Link state={{ from: location.pathname, managementRequired: true }} to="/login">Sign In</Link>
        ) : (
          <Link to="/manage/papers">Back to Papers Management</Link>
        )}
      </section>
    )
  }

  return (
    <>
      <header className="paper-editor-header">
        <div>
          <span>Management · Research Library</span>
          <h1>{isCreateMode ? 'Create Paper' : 'Edit Paper'}</h1>
          <p>
            {isCreateMode
              ? 'Create a structured learning resource for the public research library.'
              : 'Update metadata, learning content, and publication settings.'}
          </p>
        </div>
        {paper ? (
          <div className="paper-editor-identity">
            <PaperStatusBadge status={paper.status} />
            <span>Current slug</span>
            <code>{paper.slug}</code>
            {paper.status === 'published' ? <Link to={`/papers/${paper.slug}`}>Preview</Link> : null}
          </div>
        ) : null}
      </header>

      {notice ? <p aria-live="polite" className="paper-editor-notice">{notice}</p> : null}
      {actionError ? <p className="paper-form-summary-error" role="alert">{actionError}</p> : null}

      <PaperForm
        initialPaper={paper ?? undefined}
        key={paper ? `${paper.id}:${paper.status}` : 'new-paper'}
        mode={isCreateMode ? 'create' : 'edit'}
        onSubmit={handleSave}
      />

      {paper ? (
        <section className="paper-editor-resource-actions">
          <div>
            <span>Resource Actions</span>
            <h2>Publication Controls</h2>
            <p>These actions affect whether the resource is available in the public library.</p>
          </div>
          <div>
            {paper.status === 'published' ? (
              <button onClick={() => setDialog('archive')} type="button">Archive</button>
            ) : null}
            {currentUser.role === 'admin' ? (
              <button className="is-danger" onClick={() => setDialog('delete')} type="button">
                Delete Permanently
              </button>
            ) : null}
          </div>
        </section>
      ) : null}

      {dialog === 'archive' ? (
        <ConfirmDialog
          busy={isActionPending}
          confirmLabel="Archive Paper"
          description="Archived papers will no longer appear in the public research library."
          onCancel={() => setDialog(null)}
          onConfirm={() => void handleArchive()}
          title="Archive this paper?"
        />
      ) : null}

      {dialog === 'delete' && currentUser.role === 'admin' ? (
        <ConfirmDialog
          busy={isActionPending}
          confirmationText="DELETE"
          confirmLabel="Delete Permanently"
          description="This action cannot be undone."
          onCancel={() => setDialog(null)}
          onConfirm={() => void handleDelete()}
          title="Delete this paper permanently?"
          tone="danger"
        />
      ) : null}
    </>
  )
}

export default PaperEditorPage
