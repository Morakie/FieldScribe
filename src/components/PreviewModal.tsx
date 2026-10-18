import { useEffect, useMemo, useState } from 'react'
import Modal from './Modal'
import { useEditor } from './Editor'
import { buildReportHtml, headerFooter, type Branding } from '../preview'
import { api } from '../util'

export default function PreviewModal({ onClose }: { onClose: () => void }) {
  const { r, dir } = useEditor()
  const [summaryOnly, setSummaryOnly] = useState(false)
  const [busy, setBusy] = useState(false)
  const [brand, setBrand] = useState<Branding | null>(null)
  useEffect(() => { api.branding().then(setBrand) }, [])
  const html = useMemo(() => (brand ? buildReportHtml(r, dir, brand, { summaryOnly }) : ''), [r, dir, summaryOnly, brand])
  async function pdf() {
    if (!brand) return
    setBusy(true)
    try { await api.printToPdf(buildReportHtml(r, dir, brand, { summaryOnly, forPdf: true }), (r.reportNumber || 'report') + (summaryOnly ? '-summary' : ''), headerFooter(r, brand),
      { reportId: r.id, files: summaryOnly ? [] : (r.attachments || []).filter((a) => a.include).map((a) => a.file) }) }
    finally { setBusy(false) }
  }
  return (
    <Modal title="Report preview" onClose={onClose} full
      footer={<>
        <label><input type="checkbox" checked={summaryOnly} onChange={(e) => setSummaryOnly(e.target.checked)} /> Summary only</label>
        <span className="grow" />
        <button onClick={onClose}>Close</button>
        <button className="primary" disabled={busy || !brand} onClick={pdf}>{busy ? 'Making PDF…' : 'Save as PDF'}</button>
      </>}>
      {html ? <iframe className="preview" srcDoc={html} title="preview" /> : <div className="muted">Loading…</div>}
    </Modal>
  )
}
