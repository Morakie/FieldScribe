import { useEffect, useState } from 'react'
import Modal from './Modal'
import type { Settings } from '../types'
import { api } from '../util'

/** The inspector who uses this computer — filled into new reports and the "Current inspector" button. */
export default function InspectorProfile({ onClose }: { onClose: () => void }) {
  const [st, setSt] = useState<Settings | null>(null)
  useEffect(() => { api.getSettings().then(setSt) }, [])
  if (!st) return null
  const f = (k: keyof Settings['inspector'], label: string) => (
    <label className="field"><span>{label}</span><input value={st.inspector[k]} onChange={(e) => setSt({ ...st, inspector: { ...st.inspector, [k]: e.target.value } })} /></label>
  )
  return (
    <Modal title="Inspector Profile (this computer)" onClose={onClose}
      footer={<><button onClick={onClose}>Cancel</button><button className="primary" onClick={async () => { await api.saveSettings(st); onClose() }}>Save</button></>}>
      <div className="form two">{f('name', 'Inspector name')}{f('license', 'License #')}{f('company', 'Company')}{f('phone', 'Phone')}{f('email', 'Email')}</div>
    </Modal>
  )
}
