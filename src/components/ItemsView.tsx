import { useEffect, useState } from 'react'
import type { Section, Instance, ItemAnswer } from '../types'
import { useEditor } from './Editor'
import RichText from './RichText'
import CommentPicker from './CommentPicker'
import SmartFill from './SmartFill'
import PhotoEditor from './PhotoEditor'
import Split from './Split'
import { Badge, CamIcon, NoteIcon } from './Icons'
import { colsFor, joinPath, newEntry, smartKeys, imgUrl, uid } from '../util'
import { attachPhotos, readDrag } from '../photoOps'

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
          onDrop={(e) => { e.preventDefault(); setDropping(false); const ph = readDrag(e); if (ph) attachPhotos(r, mutate, item, entryIdx, ph) }}>
          {!entry?.photos.length && <div className="drop-hint">Drop photos here</div>}
          {entry?.photos.map((p, pi) => p.placeholder ? (
            <figure key={'ph' + pi} className="photo placeholder"
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation() }}
              onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setDropping(false); const ph = readDrag(e); if (ph) attachPhotos(r, mutate, item, entryIdx, ph, pi) }}
              title="Photo placeholder — drop a photo here (or anywhere in this area) to fill it">
              <div className="ph-box"><CamIcon size={28} /><div>Drop photo here</div></div>
              <input className="caption" value={p.caption} placeholder="Label" onChange={(e) => mutate(() => { p.caption = e.target.value })} />
              <div className="photo-actions">
                <span className="muted small grow">Placeholder — not printed</span>
                <button className="icon danger" onClick={() => mutate(() => entry.photos.splice(pi, 1))} title="Remove this placeholder">✕</button>
              </div>
            </figure>
          ) : (
            <figure key={p.file + pi} className="photo">
              <img src={imgUrl(joinPath(dir, p.file))} onDoubleClick={() => setEditPhoto({ entry: entryIdx, photo: pi })} title="Double-click to edit" />
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
      {editPhoto && item.entries[editPhoto.entry]?.photos[editPhoto.photo] && (
        <PhotoEditor photo={item.entries[editPhoto.entry].photos[editPhoto.photo]} onClose={() => setEditPhoto(null)}
          onSaved={(patch) => { mutate(() => { Object.assign(item.entries[editPhoto.entry].photos[editPhoto.photo], patch) }); setEditPhoto(null) }} />
      )}
    </div>
  )
}
