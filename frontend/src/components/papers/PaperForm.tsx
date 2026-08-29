import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { PaperApiError } from '../../api/papers'
import type {
  ManagedPaper,
  PaperDifficulty,
  PaperPublicationType,
  PaperResourceCategory,
  PaperStatus,
  PaperWriteInput,
} from '../../types/paper'
import ConfirmDialog from './ConfirmDialog'

type PaperFormMode = 'create' | 'edit'

type PaperFormValues = {
  abstract: string
  authors: string
  difficulty: PaperDifficulty
  estimatedReadingMinutes: string
  externalUrl: string
  featured: boolean
  journal: string
  keywords: string
  learningObjectives: string
  openAccess: boolean
  publicationType: PaperPublicationType
  resourceCategory: PaperResourceCategory
  title: string
  topics: string
  year: string
}

type PaperFormField = keyof PaperFormValues
type PaperFormErrors = Partial<Record<PaperFormField, string>>

type PaperFormProps = {
  initialPaper?: ManagedPaper
  mode: PaperFormMode
  onSubmit: (input: PaperWriteInput) => Promise<ManagedPaper>
}

const PUBLICATION_TYPES: readonly PaperPublicationType[] = [
  'Research Article',
  'Review',
  'Book Chapter',
  'Learning Resource',
]

const DIFFICULTIES: readonly PaperDifficulty[] = [
  'Beginner',
  'Intermediate',
  'Advanced',
]

const RESOURCE_CATEGORIES: readonly PaperResourceCategory[] = [
  'Foundational',
  'Recommended',
  'Course Resource',
  'Emerging Research',
]

const FORM_FIELDS: readonly PaperFormField[] = [
  'abstract',
  'authors',
  'difficulty',
  'estimatedReadingMinutes',
  'externalUrl',
  'featured',
  'journal',
  'keywords',
  'learningObjectives',
  'openAccess',
  'publicationType',
  'resourceCategory',
  'title',
  'topics',
  'year',
]

function getInitialValues(paper?: ManagedPaper): PaperFormValues {
  return {
    abstract: paper?.abstract ?? '',
    authors: paper?.authors.join('\n') ?? '',
    difficulty: paper?.difficulty ?? 'Beginner',
    estimatedReadingMinutes: paper ? String(paper.estimatedReadingMinutes) : '15',
    externalUrl: paper?.externalUrl ?? '',
    featured: paper?.featured ?? false,
    journal: paper?.journal ?? '',
    keywords: paper?.keywords.join(', ') ?? '',
    learningObjectives: paper?.learningObjectives.join('\n') ?? '',
    openAccess: paper?.openAccess ?? false,
    publicationType: paper?.publicationType ?? 'Learning Resource',
    resourceCategory: paper?.resourceCategory ?? 'Foundational',
    title: paper?.title ?? '',
    topics: paper?.topics.join(', ') ?? '',
    year: paper?.year ? String(paper.year) : '',
  }
}

function deduplicate(values: readonly string[]) {
  const seen = new Set<string>()
  return values.filter((value) => {
    const key = value.toLocaleLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function parseLines(value: string) {
  return deduplicate(value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean))
}

function parseCommaSeparated(value: string) {
  return deduplicate(value.split(',').map((item) => item.trim()).filter(Boolean))
}

function validateForm(values: PaperFormValues, status: PaperStatus) {
  const errors: PaperFormErrors = {}
  const title = values.title.trim()
  const authors = parseLines(values.authors)
  const topics = parseCommaSeparated(values.topics)
  const learningObjectives = parseLines(values.learningObjectives)
  const keywords = parseCommaSeparated(values.keywords)
  const journal = values.journal.trim()
  const abstract = values.abstract.trim()
  const externalUrl = values.externalUrl.trim()
  const year = values.year.trim() ? Number(values.year) : null
  const estimatedReadingMinutes = Number(values.estimatedReadingMinutes)
  const maximumYear = new Date().getFullYear() + 1

  if (!title) errors.title = 'Title is required.'
  else if (title.length > 500) errors.title = 'Title must be at most 500 characters.'

  if (authors.length === 0) errors.authors = 'Add at least one author.'
  else if (authors.some((author) => author.length > 300)) {
    errors.authors = 'Each author must be at most 300 characters.'
  }

  if (year !== null && (!Number.isInteger(year) || year < 1800 || year > maximumYear)) {
    errors.year = `Year must be between 1800 and ${maximumYear}.`
  }

  if (journal.length > 300) errors.journal = 'Journal must be at most 300 characters.'

  if (topics.length === 0) errors.topics = 'Add at least one topic.'
  else if (topics.some((topic) => topic.length > 100)) {
    errors.topics = 'Each topic must be at most 100 characters.'
  }

  if (
    !Number.isInteger(estimatedReadingMinutes)
    || estimatedReadingMinutes < 1
    || estimatedReadingMinutes > 600
  ) {
    errors.estimatedReadingMinutes = 'Reading time must be an integer from 1 to 600.'
  }

  if (!abstract) errors.abstract = 'Abstract is required.'
  else if (abstract.length > 20000) errors.abstract = 'Abstract must be at most 20,000 characters.'

  if (learningObjectives.length === 0) {
    errors.learningObjectives = 'Add at least one learning objective.'
  } else if (learningObjectives.some((objective) => objective.length > 1000)) {
    errors.learningObjectives = 'Each objective must be at most 1,000 characters.'
  }

  if (keywords.some((keyword) => keyword.length > 100)) {
    errors.keywords = 'Each keyword must be at most 100 characters.'
  }

  if (externalUrl.length > 1000) {
    errors.externalUrl = 'External URL must be at most 1,000 characters.'
  } else if (externalUrl) {
    try {
      const parsedUrl = new URL(externalUrl)
      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        errors.externalUrl = 'External URL must use http or https.'
      }
    } catch {
      errors.externalUrl = 'Enter a valid http or https URL.'
    }
  }

  const input: PaperWriteInput = {
    abstract,
    authors,
    difficulty: values.difficulty,
    estimatedReadingMinutes,
    externalUrl: externalUrl || null,
    featured: values.featured,
    journal: journal || null,
    keywords,
    learningObjectives,
    openAccess: values.openAccess,
    publicationType: values.publicationType,
    resourceCategory: values.resourceCategory,
    status,
    title,
    topics,
    year,
  }

  return { errors, input: Object.keys(errors).length === 0 ? input : null }
}

function FieldError({ field, message }: { field: PaperFormField; message?: string }) {
  return message ? <span className="paper-form-error" id={`paper-${field}-error`}>{message}</span> : null
}

function PaperForm({ initialPaper, mode, onSubmit }: PaperFormProps) {
  const navigate = useNavigate()
  const initialValues = getInitialValues(initialPaper)
  const [values, setValues] = useState<PaperFormValues>(initialValues)
  const [baseline, setBaseline] = useState(() => JSON.stringify(initialValues))
  const [fieldErrors, setFieldErrors] = useState<PaperFormErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submittingAction, setSubmittingAction] = useState<PaperStatus | null>(null)
  const [showDiscardDialog, setShowDiscardDialog] = useState(false)
  const isDirty = JSON.stringify(values) !== baseline
  const currentStatus = initialPaper?.status ?? 'draft'
  const isSubmitting = submittingAction !== null

  const updateValue = <Field extends PaperFormField>(
    field: Field,
    value: PaperFormValues[Field],
  ) => {
    setValues((current) => ({ ...current, [field]: value }))
    setFieldErrors((current) => ({ ...current, [field]: undefined }))
    setFormError(null)
  }

  const submitWithStatus = async (status: PaperStatus) => {
    if (isSubmitting) return

    const validation = validateForm(values, status)
    setFieldErrors(validation.errors)
    setFormError(null)

    if (!validation.input) {
      setFormError('Please review the highlighted fields.')
      const firstField = FORM_FIELDS.find((field) => validation.errors[field])
      if (firstField) {
        window.requestAnimationFrame(() => document.getElementById(`paper-${firstField}`)?.focus())
      }
      return
    }

    setSubmittingAction(status)

    try {
      const savedPaper = await onSubmit(validation.input)
      const savedValues = getInitialValues(savedPaper)
      setValues(savedValues)
      setBaseline(JSON.stringify(savedValues))
      setFieldErrors({})
    } catch (error) {
      if (error instanceof PaperApiError) {
        if (error.code === 'VALIDATION_ERROR' && error.field && FORM_FIELDS.includes(error.field as PaperFormField)) {
          setFieldErrors({ [error.field]: error.message } as PaperFormErrors)
          setFormError('Please review the highlighted fields.')
        } else if (error.status === 401) {
          setFormError('Your session has expired. Please sign in again.')
        } else if (error.status === 403) {
          setFormError('You do not have permission to update this paper.')
        } else {
          setFormError('The paper could not be saved right now. Please try again.')
        }
      } else {
        setFormError('The paper could not be saved right now. Please try again.')
      }
    } finally {
      setSubmittingAction(null)
    }
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void submitWithStatus(mode === 'create' ? 'draft' : currentStatus)
  }

  const handleBack = () => {
    if (isDirty) {
      setShowDiscardDialog(true)
      return
    }
    navigate('/manage/papers')
  }

  return (
    <>
      <form className="paper-editor-form" noValidate onSubmit={handleSubmit}>
        <div className="paper-editor-form-toolbar">
          <button className="paper-editor-back" onClick={handleBack} type="button">
            <span aria-hidden="true">←</span> Back to Papers Management
          </button>
          {isDirty ? <span>Unsaved changes</span> : <span>All changes saved</span>}
        </div>

        {formError ? <p className="paper-form-summary-error" role="alert">{formError}</p> : null}

        <fieldset className="paper-form-fields" disabled={isSubmitting}>
          <section className="paper-form-section">
            <div className="paper-form-section-heading">
              <span>01</span>
              <div><h2>Basic Information</h2><p>Core publication and author details.</p></div>
            </div>
            <div className="paper-form-grid">
              <label className="paper-form-field is-wide" htmlFor="paper-title">
                <span>Title</span>
                <input
                  aria-describedby={fieldErrors.title ? 'paper-title-error' : undefined}
                  aria-invalid={Boolean(fieldErrors.title)}
                  id="paper-title"
                  maxLength={500}
                  onChange={(event) => updateValue('title', event.target.value)}
                  required
                  value={values.title}
                />
                <FieldError field="title" message={fieldErrors.title} />
              </label>

              <label className="paper-form-field is-wide" htmlFor="paper-authors">
                <span>Authors</span>
                <textarea
                  aria-describedby={fieldErrors.authors ? 'paper-authors-error' : 'paper-authors-hint'}
                  aria-invalid={Boolean(fieldErrors.authors)}
                  id="paper-authors"
                  onChange={(event) => updateValue('authors', event.target.value)}
                  rows={4}
                  value={values.authors}
                />
                <small id="paper-authors-hint">One author per line.</small>
                <FieldError field="authors" message={fieldErrors.authors} />
              </label>

              <label className="paper-form-field" htmlFor="paper-year">
                <span>Year</span>
                <input
                  aria-describedby={fieldErrors.year ? 'paper-year-error' : undefined}
                  aria-invalid={Boolean(fieldErrors.year)}
                  id="paper-year"
                  inputMode="numeric"
                  max={new Date().getFullYear() + 1}
                  min={1800}
                  onChange={(event) => updateValue('year', event.target.value)}
                  type="number"
                  value={values.year}
                />
                <FieldError field="year" message={fieldErrors.year} />
              </label>

              <label className="paper-form-field" htmlFor="paper-journal">
                <span>Journal</span>
                <input
                  aria-describedby={fieldErrors.journal ? 'paper-journal-error' : undefined}
                  aria-invalid={Boolean(fieldErrors.journal)}
                  id="paper-journal"
                  maxLength={300}
                  onChange={(event) => updateValue('journal', event.target.value)}
                  value={values.journal}
                />
                <FieldError field="journal" message={fieldErrors.journal} />
              </label>
            </div>
          </section>

          <section className="paper-form-section">
            <div className="paper-form-section-heading">
              <span>02</span>
              <div><h2>Classification</h2><p>Organize this resource for library discovery.</p></div>
            </div>
            <div className="paper-form-grid is-three-column">
              <label className="paper-form-field" htmlFor="paper-publicationType">
                <span>Publication Type</span>
                <select id="paper-publicationType" onChange={(event) => updateValue('publicationType', event.target.value as PaperPublicationType)} value={values.publicationType}>
                  {PUBLICATION_TYPES.map((value) => <option key={value}>{value}</option>)}
                </select>
              </label>
              <label className="paper-form-field" htmlFor="paper-difficulty">
                <span>Difficulty</span>
                <select id="paper-difficulty" onChange={(event) => updateValue('difficulty', event.target.value as PaperDifficulty)} value={values.difficulty}>
                  {DIFFICULTIES.map((value) => <option key={value}>{value}</option>)}
                </select>
              </label>
              <label className="paper-form-field" htmlFor="paper-resourceCategory">
                <span>Resource Category</span>
                <select id="paper-resourceCategory" onChange={(event) => updateValue('resourceCategory', event.target.value as PaperResourceCategory)} value={values.resourceCategory}>
                  {RESOURCE_CATEGORIES.map((value) => <option key={value}>{value}</option>)}
                </select>
              </label>

              <label className="paper-form-field is-wide" htmlFor="paper-topics">
                <span>Topics</span>
                <input
                  aria-describedby={fieldErrors.topics ? 'paper-topics-error' : 'paper-topics-hint'}
                  aria-invalid={Boolean(fieldErrors.topics)}
                  id="paper-topics"
                  onChange={(event) => updateValue('topics', event.target.value)}
                  value={values.topics}
                />
                <small id="paper-topics-hint">Comma-separated. Custom topics are supported.</small>
                <FieldError field="topics" message={fieldErrors.topics} />
              </label>

              <label className="paper-form-field is-wide" htmlFor="paper-keywords">
                <span>Keywords</span>
                <input
                  aria-describedby={fieldErrors.keywords ? 'paper-keywords-error' : 'paper-keywords-hint'}
                  aria-invalid={Boolean(fieldErrors.keywords)}
                  id="paper-keywords"
                  onChange={(event) => updateValue('keywords', event.target.value)}
                  value={values.keywords}
                />
                <small id="paper-keywords-hint">Comma-separated; optional.</small>
                <FieldError field="keywords" message={fieldErrors.keywords} />
              </label>
            </div>
          </section>

          <section className="paper-form-section">
            <div className="paper-form-section-heading">
              <span>03</span>
              <div><h2>Learning Content</h2><p>Provide the complete guided study material.</p></div>
            </div>
            <div className="paper-form-grid">
              <label className="paper-form-field is-wide" htmlFor="paper-abstract">
                <span>Abstract</span>
                <textarea
                  aria-describedby={fieldErrors.abstract ? 'paper-abstract-error' : undefined}
                  aria-invalid={Boolean(fieldErrors.abstract)}
                  id="paper-abstract"
                  maxLength={20000}
                  onChange={(event) => updateValue('abstract', event.target.value)}
                  rows={8}
                  value={values.abstract}
                />
                <FieldError field="abstract" message={fieldErrors.abstract} />
              </label>

              <label className="paper-form-field is-wide" htmlFor="paper-learningObjectives">
                <span>Learning Objectives</span>
                <textarea
                  aria-describedby={fieldErrors.learningObjectives ? 'paper-learningObjectives-error' : 'paper-learningObjectives-hint'}
                  aria-invalid={Boolean(fieldErrors.learningObjectives)}
                  id="paper-learningObjectives"
                  onChange={(event) => updateValue('learningObjectives', event.target.value)}
                  rows={6}
                  value={values.learningObjectives}
                />
                <small id="paper-learningObjectives-hint">One learning objective per line.</small>
                <FieldError field="learningObjectives" message={fieldErrors.learningObjectives} />
              </label>

              <label className="paper-form-field" htmlFor="paper-estimatedReadingMinutes">
                <span>Estimated Reading Time</span>
                <div className="paper-number-input">
                  <input
                    aria-describedby={fieldErrors.estimatedReadingMinutes ? 'paper-estimatedReadingMinutes-error' : undefined}
                    aria-invalid={Boolean(fieldErrors.estimatedReadingMinutes)}
                    id="paper-estimatedReadingMinutes"
                    max={600}
                    min={1}
                    onChange={(event) => updateValue('estimatedReadingMinutes', event.target.value)}
                    type="number"
                    value={values.estimatedReadingMinutes}
                  />
                  <span>minutes</span>
                </div>
                <FieldError field="estimatedReadingMinutes" message={fieldErrors.estimatedReadingMinutes} />
              </label>
            </div>
          </section>

          <section className="paper-form-section">
            <div className="paper-form-section-heading">
              <span>04</span>
              <div><h2>Access &amp; Publication</h2><p>Control library visibility and source access.</p></div>
            </div>
            <div className="paper-form-grid">
              <label className="paper-form-field is-wide" htmlFor="paper-externalUrl">
                <span>External URL</span>
                <input
                  aria-describedby={fieldErrors.externalUrl ? 'paper-externalUrl-error' : undefined}
                  aria-invalid={Boolean(fieldErrors.externalUrl)}
                  id="paper-externalUrl"
                  onChange={(event) => updateValue('externalUrl', event.target.value)}
                  placeholder="https://example.org/resource"
                  type="url"
                  value={values.externalUrl}
                />
                <FieldError field="externalUrl" message={fieldErrors.externalUrl} />
              </label>

              <div className="paper-form-toggles is-wide">
                <label>
                  <input checked={values.openAccess} onChange={(event) => updateValue('openAccess', event.target.checked)} type="checkbox" />
                  <span><strong>Open Access</strong><small>Mark this resource as openly accessible.</small></span>
                </label>
                <label>
                  <input checked={values.featured} onChange={(event) => updateValue('featured', event.target.checked)} type="checkbox" />
                  <span><strong>Featured</strong><small>Prioritize this resource in recommendations.</small></span>
                </label>
              </div>
            </div>
          </section>
        </fieldset>

        <div className="paper-editor-action-bar">
          <p>
            {mode === 'create'
              ? 'New resources remain private until published.'
              : `Current status: ${currentStatus}.`}
          </p>
          <div>
            <button className="is-secondary" disabled={isSubmitting} type="submit">
              {submittingAction === (mode === 'create' ? 'draft' : currentStatus)
                ? 'Saving...'
                : mode === 'create' ? 'Save Draft' : 'Save Changes'}
            </button>
            {(mode === 'create' || currentStatus === 'draft' || currentStatus === 'archived') ? (
              <button
                className="is-primary"
                disabled={isSubmitting}
                onClick={() => void submitWithStatus('published')}
                type="button"
              >
                {submittingAction === 'published'
                  ? 'Publishing...'
                  : currentStatus === 'archived' ? 'Publish Again' : 'Publish'}
              </button>
            ) : null}
          </div>
        </div>
      </form>

      {showDiscardDialog ? (
        <ConfirmDialog
          confirmLabel="Discard"
          description="Your unsaved edits will be lost."
          onCancel={() => setShowDiscardDialog(false)}
          onConfirm={() => navigate('/manage/papers')}
          title="Discard unsaved changes?"
          tone="danger"
        />
      ) : null}
    </>
  )
}

export default PaperForm
