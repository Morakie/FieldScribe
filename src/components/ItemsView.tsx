import { useEffect, useState } from 'react'
import type { Section, Instance, ItemAnswer, Photo } from '../types'
import { useEditor } from './Editor'
import RichText from './RichText'
import CommentPicker from './CommentPicker'
import SmartFill from './SmartFill'
import PhotoEditor from './PhotoEditor'
import Split from './Split'
import { Badge, CamIcon, NoteIcon } from './Icons'
import { api, colsFor, joinPath, newEntry, smartKeys, imgUrl, uid, photoSettings, toJpeg } from '../util'
import { attachPhotos, readDrag } from '../photoOps'
import ContextMenu, { type MenuItem } from './ContextMenu'
import AskText from './AskText'
import Modal from './Modal'

/** Photos cut/copied with the right-click menu (same report, any item). */
let photoClipboard: Photo[] = []
const realPhotos = (ps: Photo[]) => ps.filter((p) => !p.placeholder && p.file)

export default function ItemsView({ section, instance }: { section: Section; instance: Instance }) {
  const { r, mutate, sel, setSel, editTemplate } = useEditor()
  const [dropRow, setDropRow] = useState<number | null>(null)
  const [naming, setNaming] = useState<{ mode: 'add' | 'rename'; value: string } | null>(null)
  if (sel.kind !== 'section') return null
  const cols = colsFor(r, section).filter((c) => c.visible || c.isExclude)
  const allCols = colsFor(r, section)
  const itemIdx = Math.min(sel.itemIdx, instance.items.length - 1)
  const item = instance.items[itemIdx]

  const go = (i: number, e = 0) => setSel({ ...sel, itemIdx: i, entryIdx: e })

  function toggleRating(it: ItemAnswer, short: string) {
    const col = allCols.find((c) => c.short === short)!
    mutate(() => {
      const on = it.ratings.includes(short)
      if (col.isExclude) { it.excluded = !on; it.ratings = on ? [] : [short]; return }
      it.excluded = false
      it.ratings = on ? it.ratings.filter((x) => x !== short) : [...it.ratings.filter((x) => !allCols.find((c) => c.short === x)?.isExclude), short]
      if (!on && col.removesFromSummary) it.entries.forEach((e) => (e.summary = false))
    })
  }

  const addItem = () => setNaming({ mode: 'add', value: '' })
  function commitName() {
    if (!naming?.value.trim()) return setNaming(null)
    const v = naming.value.trim().toUpperCase()
    if (naming.mode === 'add') {
      const id = 'II-' + uid().toUpperCase()
      editTemplate((t) => { t.items[id] = { id, title: v, helpHtml: '', commentIds: [] } })
      mutate((rr) => {
        const s = rr.sections.find((x) => x.id === section.id)!
        s.itemIds.push(id)
        s.instances.forEach((i) => i.items.push({ itemId: id, ratings: [], excluded: false, entries: [] }))
      })
      go(instance.items.length - 1)
    } else {
      editTemplate((t) => { t.items[item.itemId].title = v })
    }
    setNaming(null)
  }
  function deleteItem() {
    if (!item || !confirm(`Remove "${r.template.items[item.itemId]?.title}" from ${section.name}? Anything written in it here will be lost.`)) return
    mutate(() => {
      section.itemIds = section.itemIds.filter((x) => x !== item.itemId)
      section.instances.forEach((i) => (i.items = i.items.filter((x) => x.itemId !== item.itemId)))
    })
    go(Math.max(0, itemIdx - 1))
  }
  function moveItem(d: number) {
    const j = itemIdx + d
    if (j < 0 || j >= instance.items.length) return
    mutate(() => {
      section.instances.forEach((i) => { const a = i.items; const k = a.findIndex((x) => x.itemId === item.itemId); const l = k + d; if (k >= 0 && l >= 0 && l < a.length) [a[k], a[l]] = [a[l], a[k]] })
      const a = section.itemIds; const k = a.indexOf(item.itemId); if (k >= 0 && k + d >= 0 && k + d < a.length) [a[k], a[k + d]] = [a[k + d], a[k]]
    })
    go(j)
  }

  return (
    <div className="items-view">
      <div className="item-actions">
        <button onClick={addItem}>＋ Add item</button>
        <button disabled={!item} onClick={() => setNaming({ mode: 'rename', value: r.template.items[item.itemId]?.title || '' })}>✎ Rename</button>
        <button disabled={!item} onClick={deleteItem}>✕ Delete</button>
        <button disabled={itemIdx <= 0} onClick={() => moveItem(-1)}>↑ Move up</button>
        <button disabled={itemIdx >= instance.items.length - 1} onClick={() => moveItem(1)}>↓ Move down</button>
        {naming && <span className="inline-name">
          <input autoFocus value={naming.value} placeholder={naming.mode === 'add' ? 'New item title' : ''} onChange={(e) => setNaming({ ...naming, value: e.target.value })}
            onKeyDown={(e) => { if (e.key === 'Enter') commitName(); if (e.key === 'Escape') setNaming(null) }} />
          <button className="primary" onClick={commitName}>OK</button><button onClick={() => setNaming(null)}>Cancel</button>
        </span>}
        <span className="grow" />
        <span className="legend">{allCols.map((c) => `${c.short}=${c.label}`).join(', ')}</span>
      </div>
      <Split id="items-grid2" dir="v" initial={0.42} min={90} max={1400}>{[
      <div className="items-grid-wrap" key="g">
        <table className="grid items">
          <thead><tr>
            <th style={{ width: 26 }} className="center" title="Flag (Go → Find Flagged)">F</th>
            <th style={{ width: 84 }} title="Comments / photos" />
            <th style={{ width: 28 }} title="In Summary">S</th>
            <th>Inspection Item</th>
            {cols.map((c) => <th key={c.short} className="rcol" title={c.label}>{c.short}</th>)}
          </tr></thead>
          <tbody>
            {instance.items.map((it, i) => {
              const nPics = it.entries.reduce((n, e) => n + e.photos.filter((p) => !p.placeholder).length, 0)
              const inSum = it.entries.some((e) => e.summary)
              return (
                <tr key={it.itemId} className={(i === itemIdx ? 'sel ' : '') + (it.excluded ? 'excluded ' : '') + (dropRow === i ? 'drop' : '')}
                  onClick={() => go(i)}
                  onDragOver={(e) => { e.preventDefault(); setDropRow(i) }} onDragLeave={() => setDropRow(null)}
                  onDrop={(e) => { e.preventDefault(); setDropRow(null); const ph = readDrag(e); if (ph) { go(i); attachPhotos(r, mutate, it, 0, ph) } }}>
                  <td className="center flagcell" onClick={(e) => { e.stopPropagation(); mutate(() => { it.flagged = !it.flagged }) }} title={it.flagged ? 'Flagged — click to clear' : 'Click to flag for follow-up'}>
                    <span className={'flag' + (it.flagged ? ' on' : '')}>⚑</span></td>
                  <td className="nowrap">{it.entries.length > 0 && <Badge icon={<NoteIcon size={11} />} n={it.entries.length} title={`${it.entries.length} comment(s)`} />}{nPics > 0 && <Badge icon={<CamIcon size={11} />} n={nPics} title={`${nPics} photo(s)`} />}</td>
                  <td className="center">{inSum ? <span className="sum-dot" title="In Summary">S</span> : ''}</td>
                  <td>{sel.itemIdx === i ? <b>{`${sectionNo(r, section)}.${i} `}{r.template.items[it.itemId]?.title}</b> : <>{`${sectionNo(r, section)}.${i} `}{r.template.items[it.itemId]?.title}</>}</td>
                  {cols.map((c) => (
                    <td key={c.short} className="rcol" onClick={(e) => { e.stopPropagation(); go(i); toggleRating(it, c.short) }}>
                      <span className={'rbox' + (it.ratings.includes(c.short) ? ' on' : '') + (c.isExclude ? ' ex' : '')} title={c.isExclude ? 'Exclude this item from the report' : c.label}
                        style={it.ratings.includes(c.short) && c.sendsToSummary ? { background: '#c0392b', borderColor: '#c0392b' } : undefined}>
                        {it.ratings.includes(c.short) ? 'X' : ''}
                      </span>
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>,
      item ? <EntriesPane key={item.itemId} section={section} item={item} itemIdx={itemIdx} /> : <div key="e" />,
      ]}</Split>
    </div>
  )
}

const sectionNo = (r: any, s: Section) => {
  const inGroup = r.sections.filter((x: Section) => x.group === s.group && !x.excluded)
  const i = inGroup.indexOf(s)
  return i < 0 ? 'X' : String(i + 1)
}

function EntriesPane({ item, itemIdx }: { section: Section; item: ItemAnswer; itemIdx: number }) {
  const { r, mutate, sel, setSel, dir } = useEditor()
  const [picker, setPicker] = useState(false)
  const [smart, setSmart] = useState<{ html: string; idx: number } | null>(null)
  const [help, setHelp] = useState(false)
  const [editPhoto, setEditPhoto] = useState<{ entry: number; photo: number } | null>(null)
  const [dropping, setDropping] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number; pi: number | null } | null>(null)
  const [ask, setAsk] = useState<null | { title: string; label: string; initial: string; onOk: (v: string) => void }>(null)
  const [props, setProps] = useState<number | null>(null)
  /** "Edit All For This Item": photos of this item edited one after another */
  const [queue, setQueue] = useState<{ list: { entry: number; photo: number }[]; i: number } | null>(null)
  useEffect(() => {
    const f = (e: Event) => {
      const file = (e as CustomEvent).detail
      item.entries.forEach((en, ei) => en.photos.forEach((p, pi) => { if (p.file === file) setEditPhoto({ entry: ei, photo: pi }) }))
    }
    window.addEventListener('bridge-edit-photo', f)
    return () => window.removeEventListener('bridge-edit-photo', f)
  }, [item])
  const [psize, setPsize] = useState<number>(() => { try { return Number(localStorage.getItem('photoSize')) || 260 } catch { return 260 } })
  const setPhotoSize = (v: number) => { setPsize(v); try { localStorage.setItem('photoSize', String(v)) } catch {} }
  if (sel.kind !== 'section') return null
  const entryIdx = Math.min(sel.entryIdx, Math.max(0, item.entries.length - 1))
  const entry = item.entries[entryIdx]
  const setEntry = (e: number) => setSel({ ...sel, itemIdx, entryIdx: e })
  const def = r.template.items[item.itemId]

  function insert(htmls: string[], mode: 'itemized' | 'one') {
    setPicker(false)
    const startEmpty = entry && !entry.html.replace(/<[^>]+>|\s|&nbsp;/g, '') ? entryIdx : -1
    const chunks = mode === 'one' ? [htmls.join(' ')] : htmls
    let first = -1
    mutate(() => {
      chunks.forEach((h, k) => {
        if (k === 0 && startEmpty >= 0) { item.entries[startEmpty].html = h; first = startEmpty }
        else { item.entries.push(newEntry(h)); if (first < 0) first = item.entries.length - 1 }
      })
    })
    setEntry(first)
    const target = item.entries[first]
    if (target && smartKeys(target.html).length) setSmart({ html: target.html, idx: first })
  }

  // ---------- right-click menu on photos (like HomeGauge) ----------
  const ensureEntry = () => { if (!item.entries[entryIdx]) { mutate(() => item.entries.push(newEntry())); setEntry(item.entries.length - 1) } return item.entries[entryIdx] || item.entries[item.entries.length - 1] }
  function insertPlaceholder(at: number | null) {
    setAsk({ title: 'Insert Place Holder', label: 'Photo label (it becomes the caption of the photo dropped here)', initial: '', onOk: (label) => {
      mutate(() => {
        const e = item.entries[entryIdx] || (item.entries.push(newEntry()), item.entries[item.entries.length - 1])
        const ph: Photo = { file: '', caption: label, placeholder: true }
        if (at == null) e.photos.push(ph); else e.photos.splice(at + 1, 0, ph)
      })
    } })
  }
  async function insertSketch(at: number | null) {
    // a blank white picture to draw on in the photo editor
    const c = document.createElement('canvas'); c.width = 1600; c.height = 1200
    const g = c.getContext('2d')!; g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height)
    const bytes = await toJpeg(c, 0.92)
    const file = await api.addPhoto(r.id, bytes, '.jpg')
    let ei = entryIdx, pi = 0
    mutate(() => {
      const e = item.entries[entryIdx] || (item.entries.push(newEntry()), item.entries[item.entries.length - 1])
      ei = item.entries.indexOf(e)
      const ph: Photo = { file, caption: 'Sketch', size: photoSettings().reportSize }
      if (at == null) { e.photos.push(ph); pi = e.photos.length - 1 } else { e.photos.splice(at + 1, 0, ph); pi = at + 1 }
    })
    setTimeout(() => setEditPhoto({ entry: ei, photo: pi }), 50)
  }
  async function fillFromFile(pi: number | null) {
    const files = await api.pickFiles('Choose photo(s)')
    if (files.length) attachPhotos(r, mutate, item, entryIdx, files.map((p) => ({ path: p })), pi ?? undefined)
  }
  function move(pi: number, to: number) {
    mutate(() => { const a = entry!.photos; const [p] = a.splice(pi, 1); a.splice(Math.max(0, Math.min(a.length, to)), 0, p) })
  }
  function editAllForItem() {
    const list: { entry: number; photo: number }[] = []
    item.entries.forEach((e, ei) => e.photos.forEach((p, pi) => { if (!p.placeholder && p.file) list.push({ entry: ei, photo: pi }) }))
    if (list.length) setQueue({ list, i: 0 })
  }
  function menuItems(pi: number | null): MenuItem[] {
    const p = pi != null ? entry?.photos[pi] : undefined
    const isPhoto = !!p && !p.placeholder && !!p.file
    const n = entry?.photos.length || 0
    const allReal = item.entries.flatMap((e) => realPhotos(e.photos))
    const allPh = item.entries.flatMap((e) => e.photos).length
    return [
      { label: 'Edit Picture', disabled: !isPhoto, onClick: () => setEditPhoto({ entry: entryIdx, photo: pi! }) },
      { label: 'Edit All For This Item', disabled: !allReal.length, onClick: editAllForItem },
      'sep',
      { label: 'Move Up One', disabled: pi == null || pi === 0, onClick: () => move(pi!, pi! - 1) },
      { label: 'Move Back One', disabled: pi == null || pi >= n - 1, onClick: () => move(pi!, pi! + 1) },
      { label: 'Move To Front', disabled: pi == null || pi === 0, onClick: () => move(pi!, 0) },
      { label: 'Move To Back', disabled: pi == null || pi >= n - 1, onClick: () => move(pi!, n - 1) },
      'sep',
      ...(p?.placeholder ? [{ label: 'Choose Photo For This Place Holder…', onClick: () => fillFromFile(pi) } as MenuItem] : []),
      { label: 'Insert Place Holder…', onClick: () => insertPlaceholder(pi) },
      { label: 'Insert Sketch', onClick: () => insertSketch(pi) },
      ...(p?.placeholder ? [{ label: 'Edit Place Holder Label…', onClick: () => setAsk({ title: 'Place Holder Label', label: 'Label', initial: p.caption, onOk: (v) => mutate(() => { p.caption = v }) }) } as MenuItem] : []),
      'sep',
      { label: 'Cut', disabled: !p, onClick: () => { photoClipboard = [JSON.parse(JSON.stringify(p))]; mutate(() => entry!.photos.splice(pi!, 1)) } },
      { label: 'Cut All For This Item', disabled: !allPh, onClick: () => { photoClipboard = JSON.parse(JSON.stringify(item.entries.flatMap((e) => e.photos))); mutate(() => item.entries.forEach((e) => (e.photos = []))) } },
      { label: 'Copy', disabled: !p, onClick: () => { photoClipboard = [JSON.parse(JSON.stringify(p))] } },
      { label: 'Copy All For This Item', disabled: !allPh, onClick: () => { photoClipboard = JSON.parse(JSON.stringify(item.entries.flatMap((e) => e.photos))) } },
      { label: `Paste${photoClipboard.length > 1 ? ` (${photoClipboard.length})` : ''}`, disabled: !photoClipboard.length, onClick: () => {
        const add = JSON.parse(JSON.stringify(photoClipboard)) as Photo[]
        mutate(() => { const e = ensureEntry(); if (pi == null) e.photos.push(...add); else e.photos.splice(pi + 1, 0, ...add) })
      } },
      'sep',
      { label: p?.placeholder ? 'Delete Place Holder' : 'Delete Picture', disabled: !p, onClick: () => mutate(() => entry!.photos.splice(pi!, 1)) },
      { label: 'Delete All For This Item', disabled: !allPh, onClick: () => { if (confirm(`Remove all ${allPh} photo(s) and place holder(s) from this item?`)) mutate(() => item.entries.forEach((e) => (e.photos = []))) } },
      'sep',
      { label: 'Properties…', disabled: !p, onClick: () => setProps(pi) },
    ]
  }

  return (
    <div className="entries">
      <div className="entry-tabs">
        <span className="entry-title">{def?.title}</span>
        {item.entries.map((e, i) => (
          <button key={e.id} className={'etab' + (i === entryIdx ? ' on' : '')} onClick={() => setEntry(i)}>
            Comment {i + 1}
            {e.summary && <span className="badge-pill sum" title="In the Summary">S</span>}
            {e.photos.some((p) => !p.placeholder) && <Badge icon={<CamIcon size={11} />} n={e.photos.filter((p) => !p.placeholder).length} title={`${e.photos.filter((p) => !p.placeholder).length} photo(s)`} />}
            {e.photos.some((p) => p.placeholder) && <span className="badge-pill ph" title={`${e.photos.filter((p) => p.placeholder).length} photo placeholder(s) still to fill`}>☐{e.photos.filter((p) => p.placeholder).length}</span>}
          </button>
        ))}
        <button className="etab add" title="Add a blank comment" onClick={() => { mutate(() => item.entries.push(newEntry())); setEntry(item.entries.length - 1) }}>＋</button>
        <span className="grow" />
        <label className="psize" title="Photo size"><CamIcon size={14} /> <input type="range" min={120} max={700} value={psize} onChange={(e) => setPhotoSize(+e.target.value)} /></label>
        {def?.helpHtml && <button className={help ? 'on' : ''} onClick={() => setHelp(!help)}>? Inspector help</button>}
      </div>
      {help && <div className="help-box" dangerouslySetInnerHTML={{ __html: def.helpHtml }} />}
      <div className="entry-body">
        <Split id="entry-text2" dir="h" initial={0.5} min={200} max={1600}>{[
        <div className="entry-text" key="t">
          {entry ? (
            <RichText key={entry.id} value={entry.html} minHeight={150} placeholder="Type, or click ✨ Comments to pick from the comment list…"
              onChange={(h) => mutate(() => { entry.html = h })}
              toolbarExtra={<>
                <span className="sep" />
                <button className="wand" onMouseDown={(e) => { e.preventDefault(); setPicker(true) }} title="Pick comments for this item">✨ Comments</button>
                {smartKeys(entry.html).length > 0 && <button onMouseDown={(e) => { e.preventDefault(); setSmart({ html: entry.html, idx: entryIdx }) }} title="Fill in *SMART* words">✱ Smart Text ({smartKeys(entry.html).length})</button>}
                <span className="grow" />
                <button disabled={entryIdx === 0} onMouseDown={(e) => { e.preventDefault(); mutate(() => { const a = item.entries; [a[entryIdx - 1], a[entryIdx]] = [a[entryIdx], a[entryIdx - 1]] }); setEntry(entryIdx - 1) }} title="Move comment left">◀</button>
                <button disabled={entryIdx >= item.entries.length - 1} onMouseDown={(e) => { e.preventDefault(); mutate(() => { const a = item.entries; [a[entryIdx + 1], a[entryIdx]] = [a[entryIdx], a[entryIdx + 1]] }); setEntry(entryIdx + 1) }} title="Move comment right">▶</button>
                <button className="danger" onMouseDown={(e) => { e.preventDefault(); if (confirm('Delete this comment and its photos from the report?')) { mutate(() => item.entries.splice(entryIdx, 1)); setEntry(Math.max(0, entryIdx - 1)) } }} title="Delete this comment">🗑</button>
              </>} />
          ) : (
            <div className="entry-empty">
              <button className="primary big" onClick={() => setPicker(true)}>✨ Pick comments</button>
              <button onClick={() => { mutate(() => item.entries.push(newEntry())) }}>Write my own</button>
              <p className="muted">…or drag photos here from the right.</p>
            </div>
          )}
          {entry && <label className="sumbox"><input type="checkbox" checked={entry.summary} onChange={(e) => mutate(() => { entry.summary = e.target.checked })} /> Include this comment in the Summary</label>}
        </div>,
        <div key="p" className={'entry-photos' + (dropping ? ' drop' : '')} style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${psize}px, 1fr))` }}
          onDragOver={(e) => { e.preventDefault(); setDropping(true) }} onDragLeave={() => setDropping(false)}
          onDrop={(e) => { e.preventDefault(); setDropping(false); const ph = readDrag(e); if (ph) attachPhotos(r, mutate, item, entryIdx, ph) }}
          onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, pi: null }) }}>
          {!entry?.photos.length && <div className="drop-hint">Drop photos here<div className="muted small">Right-click to insert a place holder or sketch</div></div>}
          {entry?.photos.map((p, pi) => p.placeholder ? (
            <figure key={'ph' + pi} className="photo placeholder" onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setMenu({ x: e.clientX, y: e.clientY, pi }) }}
              onDoubleClick={() => { setMenu(null); fillFromFile(pi) }}
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation() }}
              onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setDropping(false); const ph = readDrag(e); if (ph) attachPhotos(r, mutate, item, entryIdx, ph, pi) }}
              title="Photo place holder — drop a photo here, double-click to choose one, click for more options">
              <div className="ph-box" onClick={(e) => setMenu({ x: e.clientX, y: e.clientY, pi })}><CamIcon size={28} /><div>Drop photo here</div></div>
              <input className="caption" value={p.caption} placeholder="Label" onChange={(e) => mutate(() => { p.caption = e.target.value })} />
              <div className="photo-actions">
                <span className="muted small grow">Placeholder — not printed</span>
                <button className="icon danger" onClick={() => mutate(() => entry.photos.splice(pi, 1))} title="Remove this placeholder">✕</button>
              </div>
            </figure>
          ) : (
            <figure key={p.file + pi} className="photo" onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setMenu({ x: e.clientX, y: e.clientY, pi }) }}>
              <img src={imgUrl(joinPath(dir, p.file))} onClick={(e) => setMenu({ x: e.clientX, y: e.clientY, pi })} onDoubleClick={() => { setMenu(null); setEditPhoto({ entry: entryIdx, photo: pi }) }} title="Click for options, double-click to edit" />
              <input className="caption" value={p.caption} placeholder="Caption" onChange={(e) => mutate(() => { p.caption = e.target.value })} />
              <div className="photo-actions">
                <button className="icon" disabled={pi === 0} onClick={() => mutate(() => { const a = entry.photos; [a[pi - 1], a[pi]] = [a[pi], a[pi - 1]] })} title="Move left">◀</button>
                <button className="icon" onClick={() => setEditPhoto({ entry: entryIdx, photo: pi })} title="Edit picture">✎ Edit</button>
                <button className={'icon' + (r.coverPhoto === p.file ? ' on' : '')} onClick={() => mutate(() => { r.coverPhoto = p.file })} title="Use as the cover photo">{r.coverPhoto === p.file ? '★' : '☆'}</button>
                <button className="icon" disabled={pi === entry.photos.length - 1} onClick={() => mutate(() => { const a = entry.photos; [a[pi + 1], a[pi]] = [a[pi], a[pi + 1]] })} title="Move right">▶</button>
                <button className="icon danger" onClick={() => mutate(() => entry.photos.splice(pi, 1))} title="Remove from report">✕</button>
              </div>
            </figure>
          ))}
        </div>,
        ]}</Split>
      </div>
      {picker && <CommentPicker itemId={item.itemId} onInsert={insert} onClose={() => setPicker(false)} />}
      {smart && <SmartFill html={smart.html} onClose={() => setSmart(null)} onDone={(h) => { mutate(() => { item.entries[smart.idx].html = h }); setSmart(null) }} />}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.pi)} onClose={() => setMenu(null)} />}
      {ask && <AskText title={ask.title} label={ask.label} initial={ask.initial} onOk={ask.onOk} onClose={() => setAsk(null)} />}
      {props != null && entry?.photos[props] && <PhotoProps photo={entry.photos[props]} dir={dir} onClose={() => setProps(null)} onChange={(patch) => mutate(() => { Object.assign(entry.photos[props], patch) })} />}
      {queue && item.entries[queue.list[queue.i].entry]?.photos[queue.list[queue.i].photo] && (() => {
        const q = queue.list[queue.i]
        const next = () => (queue.i + 1 < queue.list.length ? setQueue({ ...queue, i: queue.i + 1 }) : setQueue(null))
        return <PhotoEditor key={q.entry + ':' + q.photo} photo={item.entries[q.entry].photos[q.photo]} title={`Edit All For This Item — ${queue.i + 1} of ${queue.list.length}`}
          onSkip={next} onClose={() => setQueue(null)} onSaved={(patch) => { mutate(() => { Object.assign(item.entries[q.entry].photos[q.photo], patch) }); next() }} />
      })()}
      {editPhoto && item.entries[editPhoto.entry]?.photos[editPhoto.photo] && (
        <PhotoEditor photo={item.entries[editPhoto.entry].photos[editPhoto.photo]} onClose={() => setEditPhoto(null)}
          onSaved={(patch) => { mutate(() => { Object.assign(item.entries[editPhoto.entry].photos[editPhoto.photo], patch) }); setEditPhoto(null) }} />
      )}
    </div>
  )
}

/** Right-click → Properties: label, printed size, and file details. */
function PhotoProps({ photo, dir, onClose, onChange }: { photo: Photo; dir: string; onClose: () => void; onChange: (p: Partial<Photo>) => void }) {
  const [dim, setDim] = useState('')
  useEffect(() => {
    if (!photo.file) return
    const im = new Image(); im.onload = () => setDim(`${im.naturalWidth} × ${im.naturalHeight}`); im.src = imgUrl(joinPath(dir, photo.file))
  }, [photo.file])
  return (
    <Modal title={photo.placeholder ? 'Place Holder Properties' : 'Picture Properties'} onClose={onClose} footer={<button className="primary" onClick={onClose}>OK</button>}>
      <label className="field"><span>{photo.placeholder ? 'Label' : 'Caption / label'}</span><input value={photo.caption} onChange={(e) => onChange({ caption: e.target.value })} /></label>
      {!photo.placeholder && <label className="field"><span>Size in the report</span>
        <select value={photo.size || photoSettings().reportSize} onChange={(e) => onChange({ size: e.target.value as Photo['size'] })}>
          <option value="s">Small</option><option value="m">Medium</option><option value="l">Large</option><option value="xl">X-Large</option>
        </select></label>}
      <div className="fill-info small">
        {photo.placeholder ? <div>Empty place holder — drop a photo on it and the photo takes this label. Not printed.</div> : <>
          <div>File: {photo.file}</div>
          {dim && <div>Size: {dim} px</div>}
          {photo.src && <div>Original: {photo.src}</div>}
          {photo.edit ? <div>Has markup (re-editable)</div> : null}
        </>}
      </div>
    </Modal>
  )
}
