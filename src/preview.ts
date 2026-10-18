import type { Report } from './types'
import { escapeHtml as esc, imgUrl, joinPath } from './util'

export interface Branding {
  company: { name: string; phone: string; email: string; website: string }
  logo: string | null
  fontsDir: string
}

export interface BuildOpts {
  summaryOnly?: boolean
  /** true when building for the PDF printer: TOC gets {{PG:x}} tokens and invisible page markers */
  forPdf?: boolean
}

/* Small inline icons (no external icon font needed). */
const I = {
  home: '<svg viewBox="0 0 24 24"><path d="M12 3 2 12h3v8h5v-6h4v6h5v-8h3z"/></svg>',
  desc: '<svg viewBox="0 0 24 24"><path d="M4 4h16v16H4zM7 8h10v1.6H7zm0 3.2h10v1.6H7zm0 3.2h7v1.6H7z" fill-rule="evenodd"/></svg>',
  tools: '<svg viewBox="0 0 24 24"><path d="M22 19.6 13.4 11a5.6 5.6 0 0 0-7-7.3l3.3 3.3-2.5 2.5-3.3-3.3A5.6 5.6 0 0 0 11.2 13l8.6 8.6zM2.5 19.6l6-6 2 2-6 6z"/></svg>',
  eye: '<svg viewBox="0 0 24 24"><path d="M12 5C6 5 2 12 2 12s4 7 10 7 10-7 10-7-4-7-10-7zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm0-2a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="9"/><path d="m7.5 12.5 3 3 6-6.5"/></svg>',
  clip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="4" width="14" height="17" rx="1.5"/><path d="M9 4V2.5h6V4"/></svg>',
  cam: '<svg viewBox="0 0 24 24"><path d="M4 7h3.5L9 5h6l1.5 2H20a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1zm8 11a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zm0-2a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z" fill-rule="evenodd"/></svg>',
  grid: '<svg viewBox="0 0 24 24"><path d="M3 3h5v5H3zm6.5 0h5v5h-5zM16 3h5v5h-5zM3 9.5h5v5H3zm6.5 0h5v5h-5zm6.5 0h5v5h-5zM3 16h5v5H3zm6.5 0h5v5h-5zm6.5 0h5v5h-5z"/></svg>',
  sum: '<svg viewBox="0 0 24 24"><rect width="24" height="24" rx="2" fill="#18a33a"/><path d="M12 4 5 11h4v8h6v-8h4z" fill="#fff"/></svg>',
}
const icon = (k: keyof typeof I, cls = '') => `<span class="ic ${cls}">${I[k]}</span>`

export function buildReportHtml(r: Report, dir: string, brand: Branding, opts: BuildOpts = {}): string {
  const T = r.template
  const ins = r.inspection
  const co = brand.company
  const client = r.clients.map((c) => `${c.first} ${c.last}`.trim()).filter(Boolean).join(' & ')
  const agents = r.people.filter((p) => /agent|real|rep/i.test(p.role || '') || !p.role).map((p) => `${p.first} ${p.last}`.trim()).filter(Boolean)
  // downsampled on the fly so full-resolution working photos don't bloat the PDF
  const pic = (f: string, m = 1100) => imgUrl(joinPath(dir, f)) + `&m=${m}`
  const sections = r.sections.filter((s) => !s.excluded)
  const allEntries = sections.flatMap((s) => s.instances.flatMap((i) => i.items.filter((it) => !it.excluded).flatMap((it) => it.entries)))
  const coverFile = (r as any).coverPhoto || allEntries.flatMap((e) => e.photos).find((p) => !p.placeholder && p.file)?.file
  const fmtDate = (d: string) => (d ? new Date(d + 'T12:00').toLocaleDateString('en-US') : '')
  const cols = T.ratingColumns
  const pg = (id: string) => (opts.forPdf ? `{{PG:${id}}}` : '')
  const mark = (id: string) => (opts.forPdf ? `<span class="mk">QQ${id}QQ</span>` : '')
  const fontUrl = (f: string) => imgUrl(joinPath(brand.fontsDir, f))

  const photos = (all: { file: string; caption: string; size?: string; placeholder?: boolean }[], ps = all.filter((p) => !p.placeholder && p.file)) => ps.length
    ? `<div class="pics">${ps.map((p) => `<figure class="sz-${p.size || 'm'}"><a href="${pic(p.file)}" target="_blank"><img src="${pic(p.file)}"/></a><figcaption>${esc(p.caption || '')}</figcaption></figure>`).join('')}</div>` : ''

  // ---------- counts ----------
  const itemsInspected = sections.reduce((n, s) => n + s.instances.reduce((m, i) => m + i.items.filter((it) => !it.excluded && it.ratings.length && !it.ratings.every((x) => cols.find((c) => c.short === x)?.isExclude)).length, 0), 0)
  const summaryCount = allEntries.filter((e) => e.summary).length
  const photoCount = allEntries.reduce((n, e) => n + e.photos.filter((p) => !p.placeholder && p.file).length, 0)

  // ---------- sections ----------
  const toc: { id: string; label: string }[] = []
  let body = ''
  sections.forEach((s, si) => {
    const n = si + 1
    s.instances.forEach((inst, ii) => {
      const cs = s.ratingColumns || cols
      const id = `s${n}${ii ? '-' + ii : ''}`
      const title = s.instances.length > 1 && inst.name !== s.name ? `${s.name} — ${inst.name}` : inst.name
      toc.push({ id, label: `${n}${s.instances.length > 1 ? String.fromCharCode(97 + ii) : ''} ${title}` })
      body += `<section class="sec" id="${id}">${mark(id)}<h1 class="sh">${icon('home')}${n}. ${esc(title)}</h1>`
      if (inst.introHtml) body += `<h3 class="sub">${icon('desc')}Description</h3><div class="intro">${inst.introHtml}</div>`
      const mats = inst.materials.filter((m) => !m.excluded && (m.selected.length || m.extraInfo))
      if (mats.length) {
        body += `<h3 class="sub">${icon('tools')}Styles &amp; Materials: ${esc(inst.name)}</h3><div class="smbox">${mats.map((m) =>
          `<div class="smi"><b>${esc(T.materials[m.materialId]?.name || '')}:</b><span>${esc(m.selected.join(', '))}${m.extraInfo ? ` <em>(${esc(m.extraInfo)})</em>` : ''}</span></div>`).join('')}</div>`
      }
      body += `<h3 class="sub rule">${icon('eye')}Items: ${esc(inst.name)}</h3>`
      inst.items.forEach((it, k) => {
        if (it.excluded) return
        const labels = it.ratings.map((rt) => cs.find((x) => x.short === rt)).filter((c) => c && !c.isExclude)
        body += `<div class="item"><h4>${n}.${k} ${esc(T.items[it.itemId]?.title || '')}</h4>`
        if (labels.length) body += `<div class="rating">${labels.map((c) => `<span class="${c!.sendsToSummary ? 'rr' : ''}">${icon('check')}${esc(c!.label.toUpperCase())}</span>`).join('')}</div>`
        const multi = it.entries.length > 1
        it.entries.forEach((e, ei) => {
          body += `<div class="entry">${multi || e.summary ? `<div class="enum">${e.summary ? icon('sum', 'sumic') : ''}${multi ? `(${ei + 1})` : ''}</div>` : ''}<div class="text">${e.html}</div>${photos(e.photos)}</div>`
        })
        body += `</div>`
      })
      if (inst.footerHtml) body += `<div class="footer-text">${inst.footerHtml}</div>`
      body += `</section>`
    })
  })

  // ---------- summary ----------
  let summary = ''
  sections.forEach((s, si) => s.instances.forEach((inst) => inst.items.forEach((it, k) => {
    if (it.excluded) return
    for (const e of it.entries.filter((x) => x.summary)) {
      summary += `<div class="item"><h4>${si + 1}.${k} ${esc(inst.name)} — ${esc(T.items[it.itemId]?.title || '')}</h4><div class="entry"><div class="text">${e.html}</div>${photos(e.photos)}</div></div>`
    }
  })))

  // ---------- invoice ----------
  const svc = r.services.filter((s) => s.selected)
  const inv = r.invoice || { taxCents: 0, method: '', status: '', note: '' }
  const total = svc.reduce((n, s) => n + (s.priceCents * s.qty) / 100, 0) + inv.taxCents / 100
  const invoice = svc.length ? `<section class="sec invoice" id="invoice">${mark('invoice')}
    <div class="inv-head">${brand.logo ? `<img class="inv-logo" src="${imgUrl(brand.logo)}"/>` : `<div class="co-name">${esc(co.name)}</div>`}<h2>INVOICE</h2></div>
    <div class="inv-meta"><div><b>${esc(co.name)}</b><br/><b>${esc(co.phone)}</b><br/><b>Inspected By: ${esc(ins.inspector)}</b></div>
      <div class="right"><b>Inspection Date:</b> ${esc(fmtDate(ins.date))}<br/><b>Report ID:</b> ${esc(r.reportNumber)}</div></div>
    <table class="box2"><tr><th>Customer Info:</th><th>Inspection Property:</th></tr>
      <tr><td>${esc(client)}<br/><br/>${agents.length ? `<b>Customer's Real Estate Professional:</b><br/>${esc(agents.join(', '))}` : ''}</td>
      <td>${esc(ins.address)}<br/>${esc(`${ins.city} ${ins.state} ${ins.zip}`)}</td></tr></table>
    <table class="inv"><tr><th>Service</th><th class="r">Price</th><th class="r">Amount</th><th class="r">Sub-Total</th></tr>
      ${svc.map((s) => `<tr><td>${esc(s.name)}</td><td class="r">${(s.priceCents / 100).toFixed(2)}</td><td class="r">${s.qty}</td><td class="r">${((s.priceCents * s.qty) / 100).toFixed(2)}</td></tr>`).join('')}
    </table><div class="inv-total"><b>Tax</b> $${(inv.taxCents / 100).toFixed(2)}<br/><b>Total Price</b> $${total.toFixed(2)}</div>
    <div class="inv-pay"><b>Payment Method:</b> ${esc(inv.method)}<br/><b>Payment Status:</b> ${esc(inv.status)}<br/><b>Note:</b> ${esc(inv.note)}</div></section>` : ''
  if (invoice) toc.push({ id: 'invoice', label: 'Invoice' })
  const att = (r.attachments || []).filter((a) => a.include)
  const attachPage = att.length ? `<section class="sec" id="attachments">${mark('attachments')}<h1 class="sh">${icon('clip')}Attachments</h1>
    <p>The following documents are attached to the end of this report:</p><ol class="att">${att.map((a) => `<li>${esc(a.name)}</li>`).join('')}</ol></section>` : ''
  if (att.length) toc.push({ id: 'attachments', label: 'Attachments' })

  // ---------- general info ----------
  const general = r.generalInfo.materials.filter((m) => !m.excluded && m.selected.length)
    .map((m) => `<div class="gi"><b>${esc(T.materials[m.materialId]?.name || '')}:</b><span>${esc(m.selected.join(', '))}</span></div>`).join('')

  const tocHtml = [{ id: 'cover', label: 'Cover Page' }, { id: 'toc', label: 'Table of Contents' }, { id: 'intro', label: 'Intro Page' }, ...toc, ...(summary ? [{ id: 'summary', label: 'Summary' }] : [])]
    .map((t) => `<a class="toc-row" href="#${t.id}"><span>${esc(t.label)}</span><i></i><span class="pn">${pg(t.id)}</span></a>`).join('')

  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(r.reportNumber || ins.address)}</title><style>
@font-face{font-family:'DM Sans';src:url('${fontUrl('DMSans-Regular.ttf')}');font-weight:400}
@font-face{font-family:'DM Sans';src:url('${fontUrl('DMSans-Medium.ttf')}');font-weight:500}
@font-face{font-family:'DM Sans';src:url('${fontUrl('DMSans-Bold.ttf')}');font-weight:700}
@font-face{font-family:'DM Sans';src:url('${fontUrl('DMSans-Italic.ttf')}');font-style:italic}
@font-face{font-family:'Roboto Condensed';src:url('${fontUrl('RobotoCondensed-Regular.ttf')}');font-weight:400}
@font-face{font-family:'Roboto Condensed';src:url('${fontUrl('RobotoCondensed-Light.ttf')}');font-weight:300}
${CSS}</style></head><body class="${opts.forPdf ? 'pdf' : 'screen'}">
${opts.summaryOnly ? '' : `
<section class="cover" id="cover">${mark('cover')}
  ${brand.logo ? `<img class="logo" src="${imgUrl(brand.logo)}"/>` : `<div class="co-name big">${esc(co.name)}</div>`}
  <div class="ttl">Inspection Report</div>
  <div class="client">${esc(client)}</div>
  <div class="paddr"><b>Property Address:</b><br/>${esc(ins.address)}<br/>${esc(`${ins.city} ${ins.state} ${ins.zip}`)}</div>
  ${coverFile ? `<img class="hero" src="${pic(coverFile, 1600)}"/>${r.coverLabel ? `<div class="cover-label">${esc(r.coverLabel)}</div>` : ''}` : ''}
  <div class="co">${esc(co.name)}</div>
  <div class="insp"><b>${esc(ins.inspector)}${ins.license ? ' ' + esc(ins.license) : ''}</b></div>
  <div class="insp"><b>${esc(co.phone)}</b></div>
</section>
<section class="page" id="toc">${mark('toc')}<h1 class="sh">${icon('grid')}Table of Contents</h1><div class="toc">${tocHtml}</div></section>
<section class="page" id="intro">${mark('intro')}
  <table class="infobox"><tr><td><b>Date:</b> ${esc(fmtDate(ins.date))}</td><td><b>Time:</b> ${esc(ins.start)}</td><td><b>Report ID:</b> ${esc(r.reportNumber)}</td></tr>
  <tr class="top"><td><b>Property:</b><br/>${esc(ins.address)}<br/>${esc(`${ins.city} ${ins.state} ${ins.zip}`)}</td><td><b>Customer:</b><br/>${esc(client)}</td><td><b>Real Estate Professional:</b><br/>${esc(agents.join(', '))}</td></tr></table>
  ${r.generalInfo.html ? `<div class="gtext">${r.generalInfo.html}</div>` : ''}
  ${general ? `<div class="gigrid">${general}</div>` : ''}
</section>
<section class="glance-wrap">
  <h1 class="sh">${icon('check')}Results at a Glance</h1>
  <div class="glance">
    <div><div class="num">${itemsInspected}</div><div class="lbl">${icon('check')}Items Inspected</div><div class="sm">Total number in report.</div></div>
    <div><div class="num">${summaryCount}</div><div class="lbl">${icon('clip')}Summary Comments</div><div class="sm">Total number in report.</div></div>
    <div><div class="num">${photoCount}</div><div class="lbl">${icon('cam')}Photos</div><div class="sm">Total number in report.</div></div>
  </div>
</section>
${body}${invoice}${attachPage}`}
${summary ? `<section class="sec" id="summary">${mark('summary')}<h1 class="sh">${icon('clip')}Summary</h1>${summary}</section>` : opts.summaryOnly ? '<p>No items were flagged for the summary.</p>' : ''}
</body></html>`
}

/** Running header/footer for the PDF printer (Chromium header/footer templates). */
export function headerFooter(r: Report, brand: Branding) {
  const last = r.clients[0]?.last || ''
  const st = 'font-family:Arial,sans-serif;font-size:8.5pt;font-weight:700;color:#333;width:100%;padding:0 0.3in;display:flex;justify-content:space-between;'
  return {
    header: `<div style="${st}"><span>${esc(brand.company.name)}</span><span>${esc(last)}</span></div>`,
    footer: `<div style="${st}"><span>${esc(r.inspection.address)}</span><span style="font-weight:400">Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`,
  }
}

const CSS = `
*{box-sizing:border-box}
body{font:400 10.5pt/1.5 'DM Sans',Arial,sans-serif;color:#2b2b2b;margin:0;background:#fff}
body.screen{max-width:8.5in;margin:0 auto;padding:30px 40px;box-shadow:0 0 0 1px #e5e5e5}
a{color:inherit;text-decoration:none}
.mk{display:block;height:1px;font-size:1px;line-height:1px;color:#fff;overflow:hidden}
.ic{display:inline-block;width:.95em;height:.95em;margin-right:.35em;vertical-align:-.1em;color:#777;fill:#777}
.ic svg{width:100%;height:100%;display:block}
.cover{text-align:center;padding-top:20px;page-break-after:always;position:relative}
.cover .logo{max-width:320px;max-height:210px}
.co-name{font:700 22pt 'Roboto Condensed',Arial;color:#2b2b2b}.co-name.big{font-size:30pt;margin:30px 0}
.cover .ttl{font:400 26pt 'Roboto Condensed',Arial;margin:22px 0 14px;color:#333}
.cover .client{font:400 21pt 'Roboto Condensed',Arial;color:#333;margin-bottom:10px}
.cover .paddr{font-size:11pt;line-height:1.6;margin-bottom:16px}
.cover .hero{width:520px;max-width:100%;height:390px;object-fit:cover;border:1px solid #ccc}
.cover .co{font:400 18pt 'Roboto Condensed',Arial;margin:22px 0 8px;color:#333}
.cover .insp{font-size:11pt;margin:6px 0}
.page{page-break-after:always}
h1.sh{font:300 21pt 'Roboto Condensed',Arial;text-transform:uppercase;color:#333;border-bottom:1.5px solid #ccc;padding-bottom:4px;margin:10px 0 14px;display:flex;align-items:center}
h1.sh .ic{width:.9em;height:.9em;margin-right:.3em}
.toc{padding:0 50px}
.toc-row{display:flex;align-items:baseline;font-size:11pt;color:#444;margin:14px 0}
.toc-row i{flex:1;border-bottom:1.5px dotted #888;margin:0 3px;transform:translateY(-3px)}
.toc-row .pn{min-width:14px;text-align:right}
table.infobox{width:100%;border-collapse:collapse;border:1px solid #333;font-size:10.5pt;margin-bottom:12px}
table.infobox td{padding:4px 6px;width:33%;vertical-align:top}
table.infobox tr.top td{border-top:1.5px solid #333}
.gtext{padding:0 16px;font-size:11pt}.gtext p{margin:0}
.gigrid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px 20px;border-top:1px solid #ddd;margin-top:20px;padding:16px 4px}
.gi b,.smi b{display:block;font-weight:700}
.glance-wrap{page-break-inside:avoid}
.glance{display:grid;grid-template-columns:repeat(3,206px);gap:18px;padding:6px 16px 18px}
.glance>div{border:1px solid #ddd;border-radius:6px;text-align:center;padding:16px 8px}
.glance .num{font:400 26pt 'Roboto Condensed',Arial;color:#333}
.glance .lbl{font:400 12pt 'Roboto Condensed',Arial;text-transform:uppercase;color:#333}
.glance .sm{font-size:9pt;color:#555}
.sec{page-break-before:always;position:relative}
.glance-wrap + .sec{page-break-before:auto}
h3.sub{font:400 14pt 'Roboto Condensed',Arial;text-transform:uppercase;color:#333;margin:14px 0 4px 12px;display:flex;align-items:center}
h3.sub.rule{border-bottom:1px solid #ddd;padding-bottom:6px;margin-left:0;padding-left:0}
.intro{font-size:10pt;line-height:1.25;padding:0 16px}.intro p{margin:0}
.smbox{display:grid;grid-template-columns:repeat(3,1fr);gap:12px 18px;border-top:1px solid #eee;border-radius:8px;margin:6px 16px 18px;padding:14px 14px 4px}
.item{margin:0 16px;padding:12px 0 10px;border-bottom:1px solid #ddd}
.item h4{font:400 13pt 'Roboto Condensed',Arial;margin:0 0 6px;text-transform:uppercase;color:#333}
.rating{margin:0 0 6px 28px;font:400 12pt 'Roboto Condensed',Arial;color:#333;display:flex;gap:18px}
.rating .rr{color:#b3261e}.rating .rr .ic{color:#b3261e}
.entry{margin:0 0 10px 28px}
.enum{display:flex;align-items:center;gap:4px;margin-left:-28px;padding-left:0}
.enum .sumic{width:18px;height:18px;margin-right:10px}
.entry .text p{margin:0}
.pics{display:flex;flex-wrap:wrap;gap:10px;margin-top:10px}
.pics figure{margin:0;width:220px;border:1px solid #ddd;padding:5px;page-break-inside:avoid;break-inside:avoid}
.pics img{width:208px;height:117px;object-fit:cover;display:block}
.pics figure.sz-s{width:162px}.pics figure.sz-s img{width:150px;height:84px}
.pics figure.sz-l{width:338px}.pics figure.sz-l img{width:326px;height:183px}
.pics figure.sz-xl{width:100%;max-width:520px}.pics figure.sz-xl img{width:100%;height:auto;aspect-ratio:16/9}
.pics figcaption{font-size:10pt;padding:8px 2px 4px;min-height:1.5em}
.cover-label{font-size:10pt;color:#555;margin-top:4px}
.inv-pay{margin-top:18px;line-height:1.7}
ol.att{font-size:11pt;line-height:1.8}
.footer-text{font-style:italic;font-size:10.5pt;line-height:1.2;padding:14px 16px 0}.footer-text p{margin:0}
.invoice .inv-head{display:flex;justify-content:space-between;align-items:center}
.inv-logo{max-width:320px;max-height:200px}
.invoice h2{font-size:18pt;margin-right:90px;color:#333}
.inv-meta{display:flex;justify-content:space-between;margin:10px 0 18px;font-size:10.5pt}.right{text-align:right}
table.box2{width:100%;border-collapse:collapse;border:1px solid #333;font-size:10.5pt}
table.box2 th{text-align:left;border:1px solid #333;padding:4px 6px}table.box2 td{border:1px solid #333;padding:8px 6px;vertical-align:top;width:50%}
table.inv{width:100%;border-collapse:collapse;margin-top:16px;font-size:10.5pt;border-bottom:1px solid #ddd}
table.inv th{text-align:left;padding:3px 0}table.inv td{padding:3px 0 14px}.r{text-align:right!important}
.inv-total{text-align:right;margin-top:16px;line-height:1.6}
@media print{body.screen{box-shadow:none;padding:0}}
`
