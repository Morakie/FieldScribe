import { useState } from 'react'
import type { Section } from '../types'
import { useEditor } from './Editor'
import { instanceProgress, sectionNumber, uid } from '../util'

/** Section container page: exclude, duplicate, rename, reorder, add/delete whole sections. */
export default function ComponentsView({ group }: { group: string }) {
  const { r, mutate, setSel } = useEditor()
  const secs = r.sections.filter((s) => s.group === group)
  const [pick, setPick] = useState<{ sid: string; iid: string } | null>(null)
  const [name, setName] = useState<{ mode: 'dup' | 'rename' | 'new'; value: string } | null>(null)
  const ps = pick && r.sections.find((s) => s.id === pick.sid)
  const pi = ps?.instances.findIndex((i) => i.id === pick!.iid) ?? -1

  function blankInstance(s: Section, n: string) {
    const T = r.template
    const join = (ids: string[]) => ids.map((id) => T.comments[id]?.html).filter(Boolean).join('\n')
    return {
      id: uid(), name: n, introHtml: join(s.introCommentIds), footerHtml: join(s.footerCommentIds),
      items: s.itemIds.map((itemId) => ({ itemId, ratings: [], excluded: false, entries: [] })),
      materials: s.materialIds.map((materialId) => ({ materialId, selected: [], extraInfo: '' })),
    }
  }
  function commit() {
    const v = name?.value.trim()
    if (!v) return setName(null)
    if (name!.mode === 'new') {
      const s: Section = { id: uid(), group, name: v, excluded: false, repeatNames: [], ratingColumns: null, itemIds: [], materialIds: [], introCommentIds: [], footerCommentIds: [], instances: [] }
      s.instances.push(blankInstance(s, v))
      mutate((rr) => { const last = rr.sections.map((x) => x.group).lastIndexOf(group); rr.sections.splice(last + 1, 0, s) })
    } else if (ps) {
      if (name!.mode === 'dup') mutate(() => { ps.instances.splice(pi + 1, 0, blankInstance(ps, v)) })
      else mutate(() => {
        ps.instances[pi].name = v
        if (pi === 0 && ps.instances.length === 1) ps.name = v
      })
    }
    setName(null)
  }
  function moveSection(d: number) {
    if (!ps) return
    mutate((rr) => {
      const a = rr.sections; const i = a.indexOf(ps)
      let j = i + d
      while (j >= 0 && j < a.length && a[j].group !== group) j += d
      if (j < 0 || j >= a.length) return
      ;[a[i], a[j]] = [a[j], a[i]]
    })
  }
  function moveInstance(d: number) {
    if (!ps) return
    const j = pi + d
    if (j < 0 || j >= ps.instances.length) return
    mutate(() => { const a = ps.instances; [a[pi], a[j]] = [a[j], a[pi]] })
  }
  function remove() {
    if (!ps) return
    const what = ps.instances.length > 1 ? `the duplicate "${ps.instances[pi].name}"` : `the whole section "${ps.name}"`
    if (!confirm(`Delete ${what} from this report? Anything written there will be lost.`)) return
    mutate((rr) => {
      if (ps.instances.length > 1) ps.instances.splice(pi, 1)
      else rr.sections.splice(rr.sections.indexOf(ps), 1)
    })
    setPick(null)
  }

  return (
    <div className="components pad">
      <div className="small muted">SECTION CONTAINER</div>
      <h2>{group}</h2>
      <table className="grid comps">
        <thead><tr><th style={{ width: 70 }}>Status</th><th>Sections & Duplicates</th><th style={{ width: 160 }} className="center">Exclude from report</th></tr></thead>
        <tbody>
          {secs.map((s) => s.instances.map((inst, ii) => {
            const p = instanceProgress(inst)
            const on = pick?.iid === inst.id
            return (
              <tr key={inst.id} className={(on ? 'sel ' : '') + (s.excluded ? 'excluded' : '')} onClick={() => setPick({ sid: s.id, iid: inst.id })}
                onDoubleClick={() => setSel({ kind: 'section', sectionId: s.id, instanceId: inst.id, tab: 'items', itemIdx: 0, entryIdx: 0 })}>
                <td className="center">{p.total && p.done === p.total ? '✔' : `${p.done}/${p.total}`}</td>
                <td style={{ paddingLeft: ii ? 34 : 8 }}>{ii === 0 ? <><b className="num">{sectionNumber(r, s)}</b> {s.name}{s.instances.length > 1 && inst.name !== s.name ? ` · ${inst.name}` : ''}</> : <>↳ {inst.name}</>}</td>
                <td className="center" onClick={(e) => e.stopPropagation()}>
                  {ii === 0 && <input type="checkbox" checked={s.excluded} onChange={(e) => mutate(() => { s.excluded = e.target.checked })} />}
                </td>
              </tr>
            )
          }))}
        </tbody>
      </table>
      <div className="comp-actions">
        <div className="small muted">Duplicate section actions {ps ? `— ${ps.instances[pi]?.name}` : '(select a row)'}</div>
        <button disabled={!ps} onClick={() => setName({ mode: 'dup', value: '' })}>⧉ Add duplicate</button>
        <button disabled={!ps} onClick={() => setName({ mode: 'rename', value: ps?.instances[pi]?.name || '' })}>✎ Rename</button>
        <button disabled={!ps} onClick={remove}>✕ Delete</button>
        <button disabled={!ps} onClick={() => (ps!.instances.length > 1 ? moveInstance(-1) : moveSection(-1))}>↑ Move up</button>
        <button disabled={!ps} onClick={() => (ps!.instances.length > 1 ? moveInstance(1) : moveSection(1))}>↓ Move down</button>
        <span className="sep" />
        <button onClick={() => setName({ mode: 'new', value: '' })}>＋ New section</button>
      </div>
      {name && (
        <div className="inline-name block">
          <span>{{ dup: 'Name for the duplicate', rename: 'New name', new: 'New section name' }[name.mode]}:</span>
          <input autoFocus list="repeat-names" value={name.value} onChange={(e) => setName({ ...name, value: e.target.value })}
            onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setName(null) }} />
          <datalist id="repeat-names">{ps?.repeatNames.map((n) => <option key={n} value={n} />)}</datalist>
          <button className="primary" onClick={commit}>OK</button><button onClick={() => setName(null)}>Cancel</button>
          {name.mode === 'dup' && !!ps?.repeatNames.length && <div className="chips">{ps.repeatNames.map((n) => <button key={n} className="chip" onClick={() => setName({ ...name, value: n })}>{n}</button>)}</div>}
        </div>
      )}
      <p className="muted small">Tip: double-click a row to open it. Duplicates (Main Roof / Garage Roof, Unit 1 / Unit 2…) get the same items, a fresh copy of the intro and footer, and are written up separately.</p>
    </div>
  )
}
