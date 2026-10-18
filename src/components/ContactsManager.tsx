import { useEffect, useMemo, useState } from 'react'
import type { Contact } from '../types'
import Modal from './Modal'
import { api } from '../util'

/** Office → Contacts: search, add, edit, delete and export the shared contacts list. */
export default function ContactsManager({ onClose }: { onClose: () => void }) {
  const [all, setAll] = useState<Contact[]>([])
  const [q, setQ] = useState('')
  const [type, setType] = useState<'All' | 'Rep' | 'Customer'>('All')
  const [sel, setSel] = useState<Contact | null>(null)
  const [dirty, setDirty] = useState(false)
  useEffect(() => { api.contacts().then(setAll) }, [])
  const rows = useMemo(() => {
    const ql = q.toLowerCase().trim()
    return all.filter((c) => (type === 'All' || c.type === type) && (!ql || `${c.first} ${c.last} ${c.company} ${c.email} ${c.phone}`.toLowerCase().includes(ql)))
      .sort((a, b) => (a.last + a.first).localeCompare(b.last + b.first)).slice(0, 500)
  }, [all, q, type])
  const f = (k: keyof Contact, label: string) => (
    <label className="field"><span>{label}</span><input value={(sel as any)?.[k] || ''} onChange={(e) => { setSel({ ...sel!, [k]: e.target.value }); setDirty(true) }} /></label>
  )
  async function save() { if (sel) { setAll(await api.saveContact(sel)); setDirty(false) } }
  return (
    <Modal title="Contacts" onClose={onClose} full
      footer={<><span className="hint">{all.length} contacts</span><span className="grow" />
        <button onClick={async () => { const n = await api.importContacts(); if (n) setAll(await api.contacts()) }}>Import HomeGauge CSV…</button>
        <button onClick={() => api.exportContacts()}>Export (CSV/Excel)…</button>
        <button onClick={onClose}>Close</button></>}>
      <div className="contacts-mgr">
        <div className="cm-list">
          <div className="picker-bar">
            <input className="search grow" autoFocus placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
            <select value={type} onChange={(e) => setType(e.target.value as any)}><option>All</option><option value="Rep">Agents / REPs</option><option value="Customer">Customers</option></select>
            <button onClick={() => { setSel({ id: crypto.randomUUID(), type: type === 'Customer' ? 'Customer' : 'Rep', first: '', last: '' }); setDirty(true) }}>＋ New</button>
          </div>
          <div className="table-wrap picker-table">
            <table className="grid">
              <thead><tr><th>Name</th><th>Company</th><th>Phone</th><th>Email</th><th>Type</th></tr></thead>
              <tbody>{rows.map((c) => (
                <tr key={c.id} className={sel?.id === c.id ? 'sel' : ''} onClick={() => { if (!dirty || confirm('Discard unsaved changes?')) { setSel({ ...c }); setDirty(false) } }}>
                  <td>{c.last}{c.last && c.first ? ', ' : ''}{c.first}</td><td>{c.company}</td><td>{c.phone || c.workPhone}</td><td>{c.email}</td><td className="muted">{c.type === 'Rep' ? 'Agent' : 'Customer'}</td>
                </tr>))}</tbody>
            </table>
          </div>
        </div>
        <div className="cm-edit">
          {sel ? <>
            <div className="form two">
              <label className="field span2"><span>Type</span><select value={sel.type} onChange={(e) => { setSel({ ...sel, type: e.target.value as any }); setDirty(true) }}><option value="Rep">Agent / REP</option><option value="Customer">Customer</option></select></label>
              {f('first', 'First')}{f('last', 'Last')}{f('company', 'Company')}{f('email', 'Email')}{f('phone', 'Mobile')}{f('workPhone', 'Work phone')}
              {f('address', 'Address')}{f('city', 'City')}{f('state', 'State')}{f('zip', 'Zip')}
            </div>
            <label className="field"><span>Note</span><textarea rows={3} value={sel.note || ''} onChange={(e) => { setSel({ ...sel, note: e.target.value }); setDirty(true) }} /></label>
            <div className="row">
              <button className="primary" disabled={!dirty} onClick={save}>Save</button>
              <button className="danger" onClick={async () => { if (confirm('Delete this contact?')) { setAll(await api.deleteContact(sel.id)); setSel(null); setDirty(false) } }}>Delete</button>
            </div>
          </> : <p className="muted">Select a contact to edit, or click ＋ New.</p>}
        </div>
      </div>
    </Modal>
  )
}
