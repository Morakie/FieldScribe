import { useEditor } from './Editor'
import { imgUrl, joinPath } from '../util'

export default function SummaryView() {
  const { r, mutate, setSel, dir } = useEditor()
  const rows = r.sections.filter((s) => !s.excluded).flatMap((s) => s.instances.flatMap((inst) =>
    inst.items.flatMap((it, itemIdx) => it.entries.map((e, entryIdx) => ({ s, inst, it, e, itemIdx, entryIdx })).filter((x) => x.e.summary))))
  return (
    <div className="summary pad">
      <h2>Summary <span className="muted small">— {rows.length} comment(s). Tick “Include in Summary” on any comment to add it here.</span></h2>
      {rows.map(({ s, inst, it, e, itemIdx, entryIdx }) => (
        <div key={e.id} className="sum-row" onDoubleClick={() => setSel({ kind: 'section', sectionId: s.id, instanceId: inst.id, tab: 'items', itemIdx, entryIdx })}>
          <div className="sum-head">
            <b>{inst.name}</b> › {r.template.items[it.itemId]?.title}
            <span className="grow" />
            <button className="link" onClick={() => setSel({ kind: 'section', sectionId: s.id, instanceId: inst.id, tab: 'items', itemIdx, entryIdx })}>Go to</button>
            <button className="link danger" onClick={() => mutate(() => { e.summary = false })}>Remove from summary</button>
          </div>
          <div className="sum-text" dangerouslySetInnerHTML={{ __html: e.html }} />
          <div className="sum-pics">{e.photos.map((p, i) => <img key={i} src={imgUrl(joinPath(dir, p.file))} />)}</div>
        </div>
      ))}
    </div>
  )
}
