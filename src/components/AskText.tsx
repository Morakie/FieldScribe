import { useState } from 'react'
import Modal from './Modal'

/** A small "type a name/label" dialog (Electron has no window.prompt). */
export default function AskText({ title, label, initial = '', okLabel = 'OK', onOk, onClose }: {
  title: string; label: string; initial?: string; okLabel?: string; onOk: (v: string) => void; onClose: () => void
}) {
  const [v, setV] = useState(initial)
  const ok = () => { onOk(v.trim()); onClose() }
  return (
    <Modal title={title} onClose={onClose} footer={<><span className="grow" /><button className="primary" onClick={ok}>{okLabel}</button><button onClick={onClose}>Cancel</button></>}>
      <label className="field"><span>{label}</span>
        <input autoFocus value={v} onChange={(e) => setV(e.target.value)} onFocus={(e) => e.target.select()} onKeyDown={(e) => { if (e.key === 'Enter') ok() }} /></label>
    </Modal>
  )
}
