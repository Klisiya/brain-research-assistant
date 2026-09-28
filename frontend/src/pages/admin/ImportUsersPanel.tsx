import { useRef, useState, type FormEvent } from 'react'
import { adminErrorMessage, importUsers, type ImportResult } from '../../api/admin'
export default function ImportUsersPanel({ onImported }: { onImported: () => void }) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [results, setResults] = useState<ImportResult[] | null>(null)
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!file || busy) return
    setError(''); setResults(null)
    if (file.size > 128 * 1024) { setError('Use a CSV file no larger than 128 KiB.'); return }
    setBusy(true)
    try { const response = await importUsers(file); setResults(response.results); onImported() }
    catch (reason) { setError(adminErrorMessage(reason)) }
    finally { setBusy(false) }
  }
  return <section className="admin-glass admin-results" aria-labelledby="import-users-title">
    <h2 id="import-users-title">Import Users</h2>
    <p>Send invitations from a UTF-8 CSV with columns <code>email,username,role</code>. Use student, teacher, or admin. Maximum 100 rows and 128 KiB. Existing accounts are never replaced. Do not include passwords.</p>
    <form className="admin-import-form" onSubmit={submit}><label htmlFor="import-users-file">CSV file</label><input ref={fileInput} className="admin-sr-only" tabIndex={-1} id="import-users-file" type="file" accept=".csv,text/csv" disabled={busy} onChange={event => { setFile(event.target.files?.[0] || null); setResults(null); setError('') }} /><div className="admin-actions"><button type="button" disabled={busy} onClick={() => fileInput.current?.click()}>Choose CSV</button><span>{file?.name || 'No file selected'}</span></div><button disabled={busy || !file}>{busy ? 'Sending Invitations...' : 'Import Invitations'}</button></form>
    {error && <p role="alert">{error}</p>}
    {results && <><p role="status">{results.filter(row => row.status === 'invited').length} invited; {results.filter(row => row.status === 'failed').length} failed. Retry only failed rows after resolving the reported issue.</p><div className="admin-table-scroll" tabIndex={0} role="region" aria-label="Import results"><table><caption className="admin-sr-only">CSV row results</caption><thead><tr><th>CSV row</th><th>Result</th><th>Details</th></tr></thead><tbody>{results.map(row => <tr key={row.row}><th scope="row">{row.row}</th><td>{row.status}</td><td>{row.status === 'invited' ? `Invitation #${row.invitationId}` : `${row.code}: ${row.error}`}</td></tr>)}</tbody></table></div></>}
  </section>
}
