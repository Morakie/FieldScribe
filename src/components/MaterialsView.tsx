import { useEffect, useState } from 'react'
import type { MaterialAnswer, Section } from '../types'
import { useEditor } from './Editor'
import { uid } from '../util'

type Owner = { kind: 'section'; section: Section } | { kind: 'general' }

/**
 * Styles & Materials (also used for General Info items): pick options, exclude lists, and
 * add / rename / delete / reorder both the lists and their options. Structure changes are
 * saved to the template as well, so the next report gets them.
 */
export function MaterialsEditor({ answers, owner }: { answers: MaterialAnswer[]; owner: Owner }) {
  const { r, mutate, editTemplate } = useEditor()
  const [idx, setIdx] = useState(0)
  const [optIdx, setOptIdx] = useState<number | null>(null)
  const [quick, setQuick] = useState('')
  const [naming, setNaming] = useState<{ what: 'addList' | 'renameList' | 'renameOpt'; value: string } | null>(null)
  useEffect(() => {
    const f = (e: Event) => { const k = answers.findIndex((x) => x.materialId === (e as CustomEvent).detail); if (k >= 0) { setIdx(k); setOptIdx(null) } }
    window.addEventListener('bridge-sm-select', f)
    return () => window.removeEventListener('bridge-sm-select', f)
  }, [answers])
  const a = answers[Math.min(idx, answers.length - 1)]
  const m = a ? r.template.materials[a.materialId] : null

  /* ---- helpers to touch every place a list lives ---- */
  const allAnswerArrays = (): MaterialAnswer[][] =>
    owner.kind === 'section' ? owner.section.instances.map((i) => i.materials) : [r.generalInfo.materials]
  const tplIds = (t: any): string[] | undefined =>
    owner.kind === 'section' ? t.sections?.find((s: any) => s.group === owner.section.group && s.name === owner.section.name)?.materialIds : t.generalInfo?.materialIds

  function addList(name: string) {
    const id = 'SM-' + uid().toUpperCase()
    editTemplate((t: any) => { t.materials[id] = { id, name, options: [], extraInfoLabel: null }; const ids = tplIds(t); if (ids && !ids.includes(id)) ids.push(id) })
    mutate(() => {
      if (owner.kind === 'section') owner.section.materialIds.push(id)
      allAnswerArrays().forEach((arr) => arr.push({ materialId: id, selected: [], extraInfo: '' }))
    })
    setIdx(answers.length - 1)
  }
  function deleteList() {
    if (!a || !m || !confirm(`Remove the "${m.name}" list from ${owner.kind === 'section' ? owner.section.name : 'General Info'}? (Also removed from the template.)`)) return
    const id = a.materialId
    editTemplate((t: any) => { const ids = tplIds(t); if (ids) ids.splice(ids.indexOf(id), 1) })
    mutate(() => {
      if (owner.kind === 'section') owner.section.materialIds = owner.section.materialIds.filter((x) => x !== id)
      allAnswerArrays().forEach((arr) => { const k = arr.findIndex((x) => x.materialId === id); if (k >= 0) arr.splice(k, 1) })
    })
    setIdx(Math.max(0, idx - 1))
  }
  function moveList(d: number) {
    if (!a) return
    const id = a.materialId, j = idx + d
    if (j < 0 || j >= answers.length) return
    const other = answers[j].materialId
    const swap = (arr: { materialId?: string }[] | string[], key?: boolean) => {
      const ids = (arr as any[]).map((x) => (key ? x : x.materialId))
      const p = ids.indexOf(id), q = ids.indexOf(other)
      if (p >= 0 && q >= 0) [(arr as any[])[p], (arr as any[])[q]] = [(arr as any[])[q], (arr as any[])[p]]
    }
    editTemplate((t: any) => { const ids = tplIds(t); if (ids) swap(ids, true) })
    mutate(() => { if (owner.kind === 'section') swap(owner.section.materialIds, true); allAnswerArrays().forEach((arr) => swap(arr)) })
    setIdx(j)
  }

  function addOption() {
    const v = quick.trim()
    if (!v || !m) return
    if (!m.options.includes(v)) editTemplate((t) => { t.materials[a.materialId].options.push(v) })
    mutate(() => { if (!a.selected.includes(v)) a.selected.push(v) })
    setQuick('')
  }
  function renameOpt(oldV: string, newV: string) {
    if (!newV || newV === oldV) return
    editTemplate((t) => { const o = t.materials[a.materialId].options; const k = o.indexOf(oldV); if (k >= 0) o[k] = newV })
    mutate(() => allAnswerArrays().forEach((arr) => arr.forEach((x) => { if (x.materialId === a.materialId) x.selected = x.selected.map((s) => (s === oldV ? newV : s)) })))
  }
  function deleteOpt(v: string) {
    if (!confirm(`Delete the option "${v}" from this list? (Also removed from the template.)`)) return
    editTemplate((t) => { const o = t.materials[a.materialId].options; const k = o.indexOf(v); if (k >= 0) o.splice(k, 1) })
    mutate(() => { a.selected = a.selected.filter((s) => s !== v) })
    setOptIdx(null)
  }
  function moveOpt(d: number) {
    if (optIdx === null || !m) return
    const j = optIdx + d
    if (j < 0 || j >= m.options.length) return
    editTemplate((t) => { const o = t.materials[a.materialId].options; [o[optIdx], o[j]] = [o[j], o[optIdx]] })
    setOptIdx(j)
  }
  const sortOpts = () => editTemplate((t) => { t.materials[a.materialId].options.sort((x, y) => x.localeCompare(y, undefined, { numeric: true })) })

  function commitName() {
    const v = naming?.value.trim()
    if (v && naming) {
      if (naming.what === 'addList') addList(v)
      if (naming.what === 'renameList' && a) editTemplate((t) => { t.materials[a.materialId].name = v })
      if (naming.what === 'renameOpt' && m && optIdx !== null) renameOpt(m.options[optIdx], v)
    }
    setNaming(null)
  }

  const opts = m ? [...m.options, ...a.selected.filter((s) => !m.options.includes(s))] : []
  return (
    <div className="sm-view">
      <div className="sm-list">
        <div className="sm-tools">
          <button title="Add a new list" onClick={() => setNaming({ what: 'addList', value: '' })}>＋ Add</button>
          <button disabled={!m} title="Rename list" onClick={() => setNaming({ what: 'renameList', value: m?.name || '' })}>✎ Edit</button>
          <button disabled={!m} title="Delete list" onClick={deleteList}>✕ Delete</button>
          <button disabled={!m || idx === 0} title="Move up" onClick={() => moveList(-1)}>↑</button>
          <button disabled={!m || idx >= answers.length - 1} title="Move down" onClick={() => moveList(1)}>↓</button>
        </div>
        {naming && naming.what !== 'renameOpt' && (
          <div className="inline-name block pad-s">
            <input autoFocus value={naming.value} placeholder="List name, e.g. Water Source" onChange={(e) => setNaming({ ...naming, value: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter') commitName(); if (e.key === 'Escape') setNaming(null) }} />
            <button className="primary" onClick={commitName}>OK</button><button onClick={() => setNaming(null)}>Cancel</button>
          </div>
        )}
        <table className="grid">
          <thead><tr><th>Name</th><th>Selected</th><th style={{ width: 34 }} className="center" title="Exclude from report">X</th></tr></thead>
          <tbody>
            {answers.map((x, i) => (
              <tr key={x.materialId + i} className={(i === idx ? 'sel ' : '') + (x.excluded ? 'excluded' : '')} onClick={() => { setIdx(i); setOptIdx(null) }}>
                <td>{r.template.materials[x.materialId]?.name}</td>
                <td className="muted">{x.selected.join(', ')}{x.extraInfo ? ` · ${x.extraInfo}` : ''}</td>
                <td className="center" onClick={(e) => e.stopPropagation()}><input type="checkbox" title="Exclude from report (e.g. no water heater)" checked={!!x.excluded} onChange={(e) => mutate(() => { x.excluded = e.target.checked })} /></td>
              </tr>
            ))}
            {!answers.length && <tr><td colSpan={3} className="empty">No lists yet — click ＋ Add.</td></tr>}
          </tbody>
        </table>
      </div>
      {m && (
        <div className="sm-opts">
          <div className="sm-head">Options for: <b>{m.name}</b>
            <label className={'sec-ex' + (a.excluded ? ' on' : '')} style={{ marginLeft: 12 }}><input type="checkbox" checked={!!a.excluded} onChange={(e) => mutate(() => { a.excluded = e.target.checked })} /> Exclude from report</label></div>
          <div className="quick">
            <input placeholder="Quick add: type here, then press Enter" value={quick} onChange={(e) => setQuick(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addOption()} />
            <button onClick={addOption} title="Add option">＋</button>
          </div>
          <div className="opt-wrap">
            <div className="opt-list">
              {opts.map((o, k) => (
                <label key={o} className={'opt' + (a.selected.includes(o) ? ' on' : '') + (k === optIdx ? ' focus' : '')} onClick={() => setOptIdx(k)}>
                  <input type="checkbox" checked={a.selected.includes(o)}
                    onChange={(e) => mutate(() => { a.selected = e.target.checked ? [...a.selected, o] : a.selected.filter((x) => x !== o) })} />
                  {naming?.what === 'renameOpt' && k === optIdx
                    ? <input autoFocus value={naming.value} onClick={(e) => e.preventDefault()} onChange={(e) => setNaming({ ...naming, value: e.target.value })}
                      onKeyDown={(e) => { if (e.key === 'Enter') commitName(); if (e.key === 'Escape') setNaming(null) }} onBlur={commitName} />
                    : o}
                </label>
              ))}
            </div>
            <div className="opt-tools">
              <button disabled={optIdx === null || optIdx >= m.options.length} title="Edit option" onClick={() => setNaming({ what: 'renameOpt', value: m.options[optIdx!] })}>✎</button>
              <button disabled={optIdx === null || optIdx >= m.options.length} className="danger" title="Delete option" onClick={() => deleteOpt(m.options[optIdx!])}>✕</button>
              <button disabled={optIdx === null || optIdx === 0} title="Move up" onClick={() => moveOpt(-1)}>↑</button>
              <button disabled={optIdx === null || optIdx >= m.options.length - 1} title="Move down" onClick={() => moveOpt(1)}>↓</button>
              <button title="Sort A–Z" onClick={sortOpts}>ABC</button>
            </div>
          </div>
          <label className="field"><span>{m.extraInfoLabel || 'Extra info'}</span>
            <input value={a.extraInfo || ''} onChange={(e) => mutate(() => { a.extraInfo = e.target.value })} />
          </label>
        </div>
      )}
    </div>
  )
}

export default function MaterialsView({ section, instance }: { section: Section; instance: { materials: MaterialAnswer[] } }) {
  return <MaterialsEditor answers={instance.materials} owner={{ kind: 'section', section }} />
}
