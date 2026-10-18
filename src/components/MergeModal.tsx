import { useEffect, useMemo, useState } from 'react'
import type { Report, ReportRow } from '../types'
import { api } from '../util'
import { mergeReports, defaultOptions, type MergeOptions, type SectionPlan } from '../merge'
import { useEditor } from './Editor'
import { usDate } from './ReportsList'
import Modal from './Modal'

const norm = (s: string) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

/**
 * File → Merge Report Into This Report.
 * Step 1: pick the other report. Step 2: see what will be added and choose options. Step 3: merge.
 */
export default function MergeModal({ onClose, flush }: { onClose: () => void; flush: () => Promise<void> | void }) {
  const { r, mutate } = useEditor()
  const [rows, setRows] = useState<ReportRow[] | null>(null)
  const [q, setQ] = useState('')
  const [pick, setPick] = useState<string | null>(null)
  const [src, setSrc] = useState<Report | null>(null)
  const [opts, setOpts] = useState<MergeOptions | null>(null)
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [delAfter, setDelAfter] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  /** which of the other report's photos are already in this report (same file contents) */
  const [dryMap, setDryMap] = useState<Record<string, string> | null>(null)

  useEffect(() => { api.listReports().then(setRows) }, [])

  // reports at the same address (the "wrong appointment" case) go to the top
  const list = useMemo(() => {
    if (!rows) return []
    const here = norm(r.inspection.address)
    const words = norm(q).split(' ').filter(Boolean)
    return rows
      .filter((x) => x.id !== r.id)
      .filter((x) => { const hay = norm([x.date, usDate(x.date), x.client, x.address, x.city, x.zip, x.reportNumber, x.agent, x.inspector, x.template].join(' ')); return words.every((w) => hay.includes(w)) })
      .map((x) => ({ ...x, same: !!here && norm(x.address) === here }))
      .sort((a, b) => Number(b.same) - Number(a.same) || (b.date || '').localeCompare(a.date || '') || (b.updated || '').localeCompare(a.updated || ''))
      .slice(0, 400)
  }, [rows, q, r.id, r.inspection.address])

  async function next(id = pick) {
    if (!id) return
    setBusy(true)
    try {
      const s = await api.loadReport(id)
      const all = { ...defaultOptions(s), cover: true, attachments: false }
      const photos = mergeReports(r, s, all).plan.photosToCopy
      const dry = await api.mergeFiles(s.id, r.id, photos, [], true)
      setDryMap(dry.map); setSrc(s); setOpts(defaultOptions(s))
    } catch (e: any) { alert('Could not open that report: ' + (e?.message || e)) }
    setBusy(false)
  }

  const preview = useMemo(() => (src && opts && dryMap ? mergeReports(r, src, opts, dryMap).plan : null), [src, opts, r, dryMap])

  async function doMerge() {
    if (!src || !opts || !preview) return
    setBusy(true)
    try {
      await flush()
      const files = await api.mergeFiles(src.id, r.id, preview.photosToCopy, preview.attachmentsToCopy)
      let plan = preview
      mutate((cur) => {
        const res = mergeReports(cur, src, opts, files.map)
        plan = res.plan
        for (const k of Object.keys(res.result) as (keyof Report)[]) (cur as any)[k] = res.result[k]
      })
      await flush()
      if (delAfter) await api.deleteReport(src.id)
      const t = tally(plan.sections.filter((s) => opts.sections[s.srcId] !== false))
      setDone([
        `Merged ${plural(t.sections, 'section')}${t.added ? ` (${t.added} new)` : ''}: ${plural(t.items, 'item')}, ${plural(t.comments, 'new comment')}, ${plural(files.copied, 'photo')} copied` +
          (files.same ? ` (${files.same} already here, not copied twice)` : '') + '.',
        files.missing ? `${files.missing} file(s) were missing from the other report's folder and were skipped.` : '',
        'A backup of this report from just before the merge is in the reports list (gear → Open Backup).',
        delAfter ? 'The other report was moved to Deleted.' : '',
      ].filter(Boolean).join('\n\n'))
    } catch (e: any) { alert('Merge failed — nothing in this report was changed.\n\n' + (e?.message || e)) }
    setBusy(false)
  }

  if (done) return (
    <Modal title="Merge complete" onClose={onClose} footer={<button className="primary" onClick={onClose}>OK</button>}>
      <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{done}</div>
    </Modal>
  )

  // ---------- step 1: pick the other report ----------
  if (!src || !opts || !preview) return (
    <Modal title="Merge Report Into This Report — 1. Pick the other report" wide onClose={onClose}
      footer={<>
        <span className="hint grow">Findings from the report you pick are added to <b>this</b> report ({r.reportNumber || r.inspection.address}). The other report is not changed.</span>
        <button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={!pick || busy} onClick={() => next()}>{busy ? 'Opening…' : 'Next ▶'}</button>
      </>}>
      <div className="row">
        <input className="search grow" autoFocus placeholder="Search by name, address, report ID, inspector…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="muted small">{rows ? `${list.length} shown` : 'Loading…'}</span>
      </div>
      <div className="table-wrap picker-table" style={{ height: 420 }}>
        <table className="grid">
          <thead><tr><th>Date</th><th>Name</th><th>Address</th><th>Report ID</th><th>Inspector</th><th>Template</th></tr></thead>
          <tbody>
            {list.map((x) => (
              <tr key={x.id} className={pick === x.id ? 'sel' : ''} onClick={() => setPick(x.id)} onDoubleClick={() => { setPick(x.id); next(x.id) }}>
                <td>{usDate(x.date)}</td>
                <td>{x.client}</td>
                <td>{x.address}{x.same && <span className="merge-badge">same address</span>}</td>
                <td>{x.reportNumber}</td>
                <td>{x.inspector}</td>
                <td className="muted">{x.template}</td>
              </tr>
            ))}
            {rows && !list.length && <tr><td colSpan={6} className="empty">No reports match.</td></tr>}
          </tbody>
        </table>
      </div>
    </Modal>
  )

  // ---------- step 2: review what will change ----------
  const set = (patch: Partial<MergeOptions>) => setOpts({ ...opts, ...patch })
  const chosen = preview.sections.filter((s) => opts.sections[s.srcId] !== false)
  const t = tally(chosen)
  const srcName = [src.clients[0]?.first, src.clients[0]?.last].filter(Boolean).join(' ')
  const nothing = !chosen.length && !preview.generalInfo.replace && !preview.generalInfo.materials && !preview.cover && !preview.attachmentsToCopy.length && !opts.customer && !opts.services && !opts.inspection
  const useful = preview.sections.filter(hasNews)
  const sameCount = preview.sections.length - useful.length
  const allOn = useful.every((s) => opts.sections[s.srcId] !== false)

  return (
    <Modal title="Merge Report Into This Report — 2. Check what will be added" full onClose={onClose}
      footer={<>
        <label className="row small"><input type="checkbox" checked={delAfter} onChange={(e) => setDelAfter(e.target.checked)} /> After merging, move the other report to Deleted</label>
        <span className="grow" />
        <button onClick={() => { setSrc(null); setOpts(null); setDryMap(null) }} disabled={busy}>◀ Back</button>
        <button onClick={onClose} disabled={busy}>Cancel</button>
        <button className="primary" disabled={busy || nothing} onClick={doMerge}>{busy ? 'Merging…' : 'Merge'}</button>
      </>}>
      <div className="merge-head">
        <div><span className="muted">From:</span> <b>{src.reportNumber || src.inspection.address}</b> — {srcName || 'no customer'} · {usDate(src.inspection.date)} · {src.inspection.inspector || 'no inspector'} · <span className="muted">{src.template.name}</span></div>
        <div><span className="muted">Into:</span> <b>{r.reportNumber || r.inspection.address}</b> (this report)</div>
      </div>

      <div className="merge-cols">
        <div className="merge-sections">
          <div className="row merge-bar">
            <b>Sections with something to add</b>
            <span className="muted small">{[sameCount && `${sameCount} already match this report`, preview.emptySections && `${preview.emptySections} empty in the other report`].filter(Boolean).join(' · ')}</span>
            <span className="grow" />
            <button className="link" onClick={() => { const s: Record<string, boolean> = {}; useful.forEach((x) => (s[x.srcId] = !allOn)); set({ sections: { ...opts.sections, ...s } }) }}>{allOn ? 'Untick all' : 'Tick all'}</button>
          </div>
          {!useful.length && <div className="empty">{preview.sections.length ? 'Everything in the other report is already in this report.' : 'The other report has no findings filled in.'}</div>}
          {useful.map((s) => {
            const on = opts.sections[s.srcId] !== false
            return (
              <div key={s.srcId} className={'merge-sec' + (on ? '' : ' off')}>
                <div className="row">
                  <input type="checkbox" checked={on} onChange={(e) => set({ sections: { ...opts.sections, [s.srcId]: e.target.checked } })} />
                  <button className="icon" onClick={() => setOpen({ ...open, [s.srcId]: !open[s.srcId] })}>{open[s.srcId] ? '▾' : '▸'}</button>
                  <b>{s.name}</b>
                  {s.match == null ? <span className="merge-badge new">new section</span> : norm(s.match) === norm(s.name) ? <span className="merge-badge">merges</span> : <span className="merge-badge">→ {s.match}</span>}
                  {s.unexclude && <span className="merge-badge">will be included</span>}
                  {s.newInstances.map((n) => <span key={n} className="merge-badge new">+ {n}</span>)}
                  <span className="grow" />
                  <span className="muted small">{sectionLine(s)}</span>
                </div>
                {open[s.srcId] && (
                  <div className="merge-items">
                    {s.items.map((it, i) => (
                      <div key={i}>
                        <b>{it.title || '(item)'}</b>
                        {it.newItem && <span className="merge-badge new">new item</span>}
                        {it.ratings.length > 0 && <span className={'merge-badge' + (it.ratingConflict ? ' warn' : '')} title={it.ratingConflict ? 'This report already had a different rating; both are kept' : ''}>{it.ratingConflict ? '+ ' : ''}{it.ratings.join(', ')}</span>}
                        <span className="muted small"> {[it.comments && plural(it.comments, 'comment'), it.photos && plural(it.photos, 'photo'), it.dupComments && `${it.dupComments} already here`, it.summary && `${it.summary} on summary`].filter(Boolean).join(' · ')}</span>
                      </div>
                    ))}
                    {s.materials.map((m, i) => (
                      <div key={'m' + i}><span className="muted">S&M</span> <b>{m.name}</b>{m.newMaterial && <span className="merge-badge new">new</span>} <span className="muted small">{[m.added.join(', '), m.extraInfo && 'extra info'].filter(Boolean).join(' · ')}</span></div>
                    ))}
                    {!s.items.length && !s.materials.length && <div className="muted">Only section text.</div>}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div className="merge-opts">
          <h3>Also bring over</h3>
          <label><input type="checkbox" checked={opts.materials} onChange={(e) => set({ materials: e.target.checked })} /> Styles &amp; Materials selections</label>
          <label><input type="checkbox" checked={opts.cover && !r.coverPhoto && !!src.coverPhoto} onChange={(e) => set({ cover: e.target.checked })} disabled={!!r.coverPhoto || !src.coverPhoto} /> Cover photo {r.coverPhoto ? <span className="muted small">(this report has one)</span> : !src.coverPhoto ? <span className="muted small">(other has none)</span> : ''}</label>
          <label><input type="checkbox" checked={opts.attachments && !!src.attachments?.length} onChange={(e) => set({ attachments: e.target.checked })} disabled={!src.attachments?.length} /> Attachments {src.attachments?.length ? <span className="muted small">({preview.attachmentsToCopy.length} new)</span> : <span className="muted small">(none)</span>}</label>
          <label><input type="checkbox" checked={opts.generalInfo === 'replace'} onChange={(e) => set({ generalInfo: e.target.checked ? 'replace' : 'keep' })} /> Replace General Info text with the other report's</label>
          <div className="hint">Left unticked, this report's General Info text is kept (it is only filled in if this report's is empty).</div>

          <h3>Office info</h3>
          <div className="hint">Leave these off when this report is the office's prefilled one — it keeps its own customer, agent, price and appointment.</div>
          <label><input type="checkbox" checked={opts.customer} onChange={(e) => set({ customer: e.target.checked })} /> Customer &amp; agents from the other report</label>
          <label><input type="checkbox" checked={opts.services} onChange={(e) => set({ services: e.target.checked })} /> Services, price &amp; invoice from the other report</label>
          <label><input type="checkbox" checked={opts.inspection} onChange={(e) => set({ inspection: e.target.checked })} /> Date, time &amp; address from the other report</label>

          <h3>Summary</h3>
          <div className="merge-total">
            {t.sections ? <>
              <div>{plural(t.sections, 'section')}{t.added ? ` (${t.added} new)` : ''}</div>
              <div>{plural(t.items, 'item')} changed</div>
              <div>{plural(t.comments, 'new comment')}</div>
              <div>{plural(t.photos, 'photo')}</div>
              {t.materials > 0 && <div>{plural(t.materials, 'S&M change')}</div>}
            </> : <div className="muted">No sections ticked.</div>}
            {preview.generalInfo.replace && <div>General Info text replaced</div>}
            {preview.generalInfo.materials > 0 && <div>{plural(preview.generalInfo.materials, 'General Info S&M change')}</div>}
            {preview.cover && <div>Cover photo added</div>}
          </div>
          {preview.warnings.length > 0 && <div className="merge-warn">{preview.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}</div>}
          <div className="hint">A backup of this report is saved before merging, so it can be undone from the reports list (gear → Open Backup).</div>
        </div>
      </div>
    </Modal>
  )
}

function sectionLine(s: SectionPlan) {
  return [s.totals.items && plural(s.totals.items, 'item'), s.totals.comments && plural(s.totals.comments, 'comment'), s.totals.photos && plural(s.totals.photos, 'photo'), s.totals.materials && `${s.totals.materials} S&M`].filter(Boolean).join(' · ') || 'nothing new'
}
const hasNews = (s: SectionPlan) => s.match == null || s.unexclude || s.newInstances.length > 0 || s.totals.items > 0 || s.totals.materials > 0
function tally(all: SectionPlan[]) {
  const list = all.filter(hasNews)
  return {
    sections: list.length, added: list.filter((s) => s.match == null).length,
    items: list.reduce((n, s) => n + s.totals.items, 0), comments: list.reduce((n, s) => n + s.totals.comments, 0),
    photos: list.reduce((n, s) => n + s.totals.photos, 0), materials: list.reduce((n, s) => n + s.totals.materials, 0),
  }
}
