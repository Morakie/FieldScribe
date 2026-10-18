import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Report, Settings, ReportRow } from '../types'
import { api, debounce } from '../util'
import { EditorCtx, TreeLink, type Ctx, type Sel } from './Editor'
import ReportInfoView, { CustomerView } from './InfoView'
import MiscView from './MiscView'
import Split from './Split'
import { usDate } from './ReportsList'

type Pane = 'home' | 'customer' | 'info' | 'misc' | 'template'
const DRAFT_KEY = 'draftReport'

/**
 * The page the app opens on, like HomeGauge's: fill in Customer / Report Info / Misc first if you like,
 * then Select Report Template to start the report.
 */
export default function StartPage({ onOpen, onOpenList, startPane }: { onOpen: (id: string) => void; onOpenList: () => void; startPane?: Pane }) {
  const ref = useRef<Report | null>(null)
  const [version, setVersion] = useState(0)
  const [pane, setPane] = useState<Pane>(startPane || 'home')
  const [settings, setSettings] = useState<Settings | null>(null)
  useEffect(() => {
    api.getSettings().then(setSettings)
    let saved: Report | null = null
    try { saved = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null') } catch {}
    if (saved?.draft) { ref.current = saved; setVersion(1) } else newDraft()
  }, [])
  const persist = useMemo(() => debounce(() => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(ref.current)) } catch {} }, 400), [])
  async function newDraft() {
    ref.current = await api.newDraft()
    try { localStorage.removeItem(DRAFT_KEY) } catch {}
    setVersion((v) => v + 1)
  }
  const mutate = useCallback((fn: (r: Report) => void) => { if (!ref.current) return; fn(ref.current); setVersion((v) => v + 1); persist() }, [persist])
  const saveSettings = useCallback((st: Settings) => { setSettings(st); api.saveSettings(st) }, [])

  const r = ref.current
  if (!r) return <div className="loading">Loading…</div>
  const ctx: Ctx = {
    r, mutate, dir: '', sel: { kind: 'customer' } as Sel, setSel: () => {}, editTemplate: () => {}, version, settings, saveSettings,
  }
  const c = r.clients[0] || { first: '', last: '' }
  const started = !!(c.first || c.last || r.inspection.address || r.people.length || r.services.some((s) => s.selected))

  async function start(template: string) {
    const id = await api.createFromDraft(template, ref.current!)
    try { localStorage.removeItem(DRAFT_KEY) } catch {}
    onOpen(id)
  }

  return (
    <EditorCtx.Provider value={ctx}>
      <div className="editor start">
        <div className="toolbar">
          <div className="brand">Bridge <b>Report</b></div>
          <button onClick={() => setPane('customer')}>New</button>
          <button onClick={onOpenList}>Open</button>
          <span className="sep" />
          <span className="muted">{started ? `New report: ${[c.last, c.first].filter(Boolean).join(', ') || r.inspection.address}` : 'No customer name yet'}</span>
          <span className="grow" />
          {started && <button onClick={() => { if (confirm('Clear everything typed on this start page?')) { newDraft(); setPane('customer') } }}>Clear</button>}
          <button className="primary" onClick={() => setPane('template')}>Select Report Template ▶</button>
        </div>
        <div className="panes">
          <Split id="start-tree" dir="h" initial={300} min={180} max={520}>{[
            <nav key="t" className="tree">
              <div className="tree-head">Sections</div>
              <TreeLink active={pane === 'customer'} onClick={() => setPane('customer')} icon="👤" strong>Customer</TreeLink>
              <TreeLink active={pane === 'info'} onClick={() => setPane('info')} icon="🏷" strong>Report Info</TreeLink>
              <TreeLink active={pane === 'misc'} onClick={() => setPane('misc')} icon="▦" strong>Misc</TreeLink>
              <TreeLink active={pane === 'template'} onClick={() => setPane('template')} icon="📄" strong>Select Report Template</TreeLink>
            </nav>,
            <main key="m" className="center">
              {pane === 'home' && <Home onOpen={onOpen} onOpenList={onOpenList} onNew={() => setPane('customer')} />}
              {pane === 'customer' && <CustomerView />}
              {pane === 'info' && <ReportInfoView />}
              {pane === 'misc' && <MiscView />}
              {pane === 'template' && <TemplatePicker onStart={start} />}
            </main>,
          ]}</Split>
        </div>
      </div>
    </EditorCtx.Provider>
  )
}

/** Empty-ish center of the start page: recent reports to jump back into. */
function Home({ onOpen, onOpenList, onNew }: { onOpen: (id: string) => void; onOpenList: () => void; onNew: () => void }) {
  const [rows, setRows] = useState<ReportRow[] | null>(null)
  useEffect(() => { api.listReports().then((l) => setRows([...l].sort((a, b) => (b.updated || '').localeCompare(a.updated || '')).slice(0, 12))) }, [])
  return (
    <div className="start-home">
      <div className="start-card">
        <h2>Bridge <b>Report</b></h2>
        <p className="muted">Start a new report with <b>Customer</b>, <b>Report Info</b> and <b>Misc</b> on the left, then <b>Select Report Template</b>. Or open one you already have.</p>
        <div className="row"><button className="primary" onClick={onNew}>New Report</button><button onClick={onOpenList}>Open Report…</button></div>
      </div>
      <div className="start-recent">
        <h3>Recently worked on</h3>
        {rows === null ? <div className="muted">Loading…</div> : !rows.length ? <div className="muted">No reports yet.</div> :
          rows.map((x) => (
            <div key={x.id} className="recent-row" onDoubleClick={() => onOpen(x.id)} onClick={() => onOpen(x.id)} title="Open this report">
              <b>{x.address || x.reportNumber}</b>
              <span className="muted">{[x.client, usDate(x.date), x.agent].filter(Boolean).join(' · ')}</span>
            </div>
          ))}
        {rows && rows.length > 0 && <button className="link" onClick={onOpenList}>All reports…</button>}
      </div>
    </div>
  )
}

function TemplatePicker({ onStart }: { onStart: (t: string) => void }) {
  type Mine = Awaited<ReturnType<typeof api.templateInfo>>[number]
  type Hg = Awaited<ReturnType<typeof api.hgTemplates>>[number]
  const [mine, setMine] = useState<Mine[] | null>(null)
  const [hg, setHg] = useState<Hg[]>([])
  const [pick, setPick] = useState<string>(() => { try { return JSON.parse(localStorage.getItem('newReportDefaults') || '{}').template || '' } catch { return '' } })
  const [busy, setBusy] = useState('')
  const load = async () => {
    const [m, h] = await Promise.all([api.templateInfo(), api.hgTemplates()])
    setMine(m); setHg(h)
    setPick((p) => (m.some((x) => x.name === p) ? p : m[0]?.name || ''))
  }
  useEffect(() => { load() }, [])
  const have = new Set((mine || []).map((m) => m.name.toLowerCase()))
  async function importHg(paths: string[]) {
    setBusy('Importing… large templates take a few seconds.')
    try { const names = await api.importTemplateFiles(paths); await load(); if (names[0]) setPick(names[0]) } finally { setBusy('') }
  }
  async function go() {
    if (!pick) return
    try { localStorage.setItem('newReportDefaults', JSON.stringify({ ...JSON.parse(localStorage.getItem('newReportDefaults') || '{}'), template: pick })) } catch {}
    setBusy('Starting the report…'); onStart(pick)
  }
  return (
    <div className="pad tpl-pick">
      <h3>Select Report Template</h3>
      {mine === null ? <div className="muted">Loading…</div> : <>
        <div className="tpl-list">
          {mine.map((t) => (
            <label key={t.name} className={'tpl-row' + (pick === t.name ? ' on' : '')} onDoubleClick={go}>
              <input type="radio" name="tpl" checked={pick === t.name} onChange={() => setPick(t.name)} />
              <div><b>{t.name}</b><div className="muted small">{t.sections} sections · {t.comments.toLocaleString()} comments · updated {new Date(t.updated).toLocaleDateString()}</div></div>
            </label>
          ))}
          {!mine.length && <div className="muted">No templates yet. Import one from HomeGauge below.</div>}
        </div>
        <div className="row"><button className="primary big" disabled={!pick || !!busy} onClick={go}>Start Report With “{pick || '…'}”</button>
          <button onClick={async () => { const n = await api.importTemplate(); if (n.length) { await load(); setPick(n[0]) } }}>Import .ht5 file…</button></div>
        {busy && <div className="notice" style={{ marginTop: 10 }}>{busy}</div>}
        {hg.length > 0 && <>
          <h4 style={{ marginTop: 24 }}>HomeGauge templates on this PC</h4>
          <p className="muted small">Importing copies the template's sections, items, comments and Smart Text into Bridge Report. Re-importing one you already have replaces it (edits you made in Bridge Report to that template would be lost).</p>
          <table className="grid narrow">
            <thead><tr><th>Template</th><th>Folder</th><th>Last changed</th><th /></tr></thead>
            <tbody>{hg.map((t) => (
              <tr key={t.path}>
                <td>{t.name}</td><td className="muted">{t.folder || '—'}</td><td>{new Date(t.updated).toLocaleDateString()}</td>
                <td>{have.has(t.name.toLowerCase())
                  ? <button disabled={!!busy} onClick={() => confirm(`Re-import "${t.name}" from HomeGauge? This replaces the Bridge Report copy.`) && importHg([t.path])}>Re-import</button>
                  : <button className="primary" disabled={!!busy} onClick={() => importHg([t.path])}>Import</button>}</td>
              </tr>))}
            </tbody>
          </table>
          {hg.some((t) => !have.has(t.name.toLowerCase())) && <button style={{ marginTop: 8 }} disabled={!!busy} onClick={() => importHg(hg.filter((t) => !have.has(t.name.toLowerCase())).map((t) => t.path))}>Import all new ({hg.filter((t) => !have.has(t.name.toLowerCase())).length})</button>}
        </>}
      </>}
    </div>
  )
}
