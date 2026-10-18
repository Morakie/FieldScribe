import { useEffect, useMemo, useState } from 'react'
import type { FillInfo } from '../types'
import { api } from '../util'
import { applyFillTo, fillFromReport, previewFill, FILL_MODES, type FillMode } from '../fills'
import { useEditor } from './Editor'
import Modal from './Modal'

const usDate = (iso: string) => { const d = new Date(iso); return isNaN(+d) ? '' : `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}` }
const tplKey = (s: string) => String(s || '').split(/[\\/]/).pop()!.replace(/\.ht5$/i, '').toLowerCase().trim()

/** Report → Apply Report Fill / Save New Report Fill (HomeGauge layout, with a few extras). */
export function FillsModal({ mode, onClose, flush }: { mode: 'apply' | 'save'; onClose: () => void; flush: () => any }) {
  const { r, mutate } = useEditor()
  const [list, setList] = useState<FillInfo[] | null>(null)
  const [sel, setSel] = useState<string | null>(null)
  const [desc, setDesc] = useState(false)
  const [how, setHow] = useState<FillMode>(() => { try { return (localStorage.getItem('fillMode') as FillMode) || 'add' } catch { return 'add' } })
  const [fill, setFill] = useState<any>(null)
  const [busy, setBusy] = useState('')
  const [done, setDone] = useState('')
  const [hgOpen, setHgOpen] = useState(false)
  const [name, setName] = useState('')
  const [withPhotos, setWithPhotos] = useState(true)

  const load = async (pick?: string) => {
    const l = await api.listFills(); setList(l)
    if (pick) setSel(pick)
    else setSel((s) => (s && l.some((x) => x.name === s) ? s : mode === 'apply' ? (l.find((x) => tplKey(x.template) === tplKey(r.template.name))?.name ?? l[0]?.name ?? null) : null))
  }
  useEffect(() => { load() }, [])
  useEffect(() => { setFill(null); if (sel && mode === 'apply') api.loadFill(sel).then(setFill).catch(() => setFill(null)) }, [sel])
  useEffect(() => { try { localStorage.setItem('fillMode', how) } catch {} }, [how])

  const sorted = useMemo(() => (list ? [...list].sort((a, b) => (desc ? -1 : 1) * a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })) : []), [list, desc])
  const info = list?.find((x) => x.name === sel) || null
  const plan = useMemo(() => (sel && fill ? previewFill(r, sel, fill, how) : null), [sel, fill, how, r])
  const otherTemplate = info && info.template && tplKey(info.template) !== tplKey(r.template.name)

  async function apply(which = sel) {
    if (!which) return
    setBusy('Applying…')
    try { setDone(await applyFillTo(r, which, how, flush, mutate)) } catch (e: any) { alert('Could not apply the fill — this report was not changed.\n\n' + (e?.message || e)) }
    setBusy('')
  }
  async function save() {
    const n = name.trim()
    if (!n) return
    if (list?.some((x) => x.name.toLowerCase() === n.toLowerCase()) && !confirm(`Replace the report fill "${n}" with this report's answers?`)) return
    setBusy('Saving…')
    try {
      await flush()
      const data = fillFromReport(r, withPhotos)
      const saved = await api.saveFill(n, r.id, data)
      setDone(`Saved report fill "${saved}": ${data.counts.items} item(s), ${data.counts.comments} comment(s), ${withPhotos ? data.photos.length : 0} photo(s), ${data.counts.materials} S&M list(s).`)
    } catch (e: any) { alert('Could not save the fill.\n\n' + (e?.message || e)) }
    setBusy('')
  }
  async function del() {
    if (!sel || !confirm(`Delete the report fill "${sel}"? This cannot be undone.`)) return
    await api.deleteFill(sel); setSel(null); load()
  }
  async function rename() {
    if (!sel) return
    const n = prompt('New name for this report fill:', sel)
    if (!n || n.trim() === sel) return
    try { load(await api.renameFill(sel, n.trim())) } catch (e: any) { alert(e?.message || String(e)) }
  }

  if (done) return (
    <Modal title={mode === 'apply' ? 'Apply Report Fill' : 'Save New Report Fill'} onClose={onClose} footer={<button className="primary" onClick={onClose}>OK</button>}>
      <div style={{ lineHeight: 1.6 }}>{done}</div>
      {mode === 'apply' && <div className="hint">A backup of the report from just before the fill was made (reports list → gear → Open Backup).</div>}
    </Modal>
  )

  const listBox = (
    <div className="fill-list">
      <div className="fill-head" onClick={() => setDesc(!desc)} title="Sort">Report Fill Names <span>{desc ? '▼' : '▲'}</span></div>
      <div className="fill-rows">
        {sorted.map((f) => (
          <div key={f.name} className={'fill-row' + (f.name === sel ? ' sel' : '')}
            onClick={() => { setSel(f.name); if (mode === 'save') setName(f.name) }}
            onDoubleClick={() => { setSel(f.name); if (mode === 'apply') apply(f.name) }}>
            {f.name}{f.version === 1 && <span className="muted small"> (old format)</span>}
          </div>
        ))}
        {list && !list.length && <div className="muted pad-s">No report fills yet.{mode === 'apply' ? ' Import yours from HomeGauge below, or open a finished report and use Report → Save New Report Fill.' : ''}</div>}
      </div>
    </div>
  )

  if (mode === 'save') return (
    <Modal title="Save New Report Fill" onClose={onClose}
      footer={<>
        <span className="grow" />
        <button className="primary" disabled={!name.trim() || !!busy} onClick={save}>{busy || 'OK'}</button>
        <button onClick={onClose}>Cancel</button>
      </>}>
      <label className="field"><span>Report fill name</span>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} placeholder="e.g. New Construction" /></label>
      <div className="muted small">Saves this report's ratings, comments, Styles &amp; Materials, General Info{withPhotos ? ' and photos' : ''}. Customer, agent, price and appointment info are never saved in a fill. Click an existing fill to save over it.</div>
      {listBox}
      <label className="row"><input type="checkbox" checked={withPhotos} onChange={(e) => setWithPhotos(e.target.checked)} /> Include photos</label>
      <div className="fill-info">Using Template: {r.template.name}</div>
    </Modal>
  )

  return (
    <>
      <Modal title="Apply Report Fill" onClose={onClose}
        footer={<>
          <button onClick={() => setHgOpen(true)}>Import from HomeGauge…</button>
          <span className="grow" />
          <button className="primary" disabled={!sel || !!busy} onClick={() => apply()}>{busy || 'OK'}</button>
          <button onClick={onClose}>Cancel</button>
        </>}>
        <div>Select a Report Fill to apply</div>
        {listBox}
        <div className="row"><span className="grow" /><button disabled={!sel} onClick={rename}>Rename</button><button disabled={!sel} onClick={del}>Delete</button></div>
        <div className="fill-info">
          {info ? <>
            <div>Date: {usDate(info.date)}</div>
            <div>Using Template: {info.template ? `${info.template}.ht5`.replace(/\.ht5\.ht5$/i, '.ht5') : '(unknown)'}</div>
            {info.counts && <div className="muted">Contains {info.counts.items} answered items, {info.counts.comments} comments, {info.counts.photos} photos, {info.counts.materials} S&amp;M lists</div>}
            {otherTemplate && <div className="warn-text">This report uses “{r.template.name}”. Sections and items are matched by name; anything that doesn't match is added as new.</div>}
            {plan && <div className="muted">Will change: {plan.sections.reduce((n, s) => n + s.totals.items, 0)} items, {plan.sections.reduce((n, s) => n + s.totals.comments, 0)} new comments, {plan.sections.reduce((n, s) => n + s.totals.materials, 0) + plan.generalInfo.materials} S&amp;M lists{plan.sections.some((s) => s.match == null) ? `, ${plan.sections.filter((s) => s.match == null).length} new sections` : ''}</div>}
          </> : <span className="muted">Pick a fill to see what's in it.</span>}
        </div>
        <div className="fill-modes">
          {FILL_MODES.map(([k, label, hint]) => (
            <label key={k} title={hint}><input type="radio" name="fillmode" checked={how === k} onChange={() => setHow(k)} /> {label}</label>
          ))}
        </div>
      </Modal>
      {hgOpen && <HgFillsImport have={list || []} onClose={(n) => { setHgOpen(false); if (n) load(n) }} />}
    </>
  )
}

/** Pick HomeGauge report fills (AppData\Local\HomeGauge\AutoFill) to bring into Bridge Report. */
export function HgFillsImport({ have, onClose }: { have: FillInfo[]; onClose: (firstImported?: string) => void }) {
  const [hg, setHg] = useState<{ path: string; name: string; updated: string }[] | null>(null)
  const [pick, setPick] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState('')
  const [result, setResult] = useState<string | null>(null)
  const [mine, setMine] = useState<FillInfo[]>(have)
  const haveSet = new Set(mine.map((x) => x.name.toLowerCase()))
  useEffect(() => {
    Promise.all([api.hgFills(), api.listFills()]).then(([l, m]) => {
      const hs = new Set(m.map((x) => x.name.toLowerCase()))
      setMine(m); setHg(l); setPick(Object.fromEntries(l.map((x) => [x.path, !hs.has(x.name.toLowerCase())])))
    })
    return api.onProgress((m) => setBusy(m))
  }, [])
  const chosen = (hg || []).filter((x) => pick[x.path])
  async function go() {
    if (chosen.some((x) => haveSet.has(x.name.toLowerCase())) && !confirm('Some of these are already in Bridge Report. Re-importing replaces them. Continue?')) return
    setBusy('Importing…')
    const res = await api.importHgFills(chosen.map((x) => x.path))
    setBusy('')
    setResult(res.map((x) => x.error ? `✖ ${x.name}: ${x.error}` : `✔ ${x.name} — ${x.photos} photo(s)${x.missing ? `, ${x.missing} photo(s) HomeGauge didn't keep with the fill were left out` : ''}`).join('\n'))
  }
  if (result !== null) return (
    <Modal title="Import HomeGauge Report Fills" onClose={() => onClose(chosen[0]?.name)} footer={<button className="primary" onClick={() => onClose(chosen[0]?.name)}>OK</button>}>
      <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{result}</div>
    </Modal>
  )
  return (
    <Modal title="Import HomeGauge Report Fills" onClose={() => onClose()}
      footer={<><span className="hint grow">{busy}</span><button className="primary" disabled={!chosen.length || !!busy} onClick={go}>Import {chosen.length || ''}</button><button onClick={() => onClose()}>Cancel</button></>}>
      {hg === null ? <div className="muted">Looking for HomeGauge…</div> : !hg.length ? <div className="muted">No HomeGauge report fills were found on this PC (AppData\Local\HomeGauge\AutoFill).</div> : <>
        <div className="muted small">From AppData\Local\HomeGauge\AutoFill. Ratings, comments, S&amp;M and the photos HomeGauge saved with each fill are copied; HomeGauge itself is not changed.</div>
        <div className="list-box">
          {hg.map((x) => (
            <label key={x.path} className="li row">
              <input type="checkbox" checked={!!pick[x.path]} onChange={(e) => setPick({ ...pick, [x.path]: e.target.checked })} />
              <span className="grow">{x.name}</span>
              {haveSet.has(x.name.toLowerCase()) && <span className="merge-badge">already imported</span>}
              <span className="muted small">{new Date(x.updated).toLocaleDateString()}</span>
            </label>
          ))}
        </div>
      </>}
    </Modal>
  )
}
