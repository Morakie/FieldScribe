// App-wide settings (company, inspector, price list, pick lists) and the contacts list.
// On first run both are seeded from the local HomeGauge install if one is found.
const path = require('path')
const fs = require('fs')
const fsp = fs.promises

const DEFAULTS = {
  company: { name: 'Bridge Home Inspections', phone: '702-722-2222', email: '', website: '' },
  inspector: { name: '', company: 'Bridge Home Inspections', phone: '702-722-2222', license: '', email: '' },
  services: [],            // [{ name, priceCents }]
  lists: { payMethods: [], payStatus: [], payNotes: [], leadSources: ['Online Appointment Request', 'Agent Referral', 'Repeat Client', 'Google', 'Yelp', 'Facebook', 'Word of Mouth'] },
  photos: { workingEdge: 2400, uploadEdge: 640 },
}

function hgDir() {
  const local = process.env.LOCALAPPDATA || path.join(require('os').homedir(), 'AppData', 'Local')
  const d = path.join(local, 'HomeGauge')
  return fs.existsSync(d) ? d : null
}

/** Minimal CSV parser (quoted fields, "" escapes, newlines inside quotes). */
function parseCsv(text) {
  const rows = []; let row = []; let f = ''; let q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++ } else q = false } else f += c }
    else if (c === '"') q = true
    else if (c === ',') { row.push(f); f = '' }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = '' }
    else f += c
  }
  if (f || row.length) { row.push(f); rows.push(row) }
  return rows.filter((r) => r.length > 1 || r[0])
}
const lines = (p) => { try { return fs.readFileSync(p, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean) } catch { return [] } }

function seedFromHomeGauge(s) {
  const hg = hgDir()
  if (!hg) return s
  try {
    const rows = parseCsv(fs.readFileSync(path.join(hg, 'invoice.csv'), 'utf8'))
    const head = rows.shift()
    const ni = head.indexOf('name'), pi = head.indexOf('price')
    if (!s.services.length) s.services = rows.map((r) => ({ name: r[ni], priceCents: Number(r[pi]) || 0 })).filter((x) => x.name)
  } catch {}
  if (!s.lists.payMethods.length) s.lists.payMethods = lines(path.join(hg, 'paymethods.txt'))
  if (!s.lists.payStatus.length) s.lists.payStatus = lines(path.join(hg, 'paystatus.txt'))
  if (!s.lists.payNotes.length) s.lists.payNotes = lines(path.join(hg, 'paynote.txt'))
  try {
    const x = fs.readFileSync(path.join(hg, 'Settings.xml'), 'utf8')
    const get = (tag) => (x.match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([^<\\]]*)`)) || [])[1] || ''
    s.inspector.name ||= get('InspectorName'); s.inspector.license ||= get('InspectorLicense')
    s.inspector.company = get('InspectorCompany') || s.inspector.company; s.inspector.phone = get('InspectorContact') || s.inspector.phone
  } catch {}
  return s
}

function contactsFromCsv(text) {
  const rows = parseCsv(text)
  const head = rows.shift().map((h) => h.toLowerCase())
  const col = (r, n) => r[head.indexOf(n)] || ''
  return rows.map((r) => ({
    id: col(r, 'guid') || require('crypto').randomUUID(),
    type: col(r, 'type') === 'Rep' ? 'Rep' : 'Customer',
    first: col(r, 'first name'), last: col(r, 'last name'), company: col(r, 'company'),
    address: col(r, 'address'), address2: col(r, 'address2'), city: col(r, 'city'), state: col(r, 'state'), zip: col(r, 'zip'),
    email: col(r, 'email'), phone: col(r, 'mobile'), workPhone: col(r, 'workphone'), homePhone: col(r, 'homephone'), note: col(r, 'note'),
  })).filter((c) => c.first || c.last || c.company)
}

module.exports = makeSettings
module.exports.parseCsv = parseCsv
function makeSettings(root) {
  const file = path.join(root, 'settings.json')
  const cfile = path.join(root, 'contacts.json')
  let cache = null, ccache = null

  async function get() {
    if (cache) return cache
    let s
    try { s = JSON.parse(await fsp.readFile(file, 'utf8')) } catch {
      s = JSON.parse(JSON.stringify(DEFAULTS))
      try { s.company = { ...s.company, ...JSON.parse(await fsp.readFile(path.join(root, 'Branding', 'settings.json'), 'utf8')).company } } catch {}
      s = seedFromHomeGauge(s)
      await fsp.writeFile(file, JSON.stringify(s, null, 1))
    }
    s = { ...DEFAULTS, ...s, lists: { ...DEFAULTS.lists, ...s.lists }, photos: { ...DEFAULTS.photos, ...s.photos }, inspector: { ...DEFAULTS.inspector, ...s.inspector } }
    return (cache = s)
  }
  async function save(s) { cache = s; await fsp.writeFile(file + '.tmp', JSON.stringify(s, null, 1)); await fsp.rename(file + '.tmp', file); return s }

  async function contacts() {
    if (ccache) return ccache
    try { ccache = JSON.parse(await fsp.readFile(cfile, 'utf8')) } catch {
      ccache = []
      const hg = hgDir()
      if (hg) try { ccache = contactsFromCsv(await fsp.readFile(path.join(hg, 'people4.csv'), 'utf8')) } catch {}
      await fsp.writeFile(cfile, JSON.stringify(ccache))
    }
    return ccache
  }
  async function saveContact(c) {
    const list = await contacts()
    const i = list.findIndex((x) => x.id === c.id)
    if (i >= 0) list[i] = c; else list.push({ ...c, id: c.id || require('crypto').randomUUID() })
    await fsp.writeFile(cfile, JSON.stringify(list))
    return list
  }
  async function importContactsCsv(p) {
    const incoming = contactsFromCsv(await fsp.readFile(p, 'utf8'))
    const list = await contacts()
    const ids = new Set(list.map((c) => c.id))
    let added = 0
    for (const c of incoming) if (!ids.has(c.id)) { list.push(c); added++ }
    await fsp.writeFile(cfile, JSON.stringify(list))
    return added
  }
  return { get, save, contacts, saveContact, importContactsCsv, hgDir, seedFrom: seedFromHomeGauge }
}
