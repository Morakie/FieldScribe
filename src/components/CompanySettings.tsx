import { useEffect, useState } from 'react'
import Modal from './Modal'
import type { Branding } from '../preview'
import { api, imgUrl } from '../util'

export default function CompanySettings({ onClose }: { onClose: () => void }) {
  const [b, setB] = useState<Branding | null>(null)
  const [v, setV] = useState(0)
  useEffect(() => { api.branding().then(setB) }, [])
  if (!b) return null
  const set = (k: keyof Branding['company']) => (e: React.ChangeEvent<HTMLInputElement>) => setB({ ...b, company: { ...b.company, [k]: e.target.value } })
  return (
    <Modal title="Company Settings" onClose={onClose}
      footer={<><button onClick={onClose}>Cancel</button><button className="primary" onClick={async () => { await api.saveBranding(b.company); onClose() }}>Save</button></>}>
      <div className="form two">
        <label className="field span2"><span>Company name</span><input value={b.company.name} onChange={set('name')} /></label>
        <label className="field"><span>Phone</span><input value={b.company.phone} onChange={set('phone')} /></label>
        <label className="field"><span>Email</span><input value={b.company.email} onChange={set('email')} /></label>
        <label className="field span2"><span>Website</span><input value={b.company.website} onChange={set('website')} /></label>
      </div>
      <div className="field"><span>Logo (cover page and invoice)</span>
        <div className="logo-box">
          {b.logo ? <img src={imgUrl(b.logo) + '&v=' + v} /> : <span className="muted">No logo yet — the company name is printed instead.</span>}
          <button onClick={async () => { const n = await api.pickLogo(); setB({ ...n, company: b.company }); setV(v + 1) }}>Choose logo…</button>
        </div>
        <small className="muted">Tip: a large PNG (1000px+ wide) prints sharpest.</small>
      </div>
    </Modal>
  )
}
