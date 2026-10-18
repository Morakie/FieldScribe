import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { Report, Section, Instance, TemplateFile, Settings } from '../types'
import { api, debounce, instanceProgress, sectionNumber } from '../util'
import ItemsView from './ItemsView'
import MaterialsView from './MaterialsView'
import OverviewView from './OverviewView'
import ComponentsView from './ComponentsView'
import ReportInfoView, { CustomerView } from './InfoView'
import GeneralInfoView from './GeneralInfoView'
import MiscView from './MiscView'
import SummaryView from './SummaryView'
import PhotoPanel from './PhotoPanel'
import PreviewModal from './PreviewModal'
import MergeModal from './MergeModal'
import { applyFillTo, type FillMode } from '../fills'
import Split, { resetAllSplits } from './Split'
import PhotoEditor from './PhotoEditor'
import { ColumnHeadersModal, CommentsManager, FillsModal, SaveTemplateAsModal, SpellCheckModal } from './EditorTools'
import type { Photo, ItemAnswer } from '../types'

export type Sel =
  | { kind: 'info' } | { kind: 'customer' } | { kind: 'misc' } | { kind: 'general' } | { kind: 'summary' }
  | { kind: 'group'; group: string }
  | { kind: 'section'; sectionId: string; instanceId: string; tab: 'items' | 'materials' | 'overview'; itemIdx: number; entryIdx: number }

export interface Ctx {
  r: Report
  mutate: (fn: (r: Report) => void) => void
  dir: string
  sel: Sel
  setSel: (s: Sel) => void
  /** apply a change to the report's template copy AND the saved template file (comments, options, items) */
  editTemplate: (fn: (t: Report['template'] | TemplateFile) => void) => void
  version: number
  settings: Settings | null
  saveSettings: (s: Settings) => void
}
export const EditorCtx = createContext<Ctx>(null as any)
export const useEditor = () => useContext(EditorCtx)

export function currentSection(r: Report, sel: Sel): { section: Section; instance: Instance } | null {
  if (sel.kind !== 'section') return null
  const section = r.sections.find((s) => s.id === sel.sectionId)
  const instance = section?.instances.find((i) => i.id === sel.instanceId) || section?.instances[0]
  return section && instance ? { section, instance } : null
}

export default function Editor({ reportId, onClose }: { reportId: string; onClose: () => void }) {
  const ref = useRef<Report | null>(null)
  const [version, setVersion] = useState(0)
  const [dir, setDir] = useState('')
  const [sel, setSel] = useState<Sel>({ kind: 'info' })
  const [saveState, setSaveState] = useState<'saved' | 'unsaved' | 'saving' | 'error'>('saved')
  const [preview, setPreview] = useState(false)
  const [settings, setSettingsState] = useState<Settings | null>(null)
  useEffect(() => { api.getSettings().then(setSettingsState) }, [])
  const saveSettings = useCallback((st: Settings) => { setSettingsState(st); api.saveSettings(st) }, [])
  const [layoutKey, setLayoutKey] = useState(0)
  const [show, setShow] = useState<{ tree: boolean; photos: boolean }>(() => {
    try { return { tree: true, photos: true, ...JSON.parse(localStorage.getItem('panels') || '{}') } } catch { return { tree: true, photos: true } }
  })
  const togglePanel = (k: 'tree' | 'photos') => setShow((v) => { const n = { ...v, [k]: !v[k] }; try { localStorage.setItem('panels', JSON.stringify(n)) } catch {}; return n })
  const menuHandler = useRef<(cmd: string) => void>(() => {})
  const [tool, setTool] = useState<null | 'fillApply' | 'fillSave' | 'spell' | 'columns' | 'comments' | 'saveTpl' | 'merge'>(null)
  const [queue, setQueue] = useState<{ list: { photo: Photo; go: Sel }[]; i: number } | null>(null)
  const [showStatus, setShowStatus] = useState(() => { try { return localStorage.getItem('statusBar') !== '0' } catch { return true } })
  const lastSM = useRef(-1)
  useEffect(() => {
    const f = (e: Event) => menuHandler.current((e as CustomEvent).detail)
    window.addEventListener('bridge-menu', f)
    return () => window.removeEventListener('bridge-menu', f)
  }, [])

  const save = useMemo(() => debounce(async () => {
    if (!ref.current) return
    setSaveState('saving')
    try { await api.saveReport(ref.current); setSaveState('saved') } catch { setSaveState('error') }
  }, 700), [])

  useEffect(() => {
    Promise.all([api.loadReport(reportId), api.reportDir(reportId)]).then(([r, d]) => {
      // older imports stored the HomeGauge file path as the template name
      if (/[\\/]/.test(r.template.name)) r.template.name = r.template.name.split(/[\\/]/).pop()!.replace(/\.ht5$/i, '')
      // reports imported before placeholders were supported point at HomeGauge's "placeholder.jpg"
      for (const sec of r.sections) for (const inst of sec.instances) for (const it of inst.items) for (const en of it.entries)
        for (const ph of en.photos) if (/^placeholder\.(jpe?g|png)$/i.test(ph.file || '')) { ph.file = ''; ph.placeholder = true }
      ref.current = r; setDir(d)
      const first = r.sections.find((s) => !s.excluded)
      if (first) setSel({ kind: 'section', sectionId: first.id, instanceId: first.instances[0].id, tab: 'items', itemIdx: 0, entryIdx: 0 })
      setVersion(1)
      // a report fill picked on the Start page is applied once the new report opens
      let pending: { name: string; mode: FillMode } | null = null
      try { pending = JSON.parse(sessionStorage.getItem('pendingFill:' + reportId) || 'null'); sessionStorage.removeItem('pendingFill:' + reportId) } catch {}
      if (pending) applyFillTo(r, pending.name, pending.mode, () => save.flush(), mutate).then((m) => setTimeout(() => alert(m), 50)).catch((e) => alert('The report fill could not be applied: ' + (e?.message || e)))
    })
    return () => save.flush()
  }, [reportId])

  const mutate = useCallback((fn: (r: Report) => void) => {
    if (!ref.current) return
    fn(ref.current)
    setVersion((v) => v + 1)
    setSaveState('unsaved')
    save()
  }, [save])

  const editTemplate = useCallback((fn: (t: any) => void) => {
    mutate((r) => fn(r.template))
    const name = ref.current?.template.name
    if (name) api.loadTemplate(name).then((T) => { fn(T); return api.saveTemplate(name, T) }).catch(() => {})
  }, [mutate])

  const r = ref.current
  if (!r) return <div className="loading">Loading report…</div>

  const ctx: Ctx = { r, mutate, dir, sel, setSel, editTemplate, version, settings, saveSettings }
  const cur = currentSection(r, sel)

  function findUnanswered() {
    const order = r!.sections.filter((s) => !s.excluded).flatMap((s) => s.instances.map((inst) => ({ s, inst })))
    const start = cur ? order.findIndex((o) => o.inst.id === cur.instance.id) : -1
    for (let k = 0; k < order.length; k++) {
      const o = order[(Math.max(start, 0) + k) % order.length]
      const from = o.inst.id === cur?.instance.id && sel.kind === 'section' ? sel.itemIdx + 1 : 0
      const idx = o.inst.items.findIndex((it, i) => i >= from && !it.excluded && !it.ratings.length)
      if (idx >= 0) return setSel({ kind: 'section', sectionId: o.s.id, instanceId: o.inst.id, tab: 'items', itemIdx: idx, entryIdx: 0 })
    }
    alert('Every item has a rating.')
  }

  /** Back / Next through every item of every included section, like HomeGauge. */
  function step(d: number) {
    const flat = r!.sections.filter((s) => !s.excluded).flatMap((s) => s.instances.flatMap((inst) => inst.items.map((_, i) => ({ s, inst, i }))))
    if (!flat.length) return
    const at = sel.kind === 'section' ? flat.findIndex((x) => x.inst.id === cur?.instance.id && x.i === sel.itemIdx) : -1
    const n = flat[Math.max(0, Math.min(flat.length - 1, at < 0 ? 0 : at + d))]
    setSel({ kind: 'section', sectionId: n.s.id, instanceId: n.inst.id, tab: 'items', itemIdx: n.i, entryIdx: 0 })
  }
  // ---- Go menu finders ----
  const flatItems = () => r!.sections.filter((s) => !s.excluded).flatMap((s) => s.instances.flatMap((inst) => inst.items.map((it, i) => ({ s, inst, i, it }))))
  function findItem(pred: (it: ItemAnswer) => boolean, fromStart: boolean, what: string) {
    const list = flatItems()
    const cur = sel.kind === 'section' ? list.findIndex((x) => x.inst.id === sel.instanceId && x.i === sel.itemIdx) : -1
    const start = fromStart ? -1 : cur
    for (let k = 1; k <= list.length; k++) {
      const x = list[(start + k + list.length) % list.length]
      if (!x.it.excluded && pred(x.it)) {
        const entryIdx = Math.max(0, x.it.entries.findIndex((e) => e.photos.length))
        return setSel({ kind: 'section', sectionId: x.s.id, instanceId: x.inst.id, tab: 'items', itemIdx: x.i, entryIdx: what === 'photo' ? entryIdx : 0 })
      }
    }
    alert(`No ${what === 'photo' ? 'photos' : what === 'flag' ? 'flagged items' : 'unanswered items'} found.`)
  }
  function findSM(fromStart: boolean) {
    const list = r!.sections.filter((s) => !s.excluded).flatMap((s) => s.instances.flatMap((inst) => inst.materials.map((a) => ({ s, inst, a }))))
    const start = fromStart ? -1 : lastSM.current
    for (let k = 1; k <= list.length; k++) {
      const idx = (start + k + list.length) % list.length, x = list[idx]
      if (!x.a.excluded && !x.a.selected.length) {
        lastSM.current = idx
        setSel({ kind: 'section', sectionId: x.s.id, instanceId: x.inst.id, tab: 'materials', itemIdx: 0, entryIdx: 0 })
        setTimeout(() => window.dispatchEvent(new CustomEvent('bridge-sm-select', { detail: x.a.materialId })), 80)
        return
      }
    }
    alert('Every Style & Material has a selection.')
  }
  function editAllPhotos(fromCurrent: boolean) {
    const list: { photo: Photo; go: Sel }[] = []
    let startAt = 0
    r!.sections.filter((s) => !s.excluded).forEach((s) => s.instances.forEach((inst) => inst.items.forEach((it, itemIdx) => it.entries.forEach((e, entryIdx) => e.photos.filter((p) => !p.placeholder).forEach((p) => {
      if (fromCurrent && sel.kind === 'section' && inst.id === sel.instanceId && itemIdx === sel.itemIdx && !startAt) startAt = list.length || -1
      list.push({ photo: p, go: { kind: 'section', sectionId: s.id, instanceId: inst.id, tab: 'items', itemIdx, entryIdx } })
    })))))
    if (!list.length) return alert('This report has no photos yet.')
    const i = fromCurrent ? Math.max(0, startAt) : 0
    setSel(list[i].go); setQueue({ list, i })
  }
  function nextInQueue(d = 1) {
    if (!queue) return
    const i = queue.i + d
    if (i >= queue.list.length) { setQueue(null); return }
    setSel(queue.list[i].go); setQueue({ ...queue, i })
  }
  async function dataSizes() {
    const d = await api.dataSizes(r!.id)
    const mb = (n: number) => (n / 1048576).toFixed(1) + ' MB'
    alert(`Report data sizes\n\nPhotos in report: ${d.photos.c} — ${mb(d.photos.n)}\nHigh-res originals (stay on this PC): ${d.originals.c} — ${mb(d.originals.n)}\nAttachments: ${d.attachments.c} — ${mb(d.attachments.n)}\nReport data: ${mb(d.data.n)}${r!.uploadCompressed ? `\n\nPhotos already compressed for upload (${r!.uploadCompressed}px).` : ''}`)
  }

  menuHandler.current = (cmd: string) => {
    if (cmd === 'save') save.flush()
    else if (cmd === 'close') { save.flush(); onClose() }
    else if (cmd === 'preview' || cmd === 'pdf') { save.flush(); setPreview(true) }
    else if (cmd === 'next') step(1)
    else if (cmd === 'back') step(-1)
    else if (cmd === 'findUnanswered') findUnanswered()
    else if (cmd === 'findFirstUnanswered') findItem((it) => !it.ratings.length, true, 'unanswered')
    else if (cmd === 'findFirstSM') findSM(true)
    else if (cmd === 'findNextSM') findSM(false)
    else if (cmd === 'findFirstFlag') findItem((it) => !!it.flagged, true, 'flag')
    else if (cmd === 'findNextFlag') findItem((it) => !!it.flagged, false, 'flag')
    else if (cmd === 'findFirstPhoto') findItem((it) => it.entries.some((e) => e.photos.some((p) => !p.placeholder)), true, 'photo')
    else if (cmd === 'findNextPhoto') findItem((it) => it.entries.some((e) => e.photos.some((p) => !p.placeholder)), false, 'photo')
    else if (cmd === 'editPhotosStart') editAllPhotos(false)
    else if (cmd === 'editPhotosCurrent') editAllPhotos(true)
    else if (cmd === 'customer') setSel({ kind: 'customer' })
    else if (cmd === 'applyFill') setTool('fillApply')
    else if (cmd === 'saveFill') setTool('fillSave')
    else if (cmd === 'spellCheck') setTool('spell')
    else if (cmd === 'columnHeaders') setTool('columns')
    else if (cmd === 'allComments' || cmd === 'exportComments' || cmd === 'importComments') setTool('comments')
    else if (cmd === 'saveTemplateAs') setTool('saveTpl')
    else if (cmd === 'mergeInto') setTool('merge')
    else if (cmd === 'dataSizes') dataSizes()
    else if (cmd === 'photoLocker') api.photoLocker(r!.id)
    else if (cmd === 'cya') { if (!show.photos) togglePanel('photos'); window.dispatchEvent(new CustomEvent('bridge-photo-tab', { detail: 'lib' })) }
    else if (cmd === 'toggleStatus') setShowStatus((v) => { try { localStorage.setItem('statusBar', v ? '0' : '1') } catch {}; return !v })
    else if (cmd === 'summary') setSel({ kind: 'summary' })
    else if (cmd === 'info') setSel({ kind: 'info' })
    else if (cmd === 'compress') compress()
    else if (cmd === 'toggleTree') togglePanel('tree')
    else if (cmd === 'togglePhotos') togglePanel('photos')
    else if (cmd === 'resetLayout') { resetAllSplits(); setShow({ tree: true, photos: true }); try { localStorage.removeItem('panels') } catch {}; setLayoutKey((k) => k + 1) }
  }

  async function compress() {
    const edge = settings?.photos.uploadEdge || 640
    if (!confirm(`Shrink this report's photos to ${edge}px for uploading?\n\nPhotos already at or below that size are left alone, so running this again does nothing. The full-size originals stay on this computer for editing.`)) return
    save.flush()
    const res = await api.compressForUpload(r!.id, edge)
    mutate((rr) => { rr.uploadCompressed = edge })
    const mb = (n: number) => (n / 1048576).toFixed(1) + ' MB'
    alert(res.changed ? `Compressed ${res.changed} photo(s): ${mb(res.before)} → ${mb(res.after)}.` : 'All photos were already at upload size — nothing to do.')
  }

  const groups = [...new Set(r.sections.map((s) => s.group))]
  const title = [r.clients[0]?.last, r.clients[0]?.first].filter(Boolean).join(', ') + ' — ' + (r.reportNumber || r.inspection.address)

  return (
    <EditorCtx.Provider value={ctx}>
      <div className="editor">
        <div className="toolbar">
          <button onClick={() => { save.flush(); onClose() }} title="Close this report and go to the reports list">← Reports</button>
          <div className="doc-title">{title}</div>
          <span className={'save ' + saveState}>{{ saved: 'Saved', unsaved: 'Unsaved…', saving: 'Saving…', error: 'Save failed!' }[saveState]}</span>
          <span className="grow" />
          <button onClick={() => step(-1)} title="Previous item (Alt+←)">◀ Back</button>
          <button onClick={() => step(1)} title="Next item (Alt+→)">Next ▶</button>
          <button onClick={findUnanswered} title="Jump to the next item with no rating (F3)">Find Unanswered</button>
          <button className="primary" onClick={() => { save.flush(); setPreview(true) }}>Preview / PDF</button>
        </div>
        <div className="panes" key={layoutKey}>
          {(() => {
            const tree = (
          <nav className="tree">
            <TreeLink active={sel.kind === 'customer'} onClick={() => setSel({ kind: 'customer' })} icon="👤" strong>Customer</TreeLink>
            <TreeLink active={sel.kind === 'info'} onClick={() => setSel({ kind: 'info' })} icon="🏷" strong>Report Info</TreeLink>
            <TreeLink active={sel.kind === 'misc'} onClick={() => setSel({ kind: 'misc' })} icon="▦" strong>Misc</TreeLink>
            <TreeLink active={sel.kind === 'general'} onClick={() => setSel({ kind: 'general' })} icon="📄" strong>General Info</TreeLink>
            {groups.map((g) => (
              <div key={g} className="tree-group">
                <TreeLink active={sel.kind === 'group' && sel.group === g} onClick={() => setSel({ kind: 'group', group: g })} icon="🏠" strong>{g}</TreeLink>
                {r.sections.filter((s) => s.group === g).map((s) => (
                  <div key={s.id}>
                    {s.instances.map((inst, ii) => {
                      const p = instanceProgress(inst)
                      const active = cur?.instance.id === inst.id
                      const label = ii > 0 ? `↳ ${inst.name}` : inst.name !== s.name ? `${s.name} · ${inst.name}` : s.name
                      return (
                        <div key={inst.id}
                          className={'tree-sec' + (active ? ' active' : '') + (s.excluded ? ' excluded' : '') + (ii > 0 ? ' dup' : '')}
                          onClick={() => setSel({ kind: 'section', sectionId: s.id, instanceId: inst.id, tab: sel.kind === 'section' ? sel.tab : 'items', itemIdx: 0, entryIdx: 0 })}>
                          <span className={'check' + (p.done === p.total && p.total ? ' done' : '')}>{p.done === p.total && p.total ? '✔' : `${p.done}/${p.total}`}</span>
                          {ii === 0 && <span className="num">{sectionNumber(r, s)}</span>}
                          <span>{label}</span>
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>
            ))}
            <TreeLink active={sel.kind === 'summary'} onClick={() => setSel({ kind: 'summary' })} icon="✔" strong>Summary</TreeLink>
          </nav>)
            const center = (
          <main className="center">
            {sel.kind === 'customer' && <CustomerView />}
            {sel.kind === 'info' && <ReportInfoView />}
            {sel.kind === 'misc' && <MiscView />}
            {sel.kind === 'general' && <GeneralInfoView />}
            {sel.kind === 'summary' && <SummaryView />}
            {sel.kind === 'group' && <ComponentsView group={sel.group} />}
            {cur && sel.kind === 'section' && (
              <>
                <div className="tabs">
                  {(['items', 'materials', 'overview'] as const).map((t) => (
                    <button key={t} className={sel.tab === t ? 'on' : ''} onClick={() => setSel({ ...sel, tab: t })}>
                      {{ items: '▦ Inspection Items', materials: '☰ Styles & Materials', overview: '⌂ Overview' }[t]}
                    </button>
                  ))}
                  <div className="crumb">{cur.section.group} : <b>{cur.instance.name}</b>
                    <label className={'sec-ex' + (cur.section.excluded ? ' on' : '')} title="Leave this whole section out of the report">
                      <input type="checkbox" checked={cur.section.excluded} onChange={(e) => mutate(() => { cur.section.excluded = e.target.checked })} /> Exclude section from report
                    </label>
                  </div>
                </div>
                {sel.tab === 'items' && <ItemsView key={cur.instance.id} section={cur.section} instance={cur.instance} />}
                {sel.tab === 'materials' && <MaterialsView key={cur.instance.id} section={cur.section} instance={cur.instance} />}
                {sel.tab === 'overview' && <OverviewView key={cur.instance.id} instance={cur.instance} />}
              </>
            )}
          </main>)
            const withPhotos = show.photos
              ? <Split id="photos" dir="h" initial={380} min={220} max={900} fixed="second">{[center, <PhotoPanel key="pp" />]}</Split>
              : center
            return show.tree ? <Split id="tree" dir="h" initial={260} min={160} max={520}>{[tree, withPhotos]}</Split> : withPhotos
          })()}
        </div>
        {showStatus && <StatusBar saveState={saveState} />}
        {preview && <PreviewModal onClose={() => setPreview(false)} />}
        {tool === 'fillApply' && <FillsModal mode="apply" flush={() => save.flush()} onClose={() => setTool(null)} />}
        {tool === 'fillSave' && <FillsModal mode="save" flush={() => save.flush()} onClose={() => setTool(null)} />}
        {tool === 'spell' && <SpellCheckModal onClose={() => setTool(null)} />}
        {tool === 'columns' && <ColumnHeadersModal onClose={() => setTool(null)} />}
        {tool === 'comments' && <CommentsManager onClose={() => setTool(null)} />}
        {tool === 'saveTpl' && <SaveTemplateAsModal onClose={() => setTool(null)} />}
        {tool === 'merge' && <MergeModal onClose={() => setTool(null)} flush={() => save.flush()} />}
        {queue && <PhotoEditor key={queue.list[queue.i].photo.file + queue.i} photo={queue.list[queue.i].photo}
          title={`Edit All Photos — ${queue.i + 1} of ${queue.list.length}`} onSkip={() => nextInQueue(1)}
          onClose={() => setQueue(null)} onSaved={(patch) => { mutate(() => { Object.assign(queue.list[queue.i].photo, patch) }); nextInQueue(1) }} />}
      </div>
    </EditorCtx.Provider>
  )
}

function StatusBar({ saveState }: { saveState: string }) {
  const { r } = useEditor()
  const items = r.sections.filter((s) => !s.excluded).flatMap((s) => s.instances.flatMap((i) => i.items.filter((it) => !it.excluded)))
  const done = items.filter((it) => it.ratings.length).length
  const photos = items.reduce((n, it) => n + it.entries.reduce((m, e) => m + e.photos.filter((p) => !p.placeholder).length, 0), 0)
  const flagged = items.filter((it) => it.flagged).length
  return (
    <div className="statusbar ed-status">
      <span>Report progress: <b>{items.length ? Math.round((done / items.length) * 100) : 0}%</b> ({done}/{items.length} items)</span>
      <span>Photos: <b>{photos}</b></span>
      {flagged > 0 && <span>Flagged: <b>{flagged}</b></span>}
      <span>Template: {r.template.name}</span>
      {r.uploadCompressed ? <span>Photos compressed for upload</span> : null}
      <span className="grow" />
      <span>{saveState === 'saved' ? 'All changes saved' : saveState === 'error' ? 'Save failed!' : 'Saving…'}</span>
    </div>
  )
}

export function TreeLink({ active, onClick, icon, children, strong }: any) {
  return <div className={'tree-link' + (active ? ' active' : '') + (strong ? ' strong' : '')} onClick={onClick}><span className="ico">{icon}</span>{children}</div>
}
