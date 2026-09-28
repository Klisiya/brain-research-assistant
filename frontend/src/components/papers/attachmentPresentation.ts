import { PaperApiError } from '../../api/papers'
import type { AttachmentAccessLevel, AttachmentFileType, AttachmentType } from '../../types/paper'
export const ATTACHMENT_LABELS: Record<AttachmentType, string> = { pdf: 'PDF', cover: 'Cover', slides: 'Slides', document: 'Document', external_link: 'External Link' }
export const FILE_ACCEPT: Record<AttachmentFileType, string> = { pdf: '.pdf', cover: '.jpg,.jpeg,.png,.webp', slides: '.pptx', document: '.docx' }
export const ACCESS_LABELS: Record<AttachmentAccessLevel, string> = { public: 'Public', authenticated: 'Authenticated', staff: 'Staff' }
export const ACCESS_HELP: Record<AttachmentAccessLevel, string> = { public: 'Any visitor may access.', authenticated: 'Signed-in users only.', staff: 'Teachers and administrators only.' }
export function formatFileSize(size: number | null) {
  if (size === null) return null
  return size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} KB` : `${(size / (1024 * 1024)).toFixed(1)} MB`
}
export function attachmentError(error: unknown) {
  const messages: Record<string, string> = {
    AUTH_REQUIRED: 'Your session has expired. Please sign in again.',
    PAPER_EDIT_FORBIDDEN: 'You do not have permission to manage resources for this paper.',
    PAPER_NOT_FOUND: 'This paper is no longer available.',
    ATTACHMENT_NOT_FOUND: 'This resource is no longer available. Refresh the list and try again.',
    ATTACHMENT_ACCESS_DENIED: 'Access denied. You do not have permission to open this resource.',
    DUPLICATE_ATTACHMENT: 'This file is already attached to this paper. Choose a different file.',
    PRIMARY_ATTACHMENT_EXISTS: 'This paper already has a resource of this type. Use Replace on the existing resource.',
    FILE_TOO_LARGE: 'The file exceeds the upload limit for its type.',
    FILE_TYPE_NOT_ALLOWED: 'The selected file format is not supported for this resource type.',
    INVALID_FILE_CONTENT: 'The file content does not match a supported resource. Choose a valid file.',
    ATTACHMENT_CONFLICT: 'The resource changed or conflicts with an existing resource. Refresh the list before trying again.',
    ATTACHMENT_OPERATION_FAILED: 'The resource operation could not be completed. Please try again.',
    CSRF_MISSING: 'The request could not be secured. Please try again.',
    CSRF_INVALID: 'The request could not be secured. Please try again.',
    RATE_LIMITED: 'Too many requests. Wait a moment and try again.',
  }
  if (error instanceof PaperApiError) {
    if (error.code && messages[error.code]) return messages[error.code]
    if (error.status === 401) return messages.AUTH_REQUIRED
    if (error.status === 403) return messages.ATTACHMENT_ACCESS_DENIED
    if (error.code === 'VALIDATION_ERROR') return error.message
  }
  return 'Resources are unavailable right now. Please try again.'
}
export function externalResourceUrl(value: string | null) {
  if (!value) return null
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? value : null } catch { return null }
}
