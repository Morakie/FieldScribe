import { useState } from 'react'
import type { Contact, Person } from '../types'
import { useEditor } from './Editor'
import ContactPicker from './ContactPicker'
import { api } from '../util'

const ROLES = ['Buyer Agent', 'Listing Agent', 'Transaction Coordinator', 'Office Manager', 'Lender', 'Other']
const mapUrl = (a: string) => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(a)

function Field({ label, value, onChange, type = 'text', list, wide }: { label: string; value?: string; onChange: (v: string) => void; type?: string; list?: string; wide?: boolean }) {
  return <label className={'field' + (wide ? ' span2' : '')}><span>{label}</span><input type={type} list={list} value={value || ''} onChange={(e) => onChange(e.target.value)} /></label>
}
const fromContact = (c: Contact): Person => ({
  id: c.id, first: c.first, last: c.last, company: c.company, email: c.email, phone: c.phone, workPhone: c.workPhone,
  homePhone: c.homePhone, address: c.address, address2: c.address2, city: c.city, state: c.state, zip: c.zip,
})

/* ---------------- Customer ---------------- */
export function CustomerView() {
  const { r, mutate } = useEditor()
  const [pick, setPick] = useState(false)
  const [i, setI] = useState(0)
  const c = r.clients[Math.min(i, r.clients.length - 1)]
  const set = (k: keyof Person) => (v: string) => mutate(() => { (c as any)[k] = v })
  async function saveToContacts() {
    await api.saveContact({ ...c, id: c.id || crypto.randomUUID(), type: 'Customer' } as Contact)
    if (!c.id) mutate(() => { c.id = crypto.randomUUID() })
    alert('Saved to contacts.')
  }
  return (
    <div className="info pad page-form">
      <h2>Customer Information</h2>
      <div className="row wrap">
        {r.clients.map((x, k) => (
          <button key={k} className={k === i ? 'on' : ''} onClick={() => setI(k)}>{[x.first, x.last].filter(Boolean).join(' ') || `Customer ${k + 1}`}</button>
        ))}
        <button onClick={() => { mutate(() => r.clients.push({ first: '', last: '' })); setI(r.clients.length - 1) }}>＋ Add customer</button>
        <button onClick={() => setPick(true)}>Add from contacts…</button>
        {r.clients.length > 1 && <button className="danger" onClick={() => { if (confirm('Remove this customer from the report?')) { mutate(() => r.clients.splice(i, 1)); setI(0) } }}>Remove</button>}
      </div>
      {c && <div className="form two">
        <Field label="First name" value={c.first} onChange={set('first')} />
        <Field label="Last name" value={c.last} onChange={set('last')} />
        <Field label="Company" value={c.company} onChange={set('company')} wide />
        <Field label="Current / billing address" value={c.address} onChange={set('address')} />
        <Field label="Address line 2" value={c.address2} onChange={set('address2')} />
        <Field label="City" value={c.city} onChange={set('city')} />
        <div className="row"><Field label="State" value={c.state} onChange={set('state')} /><Field label="Zip" value={c.zip} onChange={set('zip')} /></div>
        <Field label="Mobile phone" value={c.phone} onChange={set('phone')} />
        <Field label="Work phone" value={c.workPhone} onChange={set('workPhone')} />
        <Field label="Home phone" value={c.homePhone} onChange={set('homePhone')} />
        <Field label="Email" value={c.email} onChange={set('email')} type="email" />
      </div>}
      {c && <button onClick={saveToContacts}>Save to contacts</button>}
      {pick && <ContactPicker type="Customer" title="Add customer from contacts" onClose={() => setPick(false)}
        onPick={(ct) => { setPick(false); const blank = !c || !(c.first || c.last); mutate(() => { if (blank && r.clients.length) r.clients[i] = fromContact(ct); else r.clients.push(fromContact(ct)) }); if (!blank) setI(r.clients.length - 1) }} />}
    </div>
  )
}

/* ---------------- Report Info ---------------- */
export default function ReportInfoView() {
  const { r, mutate, settings } = useEditor()
  const ins = r.inspection
  const [pick, setPick] = useState(false)
  const [selP, setSelP] = useState<number | null>(null)
  const set = (k: keyof typeof ins) => (v: string) => mutate(() => { (ins as any)[k] = v })
  const fullAddr = [ins.address, ins.address2, ins.city, ins.state, ins.zip].filter(Boolean).join(', ')
  const p = selP !== null ? r.people[selP] : null

  function move(d: number) {
    if (selP === null) return
    const j = selP + d
    if (j < 0 || j >= r.people.length) return
    mutate(() => { const a = r.people; [a[selP], a[j]] = [a[j], a[selP]] }); setSelP(j)
  }
  return (
    <div className="info pad page-form">
      <h2>Report Information</h2>
      <div className="form two">
        <Field label="Report ID" value={r.reportNumber} onChange={(v) => mutate(() => { r.reportNumber = v })} />
        <Field label="Date" type="date" value={ins.date} onChange={set('date')} />
        <Field label="Start time" value={ins.start} onChange={set('start')} />
        <Field label="Stop time" value={ins.end} onChange={set('end')} />
      </div>
      <hr />
      <div className="row"><h3>Address of property to be inspected</h3><span className="grow" />
        <button onClick={() => { const c = r.clients[0]; if (c?.address) mutate(() => { ins.address = c.address || ''; ins.address2 = c.address2 || ''; ins.city = c.city || ''; ins.state = c.state || ''; ins.zip = c.zip || '' }) }}>Use customer address</button>
        <button disabled={!ins.address} onClick={() => api.openExternal(mapUrl(fullAddr))}>Map</button>
      </div>
      <div className="form two">
        <Field label="Address line 1" value={ins.address} onChange={set('address')} />
        <Field label="Address line 2" value={ins.address2} onChange={set('address2')} />
        <Field label="City" value={ins.city} onChange={set('city')} />
        <Field label="State / Prov" value={ins.state} onChange={set('state')} />
        <Field label="Zip / Postal code" value={ins.zip} onChange={set('zip')} />
        <Field label="Country" value={ins.country || 'US'} onChange={set('country')} />
        <Field label="County" value={ins.county} onChange={set('county')} />
        <Field label="MLS #" value={ins.mls} onChange={set('mls')} />
      </div>
      <hr />
      <h3>Real Estate Pros</h3>
      <div className="reps">
        <div className="rep-list">
          <button className="wide" onClick={() => setPick(true)}>Add from REPs list…</button>
          <div className="list-box">
            {r.people.map((x, k) => (
              <div key={k} className={'li' + (k === selP ? ' sel' : '')} onClick={() => setSelP(k)}>
                {x.last}{x.last && x.first ? ', ' : ''}{x.first} {x.role ? `- ${x.role}` : ''}
              </div>
            ))}
            {!r.people.length && <div className="muted pad-s">No agents on this report.</div>}
          </div>
        </div>
        <div className="rep-actions">
          <button disabled={!p} className="danger" onClick={() => { mutate(() => r.people.splice(selP!, 1)); setSelP(null) }}>Remove</button>
          <button disabled={!p || selP === 0} onClick={() => move(-1)}>Move up</button>
          <button disabled={!p || selP === r.people.length - 1} onClick={() => move(1)}>Move down</button>
          {p && <div className="form two rep-edit">
            <label className="field"><span>Role</span><input list="roles" value={p.role || ''} onChange={(e) => mutate(() => { p.role = e.target.value })} /></label>
            <Field label="Company" value={p.company} onChange={(v) => mutate(() => { p.company = v })} />
            <Field label="First" value={p.first} onChange={(v) => mutate(() => { p.first = v })} />
            <Field label="Last" value={p.last} onChange={(v) => mutate(() => { p.last = v })} />
            <Field label="Phone" value={p.phone} onChange={(v) => mutate(() => { p.phone = v })} />
            <Field label="Email" value={p.email} onChange={(v) => mutate(() => { p.email = v })} />
          </div>}
        </div>
      </div>
      <datalist id="roles">{ROLES.map((x) => <option key={x} value={x} />)}</datalist>
      <hr />
      <div className="row"><h3>Inspector</h3><span className="grow" />
        <button onClick={() => settings && mutate(() => { ins.inspector = settings.inspector.name; ins.license = settings.inspector.license; ins.company = settings.inspector.company; ins.inspectorPhone = settings.inspector.phone })}>Current inspector</button>
      </div>
      <div className="form two">
        <Field label="Inspector name" value={ins.inspector} onChange={set('inspector')} />
        <Field label="License #" value={ins.license} onChange={set('license')} />
        <Field label="Company" value={ins.company} onChange={set('company')} />
        <Field label="Phone" value={ins.inspectorPhone} onChange={set('inspectorPhone')} />
      </div>
      <p className="muted small">“Current inspector” fills in the profile saved under Options → Inspector Profile.</p>
      {pick && <ContactPicker type="Rep" title="Add from REPs list" onClose={() => setPick(false)}
        onPick={(ct) => { setPick(false); mutate(() => r.people.push({ ...fromContact(ct), role: 'Buyer Agent' })); setSelP(r.people.length - 1) }} />}
    </div>
  )
}
