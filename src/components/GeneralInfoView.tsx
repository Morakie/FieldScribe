import { useMemo, useState } from 'react'
import Modal from './Modal'
import { useEditor } from './Editor'
import { MaterialsEditor } from './MaterialsView'
import RichText from './RichText'
import Split from './Split'
import { api, imgUrl, joinPath } from '../util'
import { importPhoto } from '../photoOps'
import CommentPicker from './CommentPicker'
import SmartFill from './SmartFill'
import { smartKeys } from '../util'

/** General Report Information: introduction text, cover page picture, general items (standards, weather, …). */
export default function GeneralInfoView() {
  const { r, mutate, dir, version } = useEditor()
  const photos = useMemo(() => {
    const out: { file: string; caption: string }[] = []
    const seen = new Set<string>()
    const add = (f: string, c: string) => { if (f && !seen.has(f)) { seen.add(f); out.push({ file: f, caption: c }) } }
    for (const s of r.sections) for (const i of s.instances) for (const it of i.items) for (const e of it.entries) for (const p of e.photos) add(p.file, p.caption)
    return out
  }, [r, version])
  const [choosing, setChoosing] = useState(false)
  const [picker, setPicker] = useState(false)
  const [smart, setSmart] = useState<string | null>(null)
  const addHtml = (h: string) => mutate(() => {
    const cur = r.generalInfo.html || ''
    r.generalInfo.html = cur.replace(/<[^>]+>|\s|&nbsp;/g, '') ? cur + h : h
  })
  function insert(htmls: string[], mode: 'itemized' | 'one') {
    setPicker(false)
    const h = mode === 'one' ? `<p>${htmls.map((x) => x.replace(/<\/?p[^>]*>/g, ' ').trim()).join(' ')}</p>` : htmls.map((x) => (/^\s*<p/i.test(x) ? x : `<p>${x}</p>`)).join('')
    if (smartKeys(h).length) setSmart(h); else addHtml(h)
  }
  async function fromFile() {
    const [f] = await api.pickFiles('Choose a cover photo')
    if (!f) return
    const file = await importPhoto(r.id, f)
    mutate(() => { r.coverPhoto = file })
  }
  return (
    <div className="general2">
      <Split id="general-top" dir="v" initial={0.5} min={150} max={1400}>{[
        <Split key="t" id="general-cover" dir="h" initial={300} min={200} max={600} fixed="second">{[
          <div key="i" className="pad gen-intro">
            <div className="row"><h3 style={{ margin: 0 }}>Report Introduction</h3><span className="grow" />
              <button className="primary" onClick={() => setPicker(true)} title="Insert comments from the General Information list or the whole library">✨ Comments</button></div>
            <RichText value={r.generalInfo.html} minHeight={120} onChange={(h) => mutate(() => { r.generalInfo.html = h })} />
          </div>,
          <div key="c" className="cover-panel">
            <b>Cover Page Picture</b>
            <div className={'cover-img' + (r.coverPhoto ? '' : ' empty')} onClick={() => !r.coverPhoto && setChoosing(true)}>
              {r.coverPhoto ? <img src={imgUrl(joinPath(dir, r.coverPhoto)) + '&m=800'} /> : <span className="muted">No cover photo yet.<br />Click to choose one.</span>}
            </div>
            <input placeholder="<Enter picture label>" value={r.coverLabel || ''} onChange={(e) => mutate(() => { r.coverLabel = e.target.value })} />
            <div className="row wrap">
              <button onClick={() => setChoosing(true)} disabled={!photos.length}>Choose from report photos…</button>
              <button onClick={fromFile}>From disk…</button>
              {r.coverPhoto && <button onClick={() => mutate(() => { r.coverPhoto = undefined })}>Clear</button>}
            </div>
            <p className="muted small">Tip: the ☆ on any photo in an item also sets it as the cover.</p>
          </div>,
        ]}</Split>,
        <div key="b" className="gen-items">
          {picker && <CommentPicker itemId="general" onInsert={insert} onClose={() => setPicker(false)} />}
          {smart !== null && <SmartFill html={smart} onClose={() => { addHtml(smart); setSmart(null) }} onDone={(h) => { addHtml(h); setSmart(null) }} />}
          {choosing && <Modal title="Choose the cover photo" onClose={() => setChoosing(false)} full>
            <div className="cover-choose">
              {photos.map((p) => (
                <figure key={p.file} className={p.file === r.coverPhoto ? 'on' : ''} onClick={() => { mutate(() => { r.coverPhoto = p.file }); setChoosing(false) }}>
                  <img src={imgUrl(joinPath(dir, p.file)) + '&m=400'} loading="lazy" /><figcaption>{p.caption || '\u00a0'}</figcaption>
                </figure>
              ))}
            </div>
          </Modal>}<div className="small muted pad-s">General Items</div><MaterialsEditor answers={r.generalInfo.materials} owner={{ kind: 'general' }} /></div>,
      ]}</Split>
    </div>
  )
}
