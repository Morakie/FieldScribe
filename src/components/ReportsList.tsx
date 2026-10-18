import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReportRow, BackupInfo } from '../types'
import { api, thumbUrl, joinPath } from '../util'
import Modal from './Modal'

type Key = 'date' | 'client' | 'address' | 'city' | 'zip' | 'reportNumber' | 'agent' | 'published' | 'paid' | 'reinspection'
const COLS: [Key, string, number][] = [
  ['date', 'Date', 95], ['client', 'Name1', 190], ['address', 'Address', 230], ['city', 'City', 130], ['zip', 'Zip', 70],
  ['reportNumber', 'Report ID', 290], ['agent', 'Agent', 180], ['published', 'Published', 95], ['paid', 'Paid', 70], ['reinspection', 'Reinspection', 110],
]

const TOTAL_W = COLS.reduce((a, c) => a + c[2], 0)

/** 2026-09-23 → 9/23/2026, like HomeGauge's list. */
export const usDate = (d: string) => {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(d || '')
  return m ? `${+m[2]}/${+m[3]}/${m[1]}` : d
}

export default function ReportsList({ onOpen, onNew, onHome }: { onOpen: (id: string) => void; onNew: () => void; onHome: () => void }) {
  const [rows, setRows] = useState<ReportRow[]>([])
  const [q, setQ] = useState('')
  const [qCol, setQCol] = useState<Key | 'all'>('all')
  const [matchCase, setMatchCase] = useState(false)
  const [sort, setSort] = useState<[Key, number]>(['date', -1])
  const [sel, setSel] = useState<string[]>([])
  const [anchor, setAnchor] = useState<string | null>(null)
  const [gear, setGear] = useState(false)
  const [backupsFor, setBackupsFor] = useState<ReportRow | null>(null)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const bodyRef = useRef<HTMLTableSectionElement>(null)

  const load = async (force = false) => { const r = await api.listReports(force); setRows(r); return r }
  useEffect(() => { load(); return api.onProgress((m) => setMsg(m)) }, [])
  useEffect(() => {
    const f = (e: Event) => {
      const cmd = (e as CustomEvent).detail
      if (cmd === 'importReports') doImport('folder')
      if (cmd === 'importZip') doImport('zip')
      if (cmd === 'importTemplate') importTemplate()
    }
    window.addEventListener('bridge-menu', f)
    return () => window.removeEventListener('bridge-menu', f)
  })

  const shown = useMemo(() => {
    const norm = (s: string) => (matchCase ? s : s.toLowerCase())
    const needle = norm(q.trim())
    const cell = (r: ReportRow, k: Key) => (k === 'date' ? usDate(r.date) + ' ' + r.date : String(r[k] || ''))
    const f = rows.filter((r) => !needle || (qCol === 'all' ? COLS.map(([k]) => k) : [qCol]).some((k) => norm(cell(r, k)).includes(needle)))
    const [k, d] = sort
    return [...f].sort((a, b) => String(a[k] || '').localeCompare(String(b[k] || ''), undefined, { numeric: true }) * d
      || (b.updated || '').localeCompare(a.updated || ''))
  }, [rows, q, qCol, matchCase, sort])
  const selRows = rows.filter((r) => sel.includes(r.id))
  const one = selRows.length === 1 ? selRows[0] : null

  function click(e: React.MouseEvent, id: string) {
    if (e.shiftKey && anchor) {
      const a = shown.findIndex((r) => r.id === anchor), b = shown.findIndex((r) => r.id === id)
      const [lo, hi] = a < b ? [a, b] : [b, a]
      setSel(shown.slice(lo, hi + 1).map((r) => r.id))
    } else if (e.ctrlKey || e.metaKey) {
      setSel(sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]); setAnchor(id)
    } else { setSel([id]); setAnchor(id) }
  }
  function keys(e: React.KeyboardEvent) {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return
    const i = shown.findIndex((r) => r.id === (anchor || sel[0]))
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const n = shown[Math.max(0, Math.min(shown.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]
      if (n) { setSel([n.id]); setAnchor(n.id); bodyRef.current?.querySelector(`[data-id="${n.id}"]`)?.scrollIntoView({ block: 'nearest' }) }
    }
    if (e.key === 'Enter' && one) onOpen(one.id)
    if (e.key === 'Delete' && selRows.length) deleteSel()
  }

  async function doImport(mode: 'folder' | 'zip') {
    setBusy(true); setMsg('Importing…')
    try {
      const res = await api.importReports(mode)
      setMsg(`Imported ${res.done.length} report(s).` + (res.skipped ? ` ${res.skipped} already imported (skipped).` : '') + (res.failed.length ? ` Problems: ${res.failed.join('; ')}` : ''))
      await load()
    } finally { setBusy(false) }
  }
  async function importTemplate() {
    const names = await api.importTemplate()
    if (names.length) setMsg(`Imported template(s): ${names.join(', ')}`)
  }
  async function refresh() {
    setBusy(true); setMsg('Refreshing the report list…')
    try { const r = await load(true); setMsg(`Report list refreshed: ${r.length} reports.`) } finally { setBusy(false) }
  }
  async function makeReinspection() {
    if (!one) return
    if (!confirm(`Create a reinspection from "${one.reportNumber || one.address}"?\n\nIt copies only the items on the summary or rated RR, with their comments and photos. Everything else is excluded, and the copied items are left unrated so Find Unanswered walks you through them.`)) return
    setBusy(true); setGear(false)
    try {
      const res = await api.createReinspection(one.id)
      await load()
      setSel([res.id]); setAnchor(res.id)
      setMsg(`Reinspection created with ${res.kept} item(s) to recheck.`)
      if (res.kept && confirm('Open the reinspection now?')) onOpen(res.id)
    } finally { setBusy(false) }
  }
  async function makeCopy() {
    if (!one) return
    setBusy(true); setGear(false)
    try {
      const id = await api.copyReport(one.id)
      await load(); setSel([id]); setAnchor(id)
      setMsg(`Copied "${one.reportNumber || one.address}". The copy's Report ID ends in -Copy.`)
    } finally { setBusy(false) }
  }
  async function deleteSel() {
    setGear(false)
    if (!selRows.length) return
    const what = selRows.length === 1 ? `report "${selRows[0].reportNumber || selRows[0].address}"` : `${selRows.length} reports`
    if (!confirm(`Delete ${what}?\n\nDeleted reports are moved to the .deleted folder inside the data folder, so they can be recovered.`)) return
    for (const r of selRows) await api.deleteReport(r.id)
    setSel([]); load(); setMsg(`Deleted ${what}.`)
  }

  const d = one?.details
  const detail: [string, string][] = one && d ? [
    ['Saved in Directory', one.dir], ['Using Template', one.template || '<none>'], ['Client', d.clientName], ['Company Name', d.company],
    ['Date', usDate(one.date)], ['Start Time', d.start], ['Stop Time', d.end], ['Inspector', one.inspector],
    ['Inspection Address', d.inspAddress], ['Current/Billing Address', d.billing], ['Work Phone', d.workPhone], ['Home Phone', d.homePhone],
    ['Mobile Phone', d.mobile], ['Email', d.email], ['MLS', d.mls],
    ...d.reps.map((n, i) => [`REP ${i + 1}`, n] as [string, string]),
    ...(d.reinspectionOf ? [['Reinspection of', rows.find((r) => r.id === d.reinspectionOf)?.reportNumber || d.reinspectionOf] as [string, string]] : []),
    ...(one.importedFrom ? [['Imported from', one.importedFrom] as [string, string]] : []),
  ] : []

  return (
    <div className="home" tabIndex={-1} onKeyDown={keys}>
      <div className="toolbar">
        <button onClick={onHome} title="Back to the start page">← Start Page</button>
        <div className="brand">Bridge <b>Report</b></div>
        <button className="primary" onClick={onNew}>＋ New Report</button>
        <span className="sep" />
        <button disabled={busy} onClick={() => doImport('folder')} title="Pick HomeGauge's Reports folder (AppData\Local\HomeGauge\Reports) or individual report folders">Import HomeGauge reports</button>
        <button disabled={busy} onClick={() => doImport('zip')} title="Pick HomeGauge upload .zip files">Import HomeGauge .zip</button>
        <button onClick={importTemplate}>Import HomeGauge template</button>
        <span className="sep" />
        <button onClick={() => api.openDataFolder()}>Open data folder</button>
      </div>
      <div className="rl-search">
        <span className="muted">Click a column header to sort, or search for a report:</span>
        <select value={qCol} onChange={(e) => setQCol(e.target.value as Key | 'all')}>
          <option value="all">All Columns</option>
          {COLS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <input className="search" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        <label className="chk"><input type="checkbox" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} /> Match case</label>
        {q && <button className="link" onClick={() => setQ('')}>clear</button>}
      </div>
      {msg && <div className="notice">{msg} <button className="link" onClick={() => setMsg('')}>dismiss</button></div>}
      <div className="table-wrap">
        <table className="grid rl-grid">
          <colgroup>{COLS.map(([k, , w]) => <col key={k} style={{ width: `${(w / TOTAL_W) * 100}%` }} />)}</colgroup>
          <thead>
            <tr>{COLS.map(([k, l]) => (
              <th key={k} className={['published', 'paid', 'reinspection'].includes(k) ? 'c' : ''} onClick={() => setSort([k, sort[0] === k ? -sort[1] : k === 'date' ? -1 : 1])}>{l}{sort[0] === k ? (sort[1] > 0 ? ' ▲' : ' ▼') : ''}</th>
            ))}</tr>
          </thead>
          <tbody ref={bodyRef}>
            {shown.map((r) => (
              <tr key={r.id} data-id={r.id} className={sel.includes(r.id) ? 'sel' : ''} onClick={(e) => click(e, r.id)} onDoubleClick={() => onOpen(r.id)}>
                {COLS.map(([k]) => <td key={k} className={['published', 'paid', 'reinspection'].includes(k) ? 'c' : ''}>{k === 'date' ? usDate(r.date) : r[k]}</td>)}
              </tr>
            ))}
            {!shown.length && <tr><td colSpan={COLS.length} className="empty">
              {rows.length ? 'No matches.' : 'No reports yet. Click “New Report”, or import from HomeGauge.'}
            </td></tr>}
          </tbody>
        </table>
      </div>
      <div className="rl-buttons">
        <span className="muted">{shown.length} of {rows.length} reports{selRows.length > 1 ? ` · ${selRows.length} selected` : ''}</span>
        <span className="grow" />
        <button className="primary" disabled={!one} onClick={() => one && onOpen(one.id)}>Open</button>
        <button disabled={busy} onClick={refresh} title="Re-read every report and rebuild this list">Refresh Database</button>
        <div className="gear-wrap">
          <button className={gear ? 'on' : ''} onClick={() => setGear(!gear)} title="More actions for the selected report">⚙ ▾</button>
          {gear && <>
            <div className="menu-back" onMouseDown={() => setGear(false)} />
            <div className="gear-menu">
              <button disabled={!one || busy} onClick={makeReinspection}>Create Reinspection From Selected Report</button>
              <button disabled={!one || busy} onClick={makeCopy}>Create a Copy of the Selected Report</button>
              <button disabled={!one} onClick={() => { setGear(false); one && setBackupsFor(one) }}>Open Backup For Selected Report…</button>
              <hr />
              <button disabled={!one} onClick={() => { setGear(false); one && api.openReportFolder(one.id) }}>Open Report Folder</button>
              <hr />
              <button className="danger" disabled={!selRows.length || busy} onClick={deleteSel}>Delete Selected Report{selRows.length > 1 ? `s (${selRows.length})` : ''}…</button>
            </div>
          </>}
        </div>
      </div>
      <div className="rl-details">
        <div className="rl-info">
          {one ? detail.map(([k, v]) => <div key={k}><span className="muted">{k}:</span> {v}</div>)
            : <div className="muted">{selRows.length > 1 ? `${selRows.length} reports selected.` : 'Select a report to see its details.'}</div>}
        </div>
        <div className="rl-cover">
          {one?.coverPhoto ? <img src={thumbUrl(joinPath(one.dir, one.coverPhoto), 480)} alt="" /> : one ? <span className="muted">No cover photo</span> : null}
        </div>
      </div>
      {backupsFor && <BackupsDialog row={backupsFor} onClose={() => setBackupsFor(null)} onRestored={(id) => { setBackupsFor(null); load(); setMsg('Backup restored. The version it replaced was saved as a backup too.'); onOpen(id) }} />}
    </div>
  )
}

function BackupsDialog({ row, onClose, onRestored }: { row: ReportRow; onClose: () => void; onRestored: (id: string) => void }) {
  const [list, setList] = useState<BackupInfo[] | null>(null)
  const [pick, setPick] = useState<string | null>(null)
  useEffect(() => { api.listBackups(row.id).then((l) => { setList(l); setPick(l[0]?.file || null) }) }, [row.id])
  async function restore() {
    if (!pick) return
    const b = list?.find((x) => x.file === pick)
    if (!confirm(`Restore the backup from ${b ? new Date(b.time).toLocaleString() : ''}?\n\nThe report as it is now is saved as a backup first, so you can switch back.`)) return
    await api.restoreBackup(row.id, pick)
    onRestored(row.id)
  }
  return (
    <Modal title={`Backups — ${row.reportNumber || row.address}`} onClose={onClose}
      footer={<><button onClick={onClose}>Cancel</button><button className="primary" disabled={!pick} onClick={restore}>Restore &amp; Open</button></>}>
      <p className="muted" style={{ marginTop: 0 }}>A backup is saved at most every 5 minutes while you work. The last 10 are kept.</p>
      {list === null ? <div className="muted">Loading…</div> : !list.length ? <div className="muted">No backups yet for this report. One is made the next time it's edited and saved.</div> :
        <table className="grid narrow">
          <thead><tr><th>Saved</th><th>Size</th></tr></thead>
          <tbody>{list.map((b) => (
            <tr key={b.file} className={pick === b.file ? 'sel' : ''} onClick={() => setPick(b.file)}>
              <td>{new Date(b.time).toLocaleString()}</td><td>{(b.size / 1024).toFixed(0)} KB</td>
            </tr>))}
          </tbody>
        </table>}
    </Modal>
  )
}
