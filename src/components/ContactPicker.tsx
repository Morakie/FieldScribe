import { useEffect, useMemo, useState } from 'react'
import type { Contact } from '../types'
import Modal from './Modal'
import { api } from '../util'

/** Search the shared contacts list (imported from HomeGauge) and pick one. */
export default function ContactPicker({ type, title, onPick, onClose }: {
  type: 'Rep' | 'Customer'; title: string; onPick: (c: Contact) => void; onClose: () => void
}) {
  const [all, setAll] = useState<Contact[] | null>(null)
  const [q, setQ] = useState('')
  const [only, setOnly] = useState(true)
  const [sel, setSel] = useState<Contact | null>(null)
  useEffect(() => { api.contacts().then(setAll) }, [])
  const rows = useMemo(() => {
    if (!all) return []
    const ql = q.toLowerCase().trim()
    return all
      .filter((c) => !only || c.type === type)
      .filter((c) => !ql || `${c.first} ${c.last} ${c.company} ${c.email} ${c.phone}`.toLowerCase().includes(ql))
      .sort((a, b) => (a.last + a.first).localeCompare(b.last + b.first))
      .slice(0, 400)
  }, [all, q, only, type])
  return (
    <Modal title={title} onClose={onClose} wide
      footer={<>
        <span className="hint">{all ? `${all.filter((c) => !only || c.type === type).length} contacts` : 'Loading…'}</span>
        <span className="grow" />
        <button onClick={() => onPick({ id: crypto.randomUUID(), type, first: '', last: '' })}>＋ New (blank)</button>
        <button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={!sel} onClick={() => sel && onPick(sel)}>Add</button>
      </>}>
      <div className="picker-bar">
        <input className="search grow" autoFocus placeholder="Search name, company, email or phone…" value={q} onChange={(e) => setQ(e.target.value)} />
        <label><input type="checkbox" checked={only} onChange={(e) => setOnly(e.target.checked)} /> Only {type === 'Rep' ? 'agents/REPs' : 'customers'}</label>
      </div>
      <div className="table-wrap picker-table" style={{ height: '52vh' }}>
        <table className="grid">
          <thead><tr><th>Name</th><th>Company</th><th>Phone</th><th>Email</th></tr></thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className={sel?.id === c.id ? 'sel' : ''} onClick={() => setSel(c)} onDoubleClick={() => onPick(c)}>
                <td>{c.last}{c.last && c.first ? ', ' : ''}{c.first}</td><td>{c.company}</td><td>{c.phone || c.workPhone}</td><td>{c.email}</td>
              </tr>
            ))}
            {all && !rows.length && <tr><td colSpan={4} className="empty">No matches.</td></tr>}
          </tbody>
        </table>
      </div>
    </Modal>
  )
}
