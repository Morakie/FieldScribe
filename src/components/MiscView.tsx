import { useState } from 'react'
import type { Settings } from '../types'
import { useEditor } from './Editor'
import Modal from './Modal'
import { api } from '../util'

type ListKey = keyof Settings['lists']
const money = (c: number) => (c / 100).toFixed(2)
const toCents = (s: string) => Math.round((parseFloat(s.replace(/[$,]/g, '')) || 0) * 100)

/** Edit one of the shared pick lists (lead sources, payment methods…), one item per line. */
function ListEditor({ k, title, onClose }: { k: ListKey; title: string; onClose: () => void }) {
  const { settings, saveSettings } = useEditor()
  const [text, setText] = useState((settings?.lists[k] || []).join('\n'))
  return (
    <Modal title={title} onClose={onClose}
      footer={<><button onClick={onClose}>Cancel</button><button className="primary" onClick={() => { if (settings) saveSettings({ ...settings, lists: { ...settings.lists, [k]: text.split('\n').map((s) => s.trim()).filter(Boolean) } }); onClose() }}>Save</button></>}>
      <p className="muted small">One per line. Shared by every report on this computer.</p>
      <textarea rows={14} value={text} onChange={(e) => setText(e.target.value)} />
    </Modal>
  )
}

function PickList({ k, label, value, onChange }: { k: ListKey; label: string; value: string; onChange: (v: string) => void }) {
  const { settings } = useEditor()
  const [edit, setEdit] = useState(false)
  const id = 'list-' + k
  return (
    <label className="field pick"><span>{label}</span>
      <div className="row">
        <input list={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder="Choose or type…" />
        <button onClick={(e) => { e.preventDefault(); setEdit(true) }}>Edit list</button>
      </div>
      <datalist id={id}>{(settings?.lists[k] || []).map((x) => <option key={x} value={x} />)}</datalist>
      {edit && <ListEditor k={k} title={`Edit ${label}`} onClose={() => setEdit(false)} />}
    </label>
  )
}

export default function MiscView() {
  const [tab, setTab] = useState<'info' | 'attach' | 'invoice'>('info')
  return (
    <div className="misc">
      <div className="tabs">
        <button className={tab === 'info' ? 'on' : ''} onClick={() => setTab('info')}>📄 Inspector Info</button>
        <button className={tab === 'attach' ? 'on' : ''} onClick={() => setTab('attach')}>📎 Attachments</button>
        <button className={tab === 'invoice' ? 'on' : ''} onClick={() => setTab('invoice')}>▦ Invoice</button>
      </div>
      {tab === 'info' && <InspectorInfo />}
      {tab === 'attach' && <Attachments />}
      {tab === 'invoice' && <Invoice />}
    </div>
  )
}

function InspectorInfo() {
  const { r, mutate } = useEditor()
  const m = (r.misc ||= {})
  const addr = [r.inspection.address, r.inspection.city, r.inspection.state, r.inspection.zip].filter(Boolean).join(', ')
  return (
    <div className="pad page-form">
      <h2>Inspector Info Page</h2>
      <label className="field"><span>Inspector comments (scheduling notes — not printed in the report)</span>
        <textarea rows={7} value={r.inspection.notes} onChange={(e) => mutate(() => { r.inspection.notes = e.target.value })} /></label>
      <div className="form two">
        <PickList k="leadSources" label="Lead source" value={m.leadSource || ''} onChange={(v) => mutate(() => { m.leadSource = v })} />
        <label className="field"><span>Mileage for this report</span><input value={m.mileage || ''} onChange={(e) => mutate(() => { m.mileage = e.target.value })} style={{ maxWidth: 140 }} /></label>
      </div>
      <label className="field"><span>Driving directions</span>
        <textarea rows={6} value={m.directions || ''} onChange={(e) => mutate(() => { m.directions = e.target.value })} /></label>
      <div className="row">
        <button disabled={!addr} onClick={() => api.openExternal('https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(addr))}>Map</button>
        <button disabled={!addr} onClick={() => api.openExternal('https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(addr))}>Directions</button>
      </div>
    </div>
  )
}

function Attachments() {
  const { r, mutate } = useEditor()
  const list = (r.attachments ||= [])
  return (
    <div className="pad page-form">
      <h2>Attachments</h2>
      <p className="muted small">PDFs and images added here are appended to the end of the report PDF (in this order) when “Include” is ticked — e.g. agreements, mold lab results, sewer scope reports, manufacturer recalls.</p>
      <div className="row">
        <button className="primary" onClick={async () => { const add = await api.addAttachments(r.id); if (add.length) mutate(() => list.push(...add)) }}>＋ Add files…</button>
      </div>
      <table className="grid narrow" style={{ marginTop: 10, minWidth: 600 }}>
        <thead><tr><th style={{ width: 70 }}>Include</th><th>Name in report</th><th>File</th><th style={{ width: 210 }} /></tr></thead>
        <tbody>
          {list.map((a, i) => (
            <tr key={a.file}>
              <td className="center"><input type="checkbox" checked={a.include} onChange={(e) => mutate(() => { a.include = e.target.checked })} /></td>
              <td><input value={a.name} onChange={(e) => mutate(() => { a.name = e.target.value })} style={{ width: '100%' }} /></td>
              <td className="muted">{a.file}</td>
              <td className="row-actions">
                <button className="icon" onClick={() => api.openAttachment(r.id, a.file)}>Open</button>
                <button className="icon" disabled={i === 0} onClick={() => mutate(() => { [list[i - 1], list[i]] = [list[i], list[i - 1]] })}>↑</button>
                <button className="icon" disabled={i === list.length - 1} onClick={() => mutate(() => { [list[i + 1], list[i]] = [list[i], list[i + 1]] })}>↓</button>
                <button className="icon danger" onClick={() => { if (confirm(`Remove "${a.name}" from this report?`)) mutate(() => list.splice(i, 1)) }}>✕</button>
              </td>
            </tr>
          ))}
          {!list.length && <tr><td colSpan={4} className="empty">No attachments yet.</td></tr>}
        </tbody>
      </table>
    </div>
  )
}

function Invoice() {
  const { r, mutate, settings, saveSettings } = useEditor()
  const inv = (r.invoice ||= { taxCents: 0, method: '', status: '', note: '' })
  const [sel, setSel] = useState<number | null>(null)
  const sub = r.services.filter((s) => s.selected).reduce((n, s) => n + s.priceCents * s.qty, 0)
  function move(d: number) {
    if (sel === null) return
    const j = sel + d
    if (j < 0 || j >= r.services.length) return
    mutate(() => { const a = r.services; [a[sel], a[j]] = [a[j], a[sel]] }); setSel(j)
  }
  return (
    <div className="pad page-form invoice-page">
      <div className="row"><h2>Invoice</h2><span className="grow" />
        <button onClick={() => { mutate(() => r.services.push({ name: 'New service', priceCents: 0, qty: 1, selected: true })); setSel(r.services.length - 1) }}>＋ Add service</button>
        <button disabled={sel === null} onClick={() => move(-1)}>↑</button>
        <button disabled={sel === null} onClick={() => move(1)}>↓</button>
        <button disabled={sel === null} className="danger" onClick={() => { mutate(() => r.services.splice(sel!, 1)); setSel(null) }}>✕ Delete</button>
        <span className="sep" />
        <button title="Replace your default price list (used for new reports) with this list" onClick={() => {
          if (settings && confirm('Make this list (names and prices) the default price list for new reports?')) saveSettings({ ...settings, services: r.services.map((s) => ({ name: s.name, priceCents: s.priceCents })) })
        }}>Save as default price list</button>
        <button title="Add any services from your default price list that are missing here" onClick={() => {
          const have = new Set(r.services.map((s) => s.name))
          mutate(() => settings?.services.forEach((s) => { if (!have.has(s.name)) r.services.push({ ...s, qty: 1, selected: false }) }))
        }}>Load default list</button>
      </div>
      <div className="table-wrap inv-table">
        <table className="grid">
          <thead><tr><th style={{ width: 70 }}>Included</th><th>Service</th><th style={{ width: 110 }} className="right">Price</th><th style={{ width: 80 }} className="right">Amount</th><th style={{ width: 110 }} className="right">Sub-Total</th></tr></thead>
          <tbody>
            {r.services.map((s, i) => (
              <tr key={i} className={(i === sel ? 'sel ' : '') + (s.selected ? 'on' : '')} onClick={() => setSel(i)}>
                <td className="center"><input type="checkbox" checked={s.selected} onChange={(e) => mutate(() => { s.selected = e.target.checked })} /></td>
                <td><input className="cell" value={s.name} onChange={(e) => mutate(() => { s.name = e.target.value })} /></td>
                <td><input className="cell right" defaultValue={money(s.priceCents)} key={'p' + s.priceCents} onBlur={(e) => mutate(() => { s.priceCents = toCents(e.target.value) })} /></td>
                <td><input className="cell right" type="number" min={0} value={s.qty} onChange={(e) => mutate(() => { s.qty = Math.max(0, +e.target.value) })} /></td>
                <td className="right">{s.selected ? money(s.priceCents * s.qty) : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="inv-bottom">
        <div className="pay">
          <PickList k="payMethods" label="Payment method" value={inv.method} onChange={(v) => mutate(() => { inv.method = v })} />
          <PickList k="payStatus" label="Payment status" value={inv.status} onChange={(v) => mutate(() => { inv.status = v })} />
          <PickList k="payNotes" label="Payment note" value={inv.note} onChange={(v) => mutate(() => { inv.note = v })} />
        </div>
        <div className="totals">
          <div>Subtotal <b>${money(sub)}</b></div>
          <label>Tax $<input className="cell right" defaultValue={money(inv.taxCents)} key={'t' + inv.taxCents} onBlur={(e) => mutate(() => { inv.taxCents = toCents(e.target.value) })} style={{ width: 90 }} /></label>
          <div className="total">Total <b>${money(sub + inv.taxCents)}</b></div>
        </div>
      </div>
    </div>
  )
}
