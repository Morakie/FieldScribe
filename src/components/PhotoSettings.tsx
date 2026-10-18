import { useEffect, useState } from 'react'
import Modal from './Modal'
import type { Settings } from '../types'
import { api, prefs, REPORT_SIZES, UPLOAD_EDGES, WORKING_EDGES, photoSettings, savePhotoSettings, workingEdge } from '../util'

export default function PhotoSettingsModal({ onClose }: { onClose: () => void }) {
  const [p, setP] = useState(photoSettings())
  const [work, setWork] = useState(workingEdge())
  const [st, setSt] = useState<Settings | null>(null)
  const [autoEdit, setAutoEdit] = useState(prefs.get('autoEditPhoto', '1') === '1')
  const [root, setRoot] = useState(prefs.get('photoRoot'))
  useEffect(() => { api.getSettings().then(setSt) }, [])
  async function save() {
    savePhotoSettings(p)
    try { localStorage.setItem('workingEdge', String(work)) } catch {}
    prefs.set('autoEditPhoto', autoEdit ? '1' : '0'); prefs.set('photoRoot', root)
    if (st) await api.saveSettings(st)
    onClose()
  }
  return (
    <Modal title="Photo Settings" onClose={onClose}
      footer={<><button onClick={onClose}>Cancel</button><button className="primary" onClick={save}>Save</button></>}>
      <label className="field"><span>Working photo quality (while writing &amp; editing)</span>
        <select value={work} onChange={(e) => setWork(+e.target.value)}>{WORKING_EDGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      </label>
      {st && <label className="field"><span>Upload size (photos are compressed once, when the report is uploaded)</span>
        <select value={st.photos.uploadEdge} onChange={(e) => setSt({ ...st, photos: { ...st.photos, uploadEdge: +e.target.value } })}>{UPLOAD_EDGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      </label>}
      <p className="muted small">Photos stay sharp for zooming and markup while you work. When a report goes out, its photos are shrunk to the upload size. A report that's already been compressed is never compressed again, so the office can review and re-send it without losing quality.</p>
      <label className="row"><input type="checkbox" checked={autoEdit} onChange={(e) => setAutoEdit(e.target.checked)} /> Open the photo editor when a photo is added to an item</label>
      <label className="field"><span>Photo folder picker starts in</span>
        <div className="row"><input value={root} placeholder="(the folder you last browsed)" onChange={(e) => setRoot(e.target.value)} style={{ flex: 1 }} />
          <button onClick={async () => { const f = await api.pickFolder('Default photo folder', root || undefined); if (f) setRoot(f) }}>Browse…</button></div>
      </label>
      <label className="field"><span>Default photo size in the report</span>
        <div className="row">{REPORT_SIZES.map(([k, l]) => <button key={k} className={p.reportSize === k ? 'on' : ''} onClick={() => setP({ ...p, reportSize: k })}>{l}</button>)}</div>
      </label>
    </Modal>
  )
}
