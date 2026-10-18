// HomeGauge importer: .ht5 templates and .hr5 reports -> Bridge Report format.
const { DOMParser } = require('@xmldom/xmldom')
const crypto = require('crypto')

const uid = () => crypto.randomUUID()

// ---------- xml helpers ----------
const kids = (el, tag) => {
  const out = []
  if (!el) return out
  for (let n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 1 && (!tag || n.nodeName === tag)) out.push(n)
  return out
}
const kid = (el, tag) => kids(el, tag)[0] || null
const text = (el) => (el ? el.textContent || '' : '')
const t = (el, tag, d = '') => { const k = kid(el, tag); return k ? text(k) : d }
const texts = (el, tag) => kids(el, tag).map(text)
const bits = (s) => (s ? s.split(',').map((x) => x.trim() === '1') : [])
const descendants = (el, tag) => Array.from(el.getElementsByTagName(tag))

// HomeGauge stores rich text as escaped HTML, sometimes escaped twice.
function unescapeHtml(s) {
  if (!s) return ''
  let prev = null
  let n = 0
  while (prev !== s && /&(lt|gt|amp|quot|#\d+);/.test(s) && /&lt;|&amp;/.test(s) && n++ < 3) {
    prev = s
    s = s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d)).replace(/&amp;/g, '&')
  }
  return s
}
const ENT = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", rdquo: '\u201d', ldquo: '\u201c', rsquo: '\u2019', lsquo: '\u2018', mdash: '\u2014', ndash: '\u2013', hellip: '\u2026', deg: '\u00b0', frac12: '\u00bd', reg: '\u00ae', copy: '\u00a9', trade: '\u2122' }
const decodeEntities = (s) => s.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+\d*);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e.toLowerCase()] ?? m)
const htmlToText = (s) => decodeEntities(unescapeHtml(s || '').replace(/<br\s*\/?>|<\/p>|<\/li>/gi, '\n').replace(/<[^>]+>/g, '')).replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
const SMART_RE = /\*([A-Z]+)\(([^)]*)\)\*/g

function columns(parent, tag) {
  return kids(parent, tag).map((c) => ({
    short: t(c, 'colsName'), label: t(c, 'collName'),
    sendsToSummary: t(c, 'colsendToSum') === '1', removesFromSummary: t(c, 'colundoSum') === '1',
    isExclude: t(c, 'colex') === '1', visible: t(c, 'colshow', '1') === '1', color: t(c, 'colcolor') || null,
  }))
}

// ---------- template ----------
function parseTemplateEl(tp, name) {
  const smartFields = {}
  for (const st of kids(tp, 'st')) smartFields[t(st, 'stKey')] = texts(st, 'stVal').map((v) => htmlToText(v)).filter(Boolean)

  const comments = {}
  for (const c of kids(tp, 'com')) {
    const raw = t(c, 'comText')
    const plain = htmlToText(raw)
    comments[c.getAttribute('id')] = {
      id: c.getAttribute('id'), name: t(c, 'comName'), html: unescapeHtml(raw), text: plain,
      smart: [...plain.matchAll(SMART_RE)].length > 0,
      auto: t(c, 'comAuto') === '1',
      defaultPhotos: kids(c, 'comDefPic').map((p) => ({ path: t(p, 'atFN'), caption: t(p, 'atDesc') })),
    }
  }
  const catTree = (el) => ({ name: t(el, 'catName'), commentIds: texts(el, 'catCID'), children: kids(el, 'cat').map(catTree) })

  const items = {}
  for (const ii of kids(tp, 'ii')) {
    items[ii.getAttribute('id')] = {
      id: ii.getAttribute('id'), title: t(ii, 'iiText'), helpHtml: unescapeHtml(t(ii, 'iiHelp')),
      commentIds: texts(ii, 'iiCID').filter((id) => comments[id]),
    }
  }
  const materials = {}
  for (const sm of kids(tp, 'sm')) {
    materials[sm.getAttribute('id')] = {
      id: sm.getAttribute('id'), name: htmlToText(t(sm, 'smName')),
      options: kids(sm, 'smOpt').map((o) => htmlToText(t(o, 'smVal'))),
      extraInfoLabel: t(sm, 'smInfoName') || null,
    }
  }
  const sections = []
  for (const g of kids(tp, 'secC')) {
    for (const s of kids(g, 'sec')) {
      sections.push({
        group: g.getAttribute('name'), name: s.getAttribute('name'),
        excludedByDefault: t(s, 'secEx') === '1',
        repeatNames: texts(s, 'secReName'),
        introCommentIds: texts(s, 'secIntroID'), footerCommentIds: texts(s, 'secFooterID'),
        itemIds: texts(s, 'secIIID').filter((id) => items[id]),
        materialIds: texts(s, 'iiSMID').filter((id) => materials[id]),
        ratingColumns: columns(s, 'colHeadOR').length ? columns(s, 'colHeadOR') : null,
        _el: s,
      })
    }
  }
  const gen = descendants(tp, 'genInfo')[0]
  return {
    format: 'bridge-template/v1',
    name: name || 'Imported template',
    source: 'HomeGauge',
    meta: { createdBy: t(tp, 'tCreatedBy'), lastModifiedBy: t(tp, 'tLastModBy'), lastModified: t(tp, 'tLastMod') },
    ratingColumns: columns(tp, 'colHead'),
    costRanges: texts(tp, 'tEst'),
    smartFields, comments,
    commentLibrary: kids(tp, 'cat').map(catTree),
    items, materials,
    generalInfo: { commentIds: gen ? texts(gen, 'genCID') : [], materialIds: gen ? texts(gen, 'genSMID').filter((id) => materials[id]) : [] },
    sections,
  }
}

function stripEls(T) {
  return { ...T, sections: T.sections.map(({ _el, ...s }) => s) }
}

function parseTemplateXml(xml, name) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml')
  return stripEls(parseTemplateEl(doc.documentElement, name))
}

// ---------- new report from template ----------
const joinHtml = (T, ids) => ids.map((id) => T.comments[id]?.html).filter(Boolean).join('\n')

function newInstance(T, sec, name) {
  return {
    id: uid(), name: name || sec.name,
    introHtml: joinHtml(T, sec.introCommentIds), footerHtml: joinHtml(T, sec.footerCommentIds),
    items: sec.itemIds.map((itemId) => ({ itemId, ratings: [], excluded: false, entries: [] })),
    materials: sec.materialIds.map((materialId) => ({ materialId, selected: [], extraInfo: '' })),
  }
}

function newReport(T, info) {
  const { sections, ...lib } = T
  const now = new Date().toISOString()
  return {
    format: 'bridge-report/v1', id: uid(), created: now, updated: now,
    reportNumber: info.reportNumber || '',
    inspection: { date: info.date || now.slice(0, 10), start: '', end: '', address: info.address || '', city: info.city || '',
      state: info.state || 'NV', zip: info.zip || '', inspector: info.inspector || '', company: info.company || '', license: info.license || '', notes: '' },
    clients: [{ first: info.clientFirst || '', last: info.clientLast || '', email: info.clientEmail || '', phone: info.clientPhone || '' }],
    people: [], services: [],
    generalInfo: { html: joinHtml(T, T.generalInfo.commentIds.filter((id) => T.comments[id]?.auto)), // only HomeGauge's auto-insert comments; the rest are picked with ✨ Comments
      materials: T.generalInfo.materialIds.map((materialId) => ({ materialId, selected: [], extraInfo: '' })) },
    template: lib,
    sections: sections.map((s) => ({
      id: uid(), group: s.group, name: s.name, excluded: s.excludedByDefault, repeatNames: s.repeatNames,
      ratingColumns: s.ratingColumns, itemIds: s.itemIds, materialIds: s.materialIds,
      introCommentIds: s.introCommentIds, footerCommentIds: s.footerCommentIds,
      instances: [newInstance(T, s)],
    })),
    photoFolder: '',
  }
}

// ---------- import an existing HomeGauge report ----------
function parseReportXml(xml) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml')
  const r = doc.documentElement
  const tp = kid(r, 'template')
  const T = parseTemplateEl(tp, (t(r, 'TemplateFileName') || 'From report').split(/[\\/]/).pop().replace(/\.ht5$/i, ''))
  const props = (el) => Object.fromEntries(kids(el, 'prop').map((p) => [p.getAttribute('name'), text(p)]))
  const ri = kid(r, 'ReportInfo')
  const info = props(ri)
  const clients = kids(r, 'ClientData').map(props).filter((c) => Object.keys(c).length > 1)
  const people = kids(ri, 'Person').map((p) => ({
    first: t(p, 'PFName'), last: t(p, 'PLName'), company: t(p, 'PCompany'), email: t(p, 'PEmail'),
    phone: t(p, 'PMobilePhone'), workPhone: t(p, 'PWorkPhone'), role: t(p, 'PRole'), id: t(p, 'PGuid'),
  }))
  const services = kids(ri, 'Service').map((s) => ({
    name: htmlToText(t(s, 'SName')), selected: t(s, 'SOn') === '1', priceCents: +t(s, 'SPrice', '0') || 0, qty: +t(s, 'SNum', '1') || 1,
  }))

  const report = newReport(T, {})
  report.id = t(r, 'ReportGUID') || report.id
  report.reportNumber = info.RIReportNumber || ''
  report.inspection = {
    date: (info.RIDate || '').replace(/\//g, '-').replace(/-(\d)(?=-|$)/g, '-0$1'),
    start: info.RIStartTime || '', end: info.RIStopTime || '', address: info.RIAddress1 || '', city: info.RICity || '',
    state: info.RIState || '', zip: info.RIZip || '', inspector: info.RIInspector || '', company: info.RIInspectorCo || '',
    license: info.RIinspectorLicense || '', notes: info.RISpecialNotes || '',
    address2: info.RIAddress2 || '', county: info.RICounty || '', country: info.RICountry || 'US', mls: info.RIMLS || '',
  }
  report.clients = clients.map((c) => ({
    first: c.CFName1 || '', last: c.CLName1 || '', email: c.CEmail || '', phone: c.CMobilePhone || '',
    workPhone: c.CWorkPhone || '', homePhone: c.CHomePhone || '', company: c.CCompany || '',
    address: c.CAddress || '', city: c.CCity || '', state: c.CState || '', zip: c.CZip || '',
  }))
  if (!report.clients.length) report.clients = [{ first: '', last: '', email: '', phone: '' }]
  report.people = people
  report.services = services
  report.invoice = { taxCents: Math.round((+info.RITax || 0) * 100), method: info.RIPayMethod || '', status: info.RIPayStatus || '', note: info.RIPayNote || '' }

  // general info answers
  const ga = descendants(tp, 'GA')[0]
  if (ga) {
    const picks = kids(ga, 'GASM').map((x) => t(x, 'GASMT'))
    report.generalInfo.materials.forEach((m, i) => { if (picks[i]) m.selected = picks[i].split(/,\s*/).filter(Boolean) })
    report.generalInfo.html = unescapeHtml(t(ga, 'GAI'))
  }

  // section answers (positional, like HomeGauge)
  T.sections.forEach((sdef, si) => {
    const sec = report.sections[si]
    const sa = kid(sdef._el, 'SecA')
    if (!sa) return
    sec.excluded = t(sa, 'SecAEx') === '1'
    const cols = sdef.ratingColumns || T.ratingColumns
    const allItemIds = texts(sdef._el, 'secIIID')
    const allMatIds = texts(sdef._el, 'iiSMID')
    sec.instances = kids(sa, 'SecARepeat').map((rep) => {
      const inst = newInstance(T, sdef, t(rep, 'SecAName'))
      inst.introHtml = unescapeHtml(t(rep, 'SecAIntro'))
      inst.footerHtml = unescapeHtml(t(rep, 'SecAF'))
      inst.items = []
      kids(rep, 'SecAI').forEach((ai, idx) => {
        const itemId = allItemIds[idx]
        if (!T.items[itemId]) return
        const flags = bits(t(ai, 'SecAIXs'))
        inst.items.push({
          itemId,
          ratings: flags.map((on, i) => (on && cols[i] ? cols[i].short : null)).filter(Boolean),
          excluded: t(ai, 'SecAIREx') === '1',
          entries: kids(ai, 'SecAII').map((e) => ({
            id: uid(), html: unescapeHtml(t(e, 'SecAITxt')),
            summary: kids(e, 'SecAISum').length > 0,
            // HomeGauge photo placeholders (labeled empty slots) are stored as "placeholder.jpg"
            photos: kids(e, 'SecAIPic').map((p) => /^placeholder\.(jpe?g|png)$/i.test(text(p).trim())
              ? { file: '', caption: (p.getAttribute('label') || '').trim(), placeholder: true }
              : { file: text(p), caption: (p.getAttribute('label') || '').trim() }),
          })).filter((e) => htmlToText(e.html) || e.photos.length),
        })
      })
      inst.materials = []
      kids(rep, 'SMA').forEach((ma, idx) => {
        const materialId = allMatIds[idx]
        const m = T.materials[materialId]
        if (!m) return
        const custom = t(ma, 'SMAVs').split(',').map((v) => v.trim())
        const selected = bits(t(ma, 'SMAXs')).map((on, i) => (on ? m.options[i] ?? custom[i] : null)).filter(Boolean)
        inst.materials.push({ materialId, selected, extraInfo: t(ma, 'SMAI') })
      })
      return inst
    })
    if (!sec.instances.length) sec.instances = [newInstance(T, sdef)]
  })
  return report
}

module.exports = { parseTemplateXml, parseReportXml, newReport, newInstance, htmlToText }
