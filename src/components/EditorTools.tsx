import { useEffect, useMemo, useState } from 'react'
import type { Comment, LibFolder, RatingColumn, Report, TemplateFile } from '../types'
import Modal from './Modal'
import { useEditor } from './Editor'
import { EditComment } from './CommentPicker'
import { api, htmlToText, uid } from '../util'

/* =========================== Report Fills =========================== */
// A fill is a saved set of "starting answers" (ratings, comments, S&M picks) keyed by section/item,
// e.g. "Standard newer home – all good". Applying it only fills blanks unless you choose overwrite.
type Fill = { version: 1; sections: Record<string, Record<number, { items: Record<string, any>; materials: Record<string, any> }>>; general: Record<string, any> }

export function makeFill(r: Report): Fill {
  const f: Fill = { version: 1, sections: {}, general: {} }
  for (const s of r.sections) {
    f.sections[`${s.group}/${s.name}`] = Object.fromEntries(s.instances.map((inst, k) => [k, {
      items: Object.fromEntries(inst.items.map((it) => [it.itemId, { ratings: it.ratings, excluded: it.excluded, entries: it.entries.map((e) => ({ html: e.html, summary: e.summary })) }])),
      materials: Object.fromEntries(inst.materials.map((m) => [m.materialId, { selected: m.selected, extraInfo: m.extraInfo, excluded: !!m.excluded }])),
    }]))
  }
  for (const m of r.generalInfo.materials) f.general[m.materialId] = { selected: m.selected, extraInfo: m.extraInfo, excluded: !!m.excluded }
  return f
}
function applyFill(r: Report, f: Fill, overwrite: boolean) {
  let n = 0
  for (const s of r.sections) {
    const fs = f.sections[`${s.group}/${s.name}`]
    if (!fs) continue
    s.instances.forEach((inst, k) => {
      const fi = fs[k] || fs[0]
      if (!fi) return
      for (const it of inst.items) {
        const src = fi.items[it.itemId]
        if (!src || (!src.ratings.length && !src.entries.length)) continue
        if (!overwrite && (it.ratings.length || it.entries.length)) continue
        it.ratings = [...src.ratings]; it.excluded = src.excluded
        it.entries = src.entries.map((e: any) => ({ id: uid(), html: e.html, summary: e.summary, photos: [] })); n++
      }
      for (const m of inst.materials) {
        const src = fi.materials[m.materialId]
        if (!src || (!overwrite && m.selected.length)) continue
        m.selected = [...src.selected]; m.extraInfo = src.extraInfo; m.excluded = src.excluded; n++
      }
    })
  }
  for (const m of r.generalInfo.materials) {
    const src = f.general[m.materialId]
    if (!src || (!overwrite && m.selected.length)) continue
    m.selected = [...src.selected]; m.extraInfo = src.extraInfo; m.excluded = src.excluded; n++
  }
  return n
}

export function FillsModal({ mode, onClose }: { mode: 'apply' | 'save'; onClose: () => void }) {
  const { r, mutate } = useEditor()
  const [list, setList] = useState<string[]>([])
  const [sel, setSel] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [msg, setMsg] = useState('')
  const load = () => api.listFills().then(setList)
  useEffect(() => { load() }, [])
  async function apply(overwrite: boolean) {
    if (!sel) return
    const f = await api.loadFill(sel)
    let n = 0
    mutate((rr) => { n = applyFill(rr, f, overwrite) })
    setMsg(`Applied "${sel}" — ${n} item(s) / list(s) filled.`)
  }
  async function save(target: string) {
    if (!target.trim()) return
    if (list.includes(target) && !confirm(`Replace the existing fill "${target}" with this report's answers?`)) return
    await api.saveFill(target.trim(), makeFill(r)); setMsg(`Saved fill "${target}".`); setName(''); load()
  }
  return (
    <Modal title={mode === 'apply' ? 'Apply Report Fill' : 'Save Report Fill'} onClose={onClose} wide
      footer={<><span className="hint">{msg}</span><span className="grow" /><button onClick={onClose}>Close</button></>}>
      <p className="muted small">A report fill stores this report's ratings, comment text and Styles &amp; Materials (no photos) so you can stamp them onto another report as a starting point — e.g. “Newer home – all functional”.</p>
      <div className="fills">
        <div className="list-box" style={{ minHeight: 220 }}>
          {list.map((f) => <div key={f} className={'li' + (f === sel ? ' sel' : '')} onClick={() => setSel(f)} onDoubleClick={() => mode === 'apply' && setSel(f)}>{f}</div>)}
          {!list.length && <div className="muted pad-s">No fills saved yet.</div>}
        </div>
        <div className="fill-actions">
          {mode === 'apply' ? <>
            <button className="primary" disabled={!sel} onClick={() => apply(false)}>Apply — fill blanks only</button>
            <button disabled={!sel} onClick={() => { if (confirm('Overwrite answers already in this report?')) apply(true) }}>Apply — overwrite</button>
          </> : <>
            <label className="field"><span>New fill name</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Newer home – all functional" /></label>
            <button className="primary" disabled={!name.trim()} onClick={() => save(name)}>Save new fill</button>
            <button disabled={!sel} onClick={() => sel && save(sel)}>Save over selected</button>
          </>}
          <button disabled={!sel} className="danger" onClick={async () => { if (sel && confirm(`Delete fill "${sel}"?`)) { await api.deleteFill(sel); setSel(null); load() } }}>Delete</button>
        </div>
      </div>
    </Modal>
  )
}

/* =========================== Spell check =========================== */
export function SpellCheckModal({ onClose }: { onClose: () => void }) {
  const { r, setSel } = useEditor()
  const hits = useMemo(() => {
    const out: { label: string; words: string[]; go: () => void }[] = []
    r.sections.forEach((s) => s.instances.forEach((inst) => inst.items.forEach((it, itemIdx) => it.entries.forEach((e, entryIdx) => {
      const words = [...new Set(htmlToText(e.html).match(/[A-Za-z][A-Za-z']{2,}/g) || [])].filter((w) => !/^[A-Z]+$/.test(w))
      const bad = api.misspelled(words)
      if (bad.length) out.push({
        label: `${inst.name} › ${r.template.items[it.itemId]?.title} (comment ${entryIdx + 1})`, words: bad,
        go: () => { setSel({ kind: 'section', sectionId: s.id, instanceId: inst.id, tab: 'items', itemIdx, entryIdx }); onClose() },
      })
    }))))
    return out
  }, [r])
  return (
    <Modal title="Spell Check Report" onClose={onClose} wide footer={<button onClick={onClose}>Close</button>}>
      {!hits.length ? <p>No spelling problems found. ✔</p> : <>
        <p className="muted small">{hits.length} comment(s) with possible misspellings. Click “Go to” — misspelled words are underlined in red; right-click one for suggestions or to add it to the dictionary.</p>
        <table className="grid"><tbody>
          {hits.map((h, i) => <tr key={i}><td>{h.label}</td><td className="danger">{h.words.join(', ')}</td><td><button className="link" onClick={h.go}>Go to</button></td></tr>)}
        </tbody></table>
      </>}
    </Modal>
  )
}

/* =========================== Column headers =========================== */
export function ColumnHeadersModal({ onClose }: { onClose: () => void }) {
  const { r, mutate, editTemplate } = useEditor()
  const [cols, setCols] = useState<RatingColumn[]>(() => r.template.ratingColumns.map((c) => ({ ...c })))
  const orig = r.template.ratingColumns.map((c) => c.short)
  const set = (i: number, patch: Partial<RatingColumn>) => setCols(cols.map((c, k) => (k === i ? { ...c, ...patch } : c)))
  function save() {
    // renamed short codes also rename the ratings already given in this report
    const ren: Record<string, string> = {}
    cols.forEach((c, i) => { if (orig[i] && orig[i] !== c.short) ren[orig[i]] = c.short })
    editTemplate((t) => { t.ratingColumns = cols.map((c) => ({ ...c })) })
    if (Object.keys(ren).length) mutate((rr) => rr.sections.forEach((s) => s.instances.forEach((i) => i.items.forEach((it) => { it.ratings = it.ratings.map((x) => ren[x] || x) }))))
    onClose()
  }
  return (
    <Modal title="Edit Column Headers" onClose={onClose} wide
      footer={<><button onClick={onClose}>Cancel</button><button className="primary" onClick={save}>Save to template</button></>}>
      <table className="grid cols-edit">
        <thead><tr><th>Short</th><th>Full name (printed)</th><th>Color</th><th title="Ticking adds the comment to the Summary">→ Summary</th><th title="Ticking removes from Summary">✕ Summary</th><th title="Acts as the Exclude box">Exclude</th><th>Shown</th><th /></tr></thead>
        <tbody>
          {cols.map((c, i) => (
            <tr key={i}>
              <td><input value={c.short} onChange={(e) => set(i, { short: e.target.value.toUpperCase().slice(0, 4) })} style={{ width: 60 }} /></td>
              <td><input value={c.label} onChange={(e) => set(i, { label: e.target.value })} style={{ width: '100%' }} /></td>
              <td><input type="color" value={c.color || '#ff0033'} onChange={(e) => set(i, { color: e.target.value })} /></td>
              <td className="center"><input type="checkbox" checked={c.sendsToSummary} onChange={(e) => set(i, { sendsToSummary: e.target.checked })} /></td>
              <td className="center"><input type="checkbox" checked={c.removesFromSummary} onChange={(e) => set(i, { removesFromSummary: e.target.checked })} /></td>
              <td className="center"><input type="checkbox" checked={c.isExclude} onChange={(e) => set(i, { isExclude: e.target.checked })} /></td>
              <td className="center"><input type="checkbox" checked={c.visible} onChange={(e) => set(i, { visible: e.target.checked })} /></td>
              <td className="row-actions">
                <button className="icon" disabled={i === 0} onClick={() => { const a = [...cols]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; setCols(a) }}>↑</button>
                <button className="icon" disabled={i === cols.length - 1} onClick={() => { const a = [...cols]; [a[i + 1], a[i]] = [a[i], a[i + 1]]; setCols(a) }}>↓</button>
                <button className="icon danger" onClick={() => { if (confirm(`Remove column ${c.short}?`)) setCols(cols.filter((_, k) => k !== i)) }}>✕</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button onClick={() => setCols([...cols, { short: 'NEW', label: 'New column', sendsToSummary: false, removesFromSummary: false, isExclude: false, visible: true, color: '#ff0033' }])}>＋ Add column</button>
      <p className="muted small">Sections with their own columns (like the pool section's Yes/No) keep those.</p>
    </Modal>
  )
}

/* =========================== All Comments =========================== */
export function CommentsManager({ onClose }: { onClose: () => void }) {
  const { r, editTemplate } = useEditor()
  const T = r.template
  const [folder, setFolder] = useState('All')
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<Comment | null>(null)
  const [msg, setMsg] = useState('')
  const folders = useMemo(() => {
    const out: { path: string; ids: string[] }[] = []
    const walk = (fs: LibFolder[], p: string) => fs.forEach((f) => { const path = p ? `${p} :: ${f.name}` : f.name; out.push({ path, ids: f.commentIds }); walk(f.children, path) })
    walk(T.commentLibrary, '')
    return out
  }, [T.commentLibrary, r.updated])
  const folderOf = useMemo(() => { const m: Record<string, string> = {}; folders.forEach((f) => f.ids.forEach((id) => { m[id] ||= f.path })); return m }, [folders])
  const usedBy = useMemo(() => { const m: Record<string, number> = {}; Object.values(T.items).forEach((it) => it.commentIds.forEach((id) => { m[id] = (m[id] || 0) + 1 })); return m }, [T.items, r.updated])
  const rows = useMemo(() => {
    let ids = folder === 'All' ? Object.keys(T.comments) : folder === '(not in a folder)' ? Object.keys(T.comments).filter((id) => !folderOf[id]) : folders.find((f) => f.path === folder)?.ids || []
    const ql = q.toLowerCase()
    return ids.map((id) => T.comments[id]).filter((c) => c && (!ql || (c.name + ' ' + c.text).toLowerCase().includes(ql)))
  }, [folder, q, T.comments, folders, folderOf, r.updated])

  const findFolder = (t: any, path: string): LibFolder | null => {
    let list: LibFolder[] = t.commentLibrary, f: LibFolder | null = null
    for (const name of path.split(' :: ')) { f = list.find((x) => x.name === name) || null; if (!f) return null; list = f.children }
    return f
  }
  function saveComment(c: Comment, isNew: boolean) {
    editTemplate((t: any) => {
      t.comments[c.id] = { ...c, text: htmlToText(c.html), smart: /\*[A-Z]+\([^)]*\)\*/.test(htmlToText(c.html)) }
      if (isNew && folder !== 'All' && folder !== '(not in a folder)') findFolder(t, folder)?.commentIds.push(c.id)
    })
    setEditing(null)
  }
  function remove(c: Comment) {
    if (!confirm(`Delete the comment "${c.name || c.text.slice(0, 40)}" from the template? It is used by ${usedBy[c.id] || 0} item(s). Comments already written into reports are not affected.`)) return
    editTemplate((t: any) => {
      delete t.comments[c.id]
      Object.values(t.items).forEach((it: any) => { it.commentIds = it.commentIds.filter((x: string) => x !== c.id) })
      const strip = (fs: LibFolder[]) => fs.forEach((f) => { f.commentIds = f.commentIds.filter((x) => x !== c.id); strip(f.children) })
      strip(t.commentLibrary)
    })
  }
  async function importCsv() {
    const rows = await api.importCommentsCsv()
    if (!rows) return
    let added = 0, updated = 0
    editTemplate((t: any) => {
      for (const row of rows) {
        const html = row.html, text = htmlToText(html)
        if (row.id && t.comments[row.id]) { Object.assign(t.comments[row.id], { name: row.name || t.comments[row.id].name, html, text }); updated++; continue }
        const id = 'C-' + uid().toUpperCase()
        t.comments[id] = { id, name: row.name, html, text, smart: /\*[A-Z]+\([^)]*\)\*/.test(text), auto: false, defaultPhotos: [] }
        let f = row.folder ? findFolder(t, row.folder) : null
        if (!f && row.folder) { f = { name: row.folder.split(' :: ').pop()!, commentIds: [], children: [] }; t.commentLibrary.push(f) }
        f?.commentIds.push(id); added++
      }
    })
    setMsg(`Imported: ${added} new, ${updated} updated.`)
  }
  return (
    <Modal title="All Comments" onClose={onClose} full
      footer={<><span className="hint">{msg || `${rows.length} of ${Object.keys(T.comments).length} comments`}</span><span className="grow" />
        <button onClick={() => api.exportComments(T.comments, folderOf)}>Export (CSV/Excel)…</button>
        <button onClick={importCsv}>Import CSV…</button>
        <button onClick={onClose}>Close</button></>}>
      <div className="picker-bar">
        <label>Folder <select value={folder} onChange={(e) => setFolder(e.target.value)}><option>All</option><option>(not in a folder)</option>{folders.map((f) => <option key={f.path}>{f.path}</option>)}</select></label>
        <input className="search grow" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        <button onClick={() => setEditing({ id: 'C-' + uid().toUpperCase(), name: '', html: '', text: '', smart: false, auto: false, defaultPhotos: [] })}>＋ New comment</button>
      </div>
      <div className="table-wrap picker-table">
        <table className="grid comments">
          <thead><tr><th style={{ width: 170 }}>Name</th><th>Comment Text</th><th style={{ width: 220 }}>Folder</th><th style={{ width: 60 }} title="Inspection items that offer this comment">Items</th><th style={{ width: 80 }} /></tr></thead>
          <tbody>
            {rows.slice(0, 1500).map((c) => (
              <tr key={c.id} onDoubleClick={() => setEditing({ ...c })}>
                <td>{c.name}{c.smart && <span className="tag">✱</span>}</td><td className="ctext">{c.text}</td>
                <td className="muted small">{folderOf[c.id] || '—'}</td><td className="center">{usedBy[c.id] || ''}</td>
                <td className="row-actions"><button className="icon" onClick={() => setEditing({ ...c })}>✎</button><button className="icon danger" onClick={() => remove(c)}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && <EditComment c={editing} isNew={!T.comments[editing.id]} onSave={saveComment} onClose={() => setEditing(null)} />}
    </Modal>
  )
}

/* =========================== Save Template As =========================== */
export function SaveTemplateAsModal({ onClose }: { onClose: () => void }) {
  const { r, mutate } = useEditor()
  const [name, setName] = useState(r.template.name + ' copy')
  const [existing, setExisting] = useState<string[]>([])
  useEffect(() => { api.listTemplates().then(setExisting) }, [])
  async function save() {
    const n = name.trim()
    if (!n) return
    if (existing.includes(n) && !confirm(`A template named "${n}" exists. Replace it?`)) return
    const T: TemplateFile = {
      ...JSON.parse(JSON.stringify(r.template)), name: n,
      sections: r.sections.map((s) => ({
        group: s.group, name: s.name, excludedByDefault: s.excluded, repeatNames: s.repeatNames, introCommentIds: s.introCommentIds,
        footerCommentIds: s.footerCommentIds, itemIds: s.itemIds, materialIds: s.materialIds, ratingColumns: s.ratingColumns,
      })),
    }
    T.generalInfo = { ...T.generalInfo, materialIds: r.generalInfo.materials.map((m) => m.materialId) }
    await api.saveTemplate(n, T)
    mutate((rr) => { rr.template.name = n })
    onClose()
  }
  return (
    <Modal title="Save Template As" onClose={onClose}
      footer={<><button onClick={onClose}>Cancel</button><button className="primary" disabled={!name.trim()} onClick={save}>Save</button></>}>
      <p className="muted small">Saves this report's sections, items, Styles &amp; Materials, comment library and pick lists as a template for new reports (answers and photos are not included). This report then uses the new template.</p>
      <label className="field"><span>Template name</span><input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} /></label>
    </Modal>
  )
}
