import { useMemo, useState } from 'react'
import type { Comment, LibFolder } from '../types'
import Modal from './Modal'
import RichText from './RichText'
import { useEditor } from './Editor'
import { htmlToText, uid } from '../util'

/**
 * "Select Comments For <ITEM>" — the item's own comments first, the whole library on demand.
 * With itemId 'general' it works on the General Information comment list instead of an item's.
 */
export default function CommentPicker({ itemId, onInsert, onClose }: {
  itemId: string; onInsert: (htmls: string[], mode: 'itemized' | 'one') => void; onClose: () => void
}) {
  const { r, editTemplate } = useEditor()
  const T = r.template
  const general = itemId === 'general'
  /** the comment-id list this picker edits, on either the report's template copy or the template file */
  const idsOf = (t: any): string[] => {
    if (general) { t.generalInfo ||= { commentIds: [], materialIds: [] }; t.generalInfo.commentIds ||= []; return t.generalInfo.commentIds }
    return t.items?.[itemId]?.commentIds || []
  }
  const item = general ? { title: 'General Information', commentIds: idsOf(T) } : T.items[itemId]
  const [list, setList] = useState<'item' | 'all'>('item')
  const [cat, setCat] = useState('All')
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [editing, setEditing] = useState<Comment | null>(null)
  const [focus, setFocus] = useState<string | null>(null)

  const folders = useMemo(() => {
    const out: { path: string; ids: string[] }[] = []
    const walk = (fs: LibFolder[], p: string) => fs.forEach((f) => {
      const path = p ? `${p} :: ${f.name}` : f.name
      out.push({ path, ids: f.commentIds }); walk(f.children, path)
    })
    walk(T.commentLibrary, '')
    return out
  }, [T.commentLibrary])
  const folderOf = useMemo(() => {
    const m: Record<string, string> = {}
    folders.forEach((f) => f.ids.forEach((id) => { m[id] ||= f.path }))
    return m
  }, [folders])

  const rows = useMemo(() => {
    let ids: string[] = list === 'item' ? item.commentIds : cat === 'All' ? Object.keys(T.comments) : folders.find((f) => f.path === cat)?.ids || []
    ids = ids.filter((id) => T.comments[id])
    const ql = q.toLowerCase()
    if (ql) ids = ids.filter((id) => (T.comments[id].name + ' ' + T.comments[id].text).toLowerCase().includes(ql))
    return [...new Set(ids)].map((id) => T.comments[id])
  }, [list, cat, q, item, T.comments, folders, r])

  const toggle = (id: string) => setPicked(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id])
  const insert = (mode: 'itemized' | 'one') => onInsert(picked.map((id) => T.comments[id].html), mode)

  function saveComment(c: Comment, isNew: boolean) {
    editTemplate((t) => {
      t.comments[c.id] = { ...c, text: htmlToText(c.html), smart: /\*[A-Z]+\([^)]*\)\*/.test(htmlToText(c.html)) }
      const ids = idsOf(t); if (isNew && !ids.includes(c.id)) ids.push(c.id)
    })
    setEditing(null)
  }
  function removeFromItem(id: string) {
    if (!confirm(`Remove this comment from ${general ? 'the General Information' : 'this item’s'} list? (It stays in the library.)`)) return
    editTemplate((t) => { const ids = idsOf(t); const i = ids.indexOf(id); if (i >= 0) ids.splice(i, 1) })
    setPicked(picked.filter((x) => x !== id))
  }
  function addToItem(id: string) {
    editTemplate((t) => { const ids = idsOf(t); if (!ids.includes(id)) ids.push(id) })
  }
  function move(id: string, d: number) {
    editTemplate((t) => {
      const a = idsOf(t); const i = a.indexOf(id); const j = i + d
      if (i < 0 || j < 0 || j >= a.length) return
      ;[a[i], a[j]] = [a[j], a[i]]
    })
  }

  return (
    <Modal title={`Select Comments For ${item.title}`} onClose={onClose} full
      footer={<>
        <span className="hint">{picked.length} selected · Words with *STARS* get filled in by Smart Text after insert</span>
        <span className="grow" />
        <button disabled={!picked.length} onClick={() => insert('itemized')}>Insert As Itemized Comments</button>
        <button className="primary" disabled={!picked.length} onClick={() => insert('one')}>Insert As One Comment</button>
        <button onClick={onClose}>Cancel</button>
      </>}>
      <div className="picker-bar">
        <label>List <select value={list} onChange={(e) => setList(e.target.value as any)}>
          <option value="item">{general ? 'General Information' : 'This item'} ({item.commentIds.length})</option>
          <option value="all">Whole library</option>
        </select></label>
        {list === 'all' && <label>Category <select value={cat} onChange={(e) => setCat(e.target.value)}>
          <option>All</option>{folders.map((f) => <option key={f.path}>{f.path}</option>)}
        </select></label>}
        <input className="search grow" placeholder="Search filters as you type…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        <button onClick={() => setEditing({ id: 'C-' + uid().toUpperCase(), name: '', html: '', text: '', smart: false, auto: false, defaultPhotos: [] })}>＋ New comment</button>
      </div>
      <div className="table-wrap picker-table">
        <table className="grid comments">
          <thead><tr><th style={{ width: 30 }}>✓</th><th style={{ width: 170 }}>Name</th><th>Comment Text</th><th style={{ width: 120 }} /></tr></thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className={(picked.includes(c.id) ? 'sel ' : '') + (focus === c.id ? 'focus' : '')}
                onClick={() => { toggle(c.id); setFocus(c.id) }} onDoubleClick={() => onInsert([c.html], 'itemized')}>
                <td className="center">{picked.includes(c.id) ? picked.indexOf(c.id) + 1 : ''}</td>
                <td>{c.name}{c.smart && <span className="tag" title="Has Smart Text fill-ins">✱</span>}</td>
                <td className="ctext">{c.text}{list === 'all' && folderOf[c.id] && <div className="muted small">{folderOf[c.id]}</div>}</td>
                <td className="row-actions" onClick={(e) => e.stopPropagation()}>
                  <button className="icon" title="Edit comment" onClick={() => setEditing({ ...c })}>✎</button>
                  {list === 'item' ? <>
                    <button className="icon" title="Move up" onClick={() => move(c.id, -1)}>↑</button>
                    <button className="icon" title="Move down" onClick={() => move(c.id, 1)}>↓</button>
                    <button className="icon danger" title="Remove from this item" onClick={() => removeFromItem(c.id)}>✕</button>
                  </> : !item.commentIds.includes(c.id) && <button className="icon" title="Add to this item's list" onClick={() => addToItem(c.id)}>＋</button>}
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={4} className="empty">No comments{q ? ' match' : ' for this item yet — switch List to “Whole library” or add a new one'}.</td></tr>}
          </tbody>
        </table>
      </div>
      {editing && <EditComment c={editing} isNew={!T.comments[editing.id]} onSave={saveComment} onClose={() => setEditing(null)} />}
    </Modal>
  )
}

export function EditComment({ c, isNew, onSave, onClose }: { c: Comment; isNew: boolean; onSave: (c: Comment, isNew: boolean) => void; onClose: () => void }) {
  const [name, setName] = useState(c.name)
  const [html, setHtml] = useState(c.html)
  return (
    <Modal title={isNew ? 'New comment' : 'Edit comment'} onClose={onClose} wide
      footer={<><button onClick={onClose}>Cancel</button><button className="primary" disabled={!html.trim()} onClick={() => onSave({ ...c, name, html }, isNew)}>Save to template</button></>}>
      <label className="field"><span>Short name</span><input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></label>
      <div className="field"><span>Comment text <small className="muted">— use *DEFECT(gutter)*-style words for Smart Text</small></span>
        <RichText value={html} onChange={setHtml} minHeight={160} /></div>
      <p className="muted small">Saved to this report and to the template file, so it shows up on your next report too.</p>
    </Modal>
  )
}
