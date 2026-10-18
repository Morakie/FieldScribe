const { app, BrowserWindow, ipcMain, dialog, protocol, net, nativeImage, shell, Menu } = require('electron')
const path = require('path')
const crypto = require('crypto')
const fs = require('fs')
const fsp = fs.promises
const { pathToFileURL } = require('url')
const JSZip = require('jszip')
const importer = require('./importer')
const makeSettings = require('./settings')
let _settings = null
const settings = () => (_settings ||= makeSettings(dataDir()))

const IMG_EXT = /\.(jpe?g|png|gif|bmp|webp)$/i
const isDev = process.argv.includes('--dev')

// Chromium's cache goes in Local AppData (not Roaming/OneDrive), and the GPU shader cache is off.
// Together with the single-instance lock this stops the "Unable to move the cache: Access is denied" errors,
// which happen when a second copy of the app starts while the first still holds the cache folder.
try { app.setPath('sessionData', path.join(process.env.LOCALAPPDATA || app.getPath('appData'), 'BridgeReport', 'Session')) } catch {}
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache')
let mainWin = null
const gotLock = process.env.BRIDGE_DATA_DIR ? true : app.requestSingleInstanceLock()
if (!gotLock) app.quit()
else app.on('second-instance', () => { if (mainWin) { if (mainWin.isMinimized()) mainWin.restore(); mainWin.focus() } })

protocol.registerSchemesAsPrivileged([
  { scheme: 'brimg', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
  { scheme: 'brthumb', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
])

// ---------- data folders ----------
const dataDir = () => process.env.BRIDGE_DATA_DIR || path.join(app.getPath('documents'), 'BridgeReport Data')
const dirs = () => ({
  root: dataDir(),
  templates: path.join(dataDir(), 'Templates'),
  reports: path.join(dataDir(), 'Reports'),
  library: path.join(dataDir(), 'Library'),
  thumbs: path.join(dataDir(), '.thumbs'),
  branding: path.join(dataDir(), 'Branding'),
})
const fontsDir = () => path.join(__dirname, '..', 'report-assets', 'fonts')
async function getBranding() {
  const company = (await settings().get()).company
  const files = await fsp.readdir(dirs().branding).catch(() => [])
  const logo = files.find((f) => /^logo\.(png|jpe?g|gif|webp)$/i.test(f))
  return { company, logo: logo ? path.join(dirs().branding, logo) : null, fontsDir: fontsDir() }
}
const reportDir = (id) => path.join(dirs().reports, id)
const fillsDir = () => path.join(dataDir(), 'Fills')
const fillDir = (name) => path.join(fillsDir(), safeName(String(name)))
/** Where a merge source keeps its files: a report folder, or a fill folder ("fill:<name>"). */
const sourceDir = (id) => (String(id).startsWith('fill:') ? fillDir(String(id).slice(5)) : reportDir(id))
function fillCounts(r) {
  let items = 0, comments = 0, photos = 0, materials = 0, placeholders = 0
  for (const s of r.sections || []) for (const inst of s.instances || []) {
    for (const it of inst.items || []) {
      if ((it.ratings || []).length || (it.entries || []).length) items++
      for (const e of it.entries || []) { if (String(e.html || '').replace(/<[^>]+>/g, '').trim()) comments++; photos += (e.photos || []).filter((p) => !p.placeholder).length; placeholders += (e.photos || []).filter((p) => p.placeholder).length }
    }
    for (const m of inst.materials || []) if ((m.selected || []).length) materials++
  }
  return { sections: (r.sections || []).length, items, comments, photos, materials, placeholders }
}
const safeName = (s) => s.replace(/[<>:"/\\|?*]+/g, '-').trim()
// template names may be stored as a HomeGauge path (C:\...\Larry Template 1.ht5) — use just the name
const tplName = (s) => safeName(String(s).split(/[\\/]/).pop().replace(/\.(ht5|json)$/i, ''))

async function ensureDirs() {
  for (const d of Object.values(dirs())) await fsp.mkdir(d, { recursive: true })
  const seed = path.join(__dirname, '..', 'seed')
  const existing = await fsp.readdir(dirs().templates)
  if (!existing.some((f) => f.endsWith('.json')) && fs.existsSync(seed)) {
    for (const f of await fsp.readdir(seed)) if (f.endsWith('.json')) await fsp.copyFile(path.join(seed, f), path.join(dirs().templates, f))
  }
}

const readJson = async (p) => JSON.parse(await fsp.readFile(p, 'utf8'))
async function writeJsonAtomic(p, data) {
  const tmp = p + '.tmp'
  await fsp.writeFile(tmp, JSON.stringify(data))
  await fsp.rename(tmp, p)
}

const INDEX_V = 2
const isPaid = (st) => /paid/i.test(st || '') && !/(un|not|part|due)/i.test(st || '')
function summaryRow(r) {
  const c = r.clients?.[0] || {}
  const reps = (r.people || []).filter((p) => /agent|rep/i.test(p.role || ''))
  const agent = reps[0] || r.people?.[0]
  const ins = r.inspection || {}
  return {
    v: INDEX_V,
    id: r.id, date: ins.date || '', client: [c.last, c.first].filter(Boolean).join(', '),
    address: ins.address || '', city: ins.city || '', zip: ins.zip || '',
    reportNumber: r.reportNumber || '', agent: agent ? `${agent.first || ''} ${agent.last || ''}`.trim() : '',
    template: String(r.template?.name || '').split(/[\\/]/).pop().replace(/\.ht5$/i, ''), inspector: ins.inspector || '', updated: r.updated || '',
    importedFrom: r.importedFrom || '',
    published: r.published ? 'Yes' : 'No',
    paid: isPaid(r.invoice?.status) ? 'Yes' : '',
    reinspection: r.reinspectionOf || /-R$/i.test(r.reportNumber || '') ? 'Yes' : 'No',
    coverPhoto: r.coverPhoto || '',
    details: {
      clientName: [c.first, c.last].filter(Boolean).join(' '), company: c.company || '',
      start: ins.start || '', end: ins.end || '',
      inspAddress: [ins.address, ins.address2].filter(Boolean).join(' ') + (ins.city ? `, ${ins.city}` : '') + (ins.state ? `, ${ins.state}` : '') + (ins.zip ? ` ${ins.zip}` : ''),
      billing: [c.address, c.city, c.state, c.zip].filter(Boolean).join(', '),
      workPhone: c.workPhone || '', homePhone: c.homePhone || '', mobile: c.phone || '', email: c.email || '', mls: ins.mls || '',
      reps: reps.map((p) => `${p.first || ''} ${p.last || ''}`.trim()).filter(Boolean),
      reinspectionOf: r.reinspectionOf || '',
    },
  }
}

// ---------- backups (HomeGauge keeps 10 copies; so do we) ----------
const BACKUP_KEEP = 10
const BACKUP_EVERY_MS = 5 * 60 * 1000
const backupDir = (id) => path.join(reportDir(id), 'backups')
const stamp = (d = new Date()) => d.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
async function makeBackup(id, force) {
  const main = path.join(reportDir(id), 'report.json')
  if (!fs.existsSync(main)) return
  const bd = backupDir(id)
  await fsp.mkdir(bd, { recursive: true })
  const files = (await fsp.readdir(bd)).filter((f) => /^report-.*\.json$/.test(f)).sort()
  const last = files[files.length - 1]
  if (!force && last && Date.now() - (await fsp.stat(path.join(bd, last))).mtimeMs < BACKUP_EVERY_MS) return
  const mt = (await fsp.stat(main)).mtime
  await fsp.copyFile(main, path.join(bd, `report-${stamp(mt)}.json`))
  const all = (await fsp.readdir(bd)).filter((f) => /^report-.*\.json$/.test(f)).sort()
  for (const f of all.slice(0, Math.max(0, all.length - BACKUP_KEEP))) await fsp.unlink(path.join(bd, f)).catch(() => {})
}

async function saveReport(report) {
  report.updated = new Date().toISOString()
  const dir = reportDir(report.id)
  await fsp.mkdir(dir, { recursive: true })
  await makeBackup(report.id, false)
  await writeJsonAtomic(path.join(dir, 'report.json'), report)
  await writeJsonAtomic(path.join(dir, 'index.json'), summaryRow(report))
  return report.updated
}

/** Rebuild index.json for one report from its report.json. */
async function reindex(id) {
  const r = await readJson(path.join(reportDir(id), 'report.json'))
  const row = summaryRow(r)
  await writeJsonAtomic(path.join(reportDir(id), 'index.json'), row)
  return row
}

/** Copy the photo files a report uses (and their high-res originals) from one report folder to another. */
async function copyPhotos(fromId, toId, files) {
  const from = reportDir(fromId), to = reportDir(toId)
  await fsp.mkdir(path.join(to, 'originals'), { recursive: true })
  for (const f of files) {
    if (!f) continue
    await fsp.copyFile(path.join(from, f), path.join(to, f)).catch(() => {})
    const o = path.join(from, 'originals', f)
    if (fs.existsSync(o)) await fsp.copyFile(o, path.join(to, 'originals', f)).catch(() => {})
  }
}

async function nextPhotoName(dir, ext) {
  const files = await fsp.readdir(dir).catch(() => [])
  let max = 0
  for (const f of files) { const m = /^i(\d+)\./.exec(f); if (m) max = Math.max(max, +m[1]) }
  return `i${max + 1}${ext}`
}

async function listImages(folder, recursive) {
  const out = []
  async function walk(d, depth) {
    let entries = []
    try { entries = await fsp.readdir(d, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) { if (recursive && depth < 4 && !e.name.startsWith('.')) await walk(p, depth + 1) }
      else if (IMG_EXT.test(e.name)) out.push({ path: p, name: e.name, folder: path.relative(folder, d) })
    }
  }
  await walk(folder, 0)
  out.sort((a, b) => a.folder.localeCompare(b.folder) || a.name.localeCompare(b.name, undefined, { numeric: true }))
  return out
}

// ---------- IPC ----------
function registerIpc(win) {
  const h = (name, fn) => ipcMain.handle(name, (_e, ...args) => fn(...args))

  h('dirs', () => dirs())
  h('listTemplates', async () => (await fsp.readdir(dirs().templates)).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)))
  h('loadTemplate', (name) => readJson(path.join(dirs().templates, tplName(name) + '.json')))
  h('saveTemplate', (name, T) => writeJsonAtomic(path.join(dirs().templates, tplName(name) + '.json'), T))

  h('listReports', async (force) => {
    const rows = []
    const ids = (await fsp.readdir(dirs().reports)).filter((id) => fs.existsSync(path.join(reportDir(id), 'report.json')))
    let n = 0
    for (const id of ids) {
      let row = null
      if (!force) { try { row = await readJson(path.join(reportDir(id), 'index.json')) } catch {} }
      if (!row || row.v !== INDEX_V) {
        if (++n % 10 === 1) win.webContents.send('progress', `Updating the report list… ${rows.length + 1} of ${ids.length}`)
        try { row = await reindex(id) } catch { row = null }
      }
      if (row) { row.dir = reportDir(id); rows.push(row) }
    }
    if (n) win.webContents.send('progress', '')
    return rows.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.updated || '').localeCompare(a.updated || ''))
  })
  h('loadReport', (id) => readJson(path.join(reportDir(id), 'report.json')))
  h('saveReport', saveReport)
  h('reportDir', (id) => reportDir(id))
  h('createReport', async (templateName, info) => {
    const T = await readJson(path.join(dirs().templates, safeName(templateName) + '.json'))
    const st = await settings().get()
    const r = importer.newReport(T, info)
    r.services = st.services.map((x) => ({ name: x.name, priceCents: x.priceCents, qty: 1, selected: false }))
    r.inspection.inspector ||= st.inspector.name
    r.inspection.license ||= st.inspector.license
    r.inspection.company ||= st.inspector.company
    if (!r.reportNumber) r.reportNumber = `${r.inspection.date.replace(/-/g, '')}-${(r.inspection.address || 'report').replace(/[^\w]+/g, '-')}`.replace(/-+$/, '')
    await saveReport(r)
    return r.id
  })
  h('deleteReport', async (id) => {
    const trash = path.join(dirs().root, '.deleted')
    await fsp.mkdir(trash, { recursive: true })
    await fsp.rename(reportDir(id), path.join(trash, `${id}-${Date.now()}`))
  })
  h('openReportFolder', (id) => shell.openPath(reportDir(id)))

  // Create a Copy of the Selected Report: everything, including photos, under a new id.
  h('copyReport', async (id) => {
    const r = await readJson(path.join(reportDir(id), 'report.json'))
    const nid = crypto.randomUUID().toUpperCase()
    await fsp.cp(reportDir(id), reportDir(nid), {
      recursive: true,
      filter: (src) => !/[\\/](backups|report\.bak\.json|index\.json|report\.json)$/i.test(src),
    })
    r.id = nid
    r.created = new Date().toISOString()
    r.reportNumber = (r.reportNumber || 'report') + '-Copy'
    delete r.importedFrom; delete r.published
    await saveReport(r)
    return nid
  })

  // Create Reinspection From Selected Report: keep only items on the summary or rated with a
  // summary column (RR). Everything else is excluded so only those items need filling out.
  h('createReinspection', async (id) => {
    const r = await readJson(path.join(reportDir(id), 'report.json'))
    const nid = crypto.randomUUID().toUpperCase()
    const photos = new Set()
    let kept = 0
    for (const s of r.sections || []) {
      const cols = new Set([...(s.ratingColumns || r.template.ratingColumns || [])].filter((c) => c.sendsToSummary).map((c) => c.short))
      cols.add('RR')
      let any = false
      for (const inst of s.instances || []) {
        for (const it of inst.items || []) {
          const rr = !s.excluded && !it.excluded && (it.ratings || []).some((x) => cols.has(x))
          const onSummary = !s.excluded && !it.excluded ? (it.entries || []).filter((e) => e.summary) : []
          if (rr || onSummary.length) {
            it.entries = onSummary.length ? onSummary : it.entries
            it.originalRatings = it.ratings
            it.ratings = []
            it.flagged = false
            for (const e of it.entries) for (const p of e.photos || []) photos.add(p.file)
            any = true; kept++
          } else {
            it.excluded = true; it.entries = []; it.ratings = []; it.flagged = false
          }
        }
        for (const m of inst.materials || []) m.excluded = true
      }
      if (!any) s.excluded = true
    }
    if (r.coverPhoto) photos.add(r.coverPhoto)
    await fsp.mkdir(reportDir(nid), { recursive: true })
    await copyPhotos(id, nid, [...photos])
    r.id = nid
    r.created = new Date().toISOString()
    r.reinspectionOf = id
    r.reportNumber = (r.reportNumber || 'report').replace(/-R$/i, '') + '-R'
    r.inspection = { ...r.inspection, date: new Date().toLocaleDateString('en-CA'), start: '', end: '' }
    r.services = (r.services || []).map((x) => ({ ...x, selected: false }))
    r.invoice = { ...(r.invoice || { taxCents: 0, method: '', note: '' }), status: '' }
    r.attachments = []
    delete r.importedFrom; delete r.published; delete r.uploadCompressed
    await saveReport(r)
    return { id: nid, kept }
  })

  // Merge Report Into This Report: copy the other report's photos and attachments into this report's
  // folder under new names (both reports number photos from i1). A photo that is byte-for-byte the same
  // as one already here is not copied again; it maps to the existing file.
  h('mergeFiles', async (fromId, toId, photos, attachments, dryRun) => {
    const from = sourceDir(fromId), to = reportDir(toId)
    await fsp.mkdir(path.join(to, 'originals'), { recursive: true })
    const hash = async (p) => crypto.createHash('sha1').update(await fsp.readFile(p)).digest('hex')
    const existing = new Map()
    for (const f of await fsp.readdir(to).catch(() => [])) {
      if (!IMG_EXT.test(f)) continue
      try { existing.set(await hash(path.join(to, f)), f) } catch {}
    }
    const map = {}
    let copied = 0, same = 0, missing = 0
    for (const f of photos || []) {
      if (!f) continue
      const src = path.join(from, f)
      if (!fs.existsSync(src)) { missing++; continue }
      const hsh = await hash(src)
      if (existing.has(hsh)) { map[f] = existing.get(hsh); same++; continue }
      if (dryRun) { map[f] = 'new:' + f; copied++; continue }
      const ext = path.extname(f) || '.jpg'
      const name = await nextPhotoName(to, ext)
      await fsp.copyFile(src, path.join(to, name))
      const o = path.join(from, 'originals', f)
      if (fs.existsSync(o)) await fsp.copyFile(o, path.join(to, 'originals', name)).catch(() => {})
      existing.set(hsh, name)
      map[f] = name; copied++
    }
    if (dryRun) return { map, copied, same, missing }
    if (attachments?.length) {
      const d = path.join(to, 'attachments')
      await fsp.mkdir(d, { recursive: true })
      for (const f of attachments) {
        const src = path.join(from, 'attachments', f)
        if (!fs.existsSync(src)) { missing++; continue }
        let name = f; let k = 1
        while (fs.existsSync(path.join(d, name))) name = path.basename(f, path.extname(f)) + `-${k++}` + path.extname(f)
        await fsp.copyFile(src, path.join(d, name))
        map['att:' + f] = name
      }
    }
    await makeBackup(toId, true) // the report as it was before the merge / fill
    return { map, copied, same, missing }
  })

  h('listBackups', async (id) => {
    const out = []
    const bd = backupDir(id)
    for (const f of await fsp.readdir(bd).catch(() => [])) {
      if (!/^report-.*\.json$/.test(f)) continue
      const st = await fsp.stat(path.join(bd, f))
      out.push({ file: `backups/${f}`, time: st.mtime.toISOString(), size: st.size })
    }
    const legacy = path.join(reportDir(id), 'report.bak.json')
    if (fs.existsSync(legacy)) { const st = await fsp.stat(legacy); out.push({ file: 'report.bak.json', time: st.mtime.toISOString(), size: st.size }) }
    return out.sort((a, b) => b.time.localeCompare(a.time))
  })
  h('restoreBackup', async (id, file) => {
    const src = path.join(reportDir(id), file)
    if (!src.startsWith(reportDir(id)) || !fs.existsSync(src)) throw new Error('Backup not found')
    const r = await readJson(src)
    await makeBackup(id, true) // keep what is there now, in case the restore was a mistake
    r.id = id
    await writeJsonAtomic(path.join(reportDir(id), 'report.json'), r)
    await reindex(id)
  })

  // ---------- start page: a report you fill in before picking a template (like HomeGauge) ----------
  const EMPTY_T = { format: 'bridge-template/v1', name: '', ratingColumns: [], costRanges: [], smartFields: {}, comments: {}, commentLibrary: [],
    items: {}, materials: {}, generalInfo: { commentIds: [], materialIds: [] }, sections: [] }
  h('newDraft', async () => {
    const st = await settings().get()
    const r = importer.newReport(EMPTY_T, { date: new Date().toLocaleDateString('en-CA'), city: 'Las Vegas', state: 'NV' })
    r.id = crypto.randomUUID().toUpperCase()
    r.services = st.services.map((x) => ({ name: x.name, priceCents: x.priceCents, qty: 1, selected: false }))
    r.inspection.inspector = st.inspector.name
    r.inspection.license = st.inspector.license
    r.inspection.company = st.inspector.company
    r.draft = true
    return r
  })
  h('createFromDraft', async (templateName, d) => {
    const T = await readJson(path.join(dirs().templates, tplName(templateName) + '.json'))
    const r = importer.newReport(T, {})
    r.id = d.id || r.id
    for (const k of ['reportNumber', 'inspection', 'clients', 'people', 'services', 'invoice', 'misc', 'attachments', 'photoFolder']) if (d[k] !== undefined) r[k] = d[k]
    r.inspection.date ||= new Date().toLocaleDateString('en-CA')
    if (!r.reportNumber) r.reportNumber = `${r.inspection.date.replace(/-/g, '')}-${(r.inspection.address || 'report').replace(/[^\w]+/g, '-')}`.replace(/-+$/, '')
    delete r.draft
    await saveReport(r)
    return r.id
  })
  h('templateInfo', async () => {
    const out = []
    for (const f of (await fsp.readdir(dirs().templates)).filter((x) => x.endsWith('.json'))) {
      const st = await fsp.stat(path.join(dirs().templates, f))
      let sections = 0, comments = 0, source = ''
      try { const T = await readJson(path.join(dirs().templates, f)); sections = T.sections.length; comments = Object.keys(T.comments).length; source = T.source || '' } catch {}
      // the HomeGauge category folder it came from (…\HomeGauge\Templates\<folder>\x.ht5)
      const m = /[\\/]Templates[\\/](.+)[\\/][^\\/]+$/i.exec(source)
      out.push({ name: f.slice(0, -5), sections, comments, source, folder: m ? m[1].replace(/[\\/]/g, ' / ') : '', updated: st.mtime.toISOString() })
    }
    return out.sort((a, b) => a.name.localeCompare(b.name))
  })
  // HomeGauge templates found on this PC (AppData\Local\HomeGauge\Templates), for one-click import
  h('hgTemplates', async () => {
    const hg = settings().hgDir()
    if (!hg) return []
    const out = []
    async function walk(d, depth) {
      for (const e of await fsp.readdir(d, { withFileTypes: true }).catch(() => [])) {
        const p = path.join(d, e.name)
        if (e.isDirectory() && depth < 4) await walk(p, depth + 1)
        else if (/\.ht5$/i.test(e.name)) {
          const st = await fsp.stat(p)
          out.push({ path: p, name: safeName(path.basename(e.name, path.extname(e.name))), folder: path.relative(path.join(hg, 'Templates'), d), updated: st.mtime.toISOString(), size: st.size })
        }
      }
    }
    await walk(path.join(hg, 'Templates'), 0)
    return out.sort((a, b) => a.folder.localeCompare(b.folder) || a.name.localeCompare(b.name))
  })
  h('importTemplateFiles', async (files) => {
    const names = []
    for (const f of files) {
      const name = safeName(path.basename(f, path.extname(f)))
      const T = importer.parseTemplateXml(await fsp.readFile(f, 'utf8'), name)
      T.source = f
      await writeJsonAtomic(path.join(dirs().templates, name + '.json'), T)
      names.push(name)
    }
    return names
  })
  // Re-read the price list, pay lists and inspector info from HomeGauge (replaces what is there now)
  h('importHgSettings', async () => {
    const st = await settings().get()
    const fresh = settings().seedFrom({ ...st, services: [], lists: { ...st.lists, payMethods: [], payStatus: [], payNotes: [] }, inspector: { ...st.inspector, name: '', license: '' } })
    if (!settings().hgDir()) return null
    await settings().save(fresh)
    return { services: fresh.services.length, payMethods: fresh.lists.payMethods.length, payStatus: fresh.lists.payStatus.length, payNotes: fresh.lists.payNotes.length, inspector: fresh.inspector.name }
  })

  h('importTemplate', async () => {
    const hgT = settings().hgDir() ? path.join(settings().hgDir(), 'Templates') : undefined
    const res = await dialog.showOpenDialog(win, { title: 'Import HomeGauge template', defaultPath: hgT, filters: [{ name: 'HomeGauge template', extensions: ['ht5'] }], properties: ['openFile', 'multiSelections'] })
    const names = []
    for (const f of res.filePaths || []) {
      const name = safeName(path.basename(f, path.extname(f)))
      const T = importer.parseTemplateXml(await fsp.readFile(f, 'utf8'), name)
      T.source = f
      await writeJsonAtomic(path.join(dirs().templates, name + '.json'), T)
      names.push(name)
    }
    return names
  })

  h('importReports', async (mode) => {
    const res = mode === 'zip'
      ? await dialog.showOpenDialog(win, { title: 'Import HomeGauge upload (.zip)', filters: [{ name: 'Zip', extensions: ['zip'] }], properties: ['openFile', 'multiSelections'] })
      : await dialog.showOpenDialog(win, { title: 'Select a HomeGauge report folder, or the whole Reports folder', properties: ['openDirectory', 'multiSelections'] })
    if (res.canceled || !res.filePaths?.length) return { done: [], failed: [], skipped: 0 }

    // Expand: a picked folder can be one report (has report.hr5) or a folder of reports (HomeGauge\Reports)
    let sources = []
    if (mode === 'zip') sources = res.filePaths
    else {
      for (const p of res.filePaths) {
        if (fs.existsSync(path.join(p, 'report.hr5'))) { sources.push(p); continue }
        for (const d of await fsp.readdir(p, { withFileTypes: true }).catch(() => [])) {
          const sub = path.join(p, d.name)
          if (d.isDirectory() && fs.existsSync(path.join(sub, 'report.hr5'))) sources.push(sub)
        }
      }
    }
    // skip ones already imported
    const already = new Set()
    for (const id of await fsp.readdir(dirs().reports)) {
      try { const ix = await readJson(path.join(reportDir(id), 'index.json')); if (ix.importedFrom) already.add(ix.importedFrom.toLowerCase()) } catch {}
    }
    const fresh = sources.filter((s) => !already.has(s.toLowerCase()))
    const skipped = sources.length - fresh.length
    if (!fresh.length) return { done: [], failed: sources.length ? [] : ['No HomeGauge reports (report.hr5) found in that folder.'], skipped }

    // newest first, by when HomeGauge last saved them
    const withTime = await Promise.all(fresh.map(async (s) => ({ s, t: (await fsp.stat(mode === 'zip' ? s : path.join(s, 'report.hr5'))).mtimeMs })))
    withTime.sort((a, b) => b.t - a.t)
    let list = withTime.map((x) => x.s)
    if (list.length > 10) {
      const ans = await dialog.showMessageBox(win, {
        type: 'question', title: 'Import HomeGauge reports',
        message: `Found ${list.length} HomeGauge reports${skipped ? ` (${skipped} already imported were skipped)` : ''}.`,
        detail: 'Importing copies each report and its photos (about 15 MB per report). Your HomeGauge files are not changed.',
        buttons: ['Newest 10', 'Newest 50', `All ${list.length}`, 'Cancel'], defaultId: 0, cancelId: 3,
      })
      if (ans.response === 3) return { done: [], failed: [], skipped }
      list = list.slice(0, [10, 50, list.length][ans.response])
    }

    const done = [], failed = []
    for (const [n, src] of list.entries()) {
      win.webContents.send('progress', `Importing ${n + 1} of ${list.length}: ${path.basename(src)}…`)
      try {
        let xml, files
        if (mode === 'zip') {
          const zip = await JSZip.loadAsync(await fsp.readFile(src))
          const hr = Object.values(zip.files).find((f) => /(^|\/)report\.hr5$/i.test(f.name))
          if (!hr) throw new Error('no report.hr5 inside this zip')
          xml = await hr.async('string')
          files = Object.values(zip.files).filter((f) => !f.dir && IMG_EXT.test(f.name)).map((f) => ({ name: path.basename(f.name), get: () => f.async('nodebuffer') }))
        } else {
          xml = await fsp.readFile(path.join(src, 'report.hr5'), 'utf8')
          files = (await fsp.readdir(src)).filter((f) => IMG_EXT.test(f)).map((f) => ({ name: f, get: () => fsp.readFile(path.join(src, f)) }))
        }
        const r = importer.parseReportXml(xml)
        r.importedFrom = src
        const cover = files.find((f) => /^cover\d*\.(jpe?g|png)$/i.test(f.name))
        if (cover) r.coverPhoto = cover.name
        if (!r.id || fs.existsSync(reportDir(r.id))) r.id = require('crypto').randomUUID()
        await fsp.mkdir(reportDir(r.id), { recursive: true })
        for (const f of files) await fsp.writeFile(path.join(reportDir(r.id), f.name), await f.get())
        await saveReport(r)
        done.push(r.reportNumber || r.id)
      } catch (e) { failed.push(`${path.basename(src)}: ${e.message}`) }
    }
    win.webContents.send('progress', '')
    return { done, failed, skipped }
  })

  h('pickFolder', async (title, defaultPath) => (await dialog.showOpenDialog(win, { title: title || 'Choose folder', defaultPath: defaultPath && fs.existsSync(defaultPath) ? defaultPath : undefined, properties: ['openDirectory'] })).filePaths?.[0] || null)
  h('pickFiles', async (title) => (await dialog.showOpenDialog(win, { title, properties: ['openFile', 'multiSelections'], filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'] }] })).filePaths || [])
  h('listImages', listImages)

  // photo bytes come from the renderer already resized; we keep an untouched copy for "Revert"
  h('addPhoto', async (reportId, bytes, ext, original) => {
    const dir = reportDir(reportId)
    await fsp.mkdir(path.join(dir, 'originals'), { recursive: true })
    const name = await nextPhotoName(dir, ext || '.jpg')
    await fsp.writeFile(path.join(dir, name), Buffer.from(bytes))
    await fsp.writeFile(path.join(dir, 'originals', name), Buffer.from(original || bytes))
    return name
  })
  h('savePhoto', async (reportId, file, bytes) => {
    const dir = reportDir(reportId)
    const orig = path.join(dir, 'originals', file)
    if (!fs.existsSync(orig)) { await fsp.mkdir(path.dirname(orig), { recursive: true }); await fsp.copyFile(path.join(dir, file), orig) }
    // edited photos get a new name so cached images refresh
    const ext = path.extname(file)
    const base = file.replace(/(-e\d+)?\.[^.]+$/, '')
    const newName = `${base}-e${Date.now() % 100000}${ext}`
    await fsp.writeFile(path.join(dir, newName), Buffer.from(bytes))
    await fsp.copyFile(orig, path.join(dir, 'originals', newName))
    return newName
  })
  h('originalOf', (reportId, file) => {
    const p = path.join(reportDir(reportId), 'originals', file)
    return fs.existsSync(p) ? p : path.join(reportDir(reportId), file)
  })

  h('importLibrary', async () => {
    const src = (await dialog.showOpenDialog(win, { title: 'Import drawings/illustrations folder (e.g. HomeGauge\\Drawings)', properties: ['openDirectory'] })).filePaths?.[0]
    if (!src) return 0
    const imgs = await listImages(src, true)
    for (const im of imgs) {
      const dest = path.join(dirs().library, path.basename(src), im.folder, im.name)
      await fsp.mkdir(path.dirname(dest), { recursive: true })
      if (!fs.existsSync(dest)) await fsp.copyFile(im.path, dest)
    }
    return imgs.length
  })
  h('addToLibrary', async (paths, sub) => {
    const d = path.join(dirs().library, sub || 'My Illustrations')
    await fsp.mkdir(d, { recursive: true })
    for (const p of paths) await fsp.copyFile(p, path.join(d, path.basename(p)))
  })
  h('openDataFolder', () => shell.openPath(dirs().root))
  h('branding', getBranding)
  h('saveBranding', async (company) => {
    const st = await settings().get()
    await settings().save({ ...st, company })
    return getBranding()
  })
  h('getSettings', () => settings().get())
  h('saveSettings', (st) => settings().save(st))
  h('contacts', () => settings().contacts())
  h('saveContact', (c) => settings().saveContact(c))
  h('importContacts', async () => {
    const f = (await dialog.showOpenDialog(win, { title: 'Import contacts (HomeGauge people4.csv)', defaultPath: settings().hgDir() || undefined, properties: ['openFile'], filters: [{ name: 'CSV', extensions: ['csv'] }] })).filePaths?.[0]
    return f ? settings().importContactsCsv(f) : 0
  })
  h('openExternal', (url) => { if (/^https:\/\//.test(url)) shell.openExternal(url) })
  h('addAttachments', async (reportId) => {
    const res = await dialog.showOpenDialog(win, { title: 'Add attachments (PDF or image)', properties: ['openFile', 'multiSelections'], filters: [{ name: 'PDF or image', extensions: ['pdf', 'jpg', 'jpeg', 'png'] }] })
    const out = []
    const d = path.join(reportDir(reportId), 'attachments')
    await fsp.mkdir(d, { recursive: true })
    for (const f of res.filePaths || []) {
      let name = path.basename(f); let k = 1
      while (fs.existsSync(path.join(d, name))) name = path.basename(f, path.extname(f)) + `-${k++}` + path.extname(f)
      await fsp.copyFile(f, path.join(d, name))
      out.push({ file: name, name: path.basename(f, path.extname(f)), include: true })
    }
    return out
  })
  h('openAttachment', (reportId, file) => shell.openPath(path.join(reportDir(reportId), 'attachments', file)))
  h('compressForUpload', (reportId, maxEdge) => compressPhotos(reportId, maxEdge))
  // ---------- report fills ----------
  // A fill is a saved set of starting answers (ratings, comments, photos, S&M) taken from a report.
  // v2 (current): Fills\<name>\fill.json + the photos it uses. v1 (older): Fills\<name>.json, no photos.
  h('listFills', async () => {
    const out = []
    for (const e of await fsp.readdir(fillsDir(), { withFileTypes: true }).catch(() => [])) {
      try {
        if (e.isDirectory()) {
          const p = path.join(fillsDir(), e.name, 'fill.json')
          if (!fs.existsSync(p)) continue
          const f = await readJson(p)
          out.push({ name: f.name || e.name, date: f.date || '', template: f.template || '', from: f.from || '', source: f.source || '', counts: f.counts || null, version: 2 })
        } else if (e.name.endsWith('.json')) {
          const st = await fsp.stat(path.join(fillsDir(), e.name))
          out.push({ name: e.name.slice(0, -5), date: st.mtime.toISOString(), template: '', from: '', source: '', counts: null, version: 1 })
        }
      } catch {}
    }
    return out.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
  })
  h('loadFill', async (name) => {
    const d = fillDir(name)
    if (fs.existsSync(path.join(d, 'fill.json'))) return readJson(path.join(d, 'fill.json'))
    return readJson(path.join(fillsDir(), safeName(name) + '.json'))
  })
  // Save a fill from a report: its answers plus copies of the photos those answers use.
  h('saveFill', async (name, fromReportId, data) => {
    name = safeName(name)
    if (!name) throw new Error('The fill needs a name')
    const d = fillDir(name)
    const tmp = d + '.saving'
    await fsp.rm(tmp, { recursive: true, force: true })
    await fsp.mkdir(tmp, { recursive: true })
    for (const f of data.photos || []) {
      const src = path.join(reportDir(fromReportId), f)
      if (fs.existsSync(src)) await fsp.copyFile(src, path.join(tmp, f)).catch(() => {})
    }
    delete data.photos
    await writeJsonAtomic(path.join(tmp, 'fill.json'), { ...data, version: 2, name, date: new Date().toISOString() })
    await fsp.rm(d, { recursive: true, force: true })
    await fsp.rm(path.join(fillsDir(), name + '.json'), { force: true })
    await fsp.rename(tmp, d)
    return name
  })
  h('deleteFill', async (name) => {
    await fsp.rm(fillDir(name), { recursive: true, force: true })
    await fsp.rm(path.join(fillsDir(), safeName(name) + '.json'), { force: true })
  })
  h('renameFill', async (oldName, newName) => {
    newName = safeName(newName)
    if (!newName) throw new Error('The fill needs a name')
    if (fs.existsSync(fillDir(newName)) || fs.existsSync(path.join(fillsDir(), newName + '.json'))) throw new Error(`There is already a fill called "${newName}".`)
    if (fs.existsSync(fillDir(oldName))) {
      await fsp.rename(fillDir(oldName), fillDir(newName))
      const p = path.join(fillDir(newName), 'fill.json')
      const f = await readJson(p); f.name = newName; await writeJsonAtomic(p, f)
    } else await fsp.rename(path.join(fillsDir(), safeName(oldName) + '.json'), path.join(fillsDir(), newName + '.json'))
    return newName
  })
  // HomeGauge keeps its report fills in AppData\Local\HomeGauge\AutoFill\<n>\<name>.hf3 (+ photos).
  // An .hf3 is a report file without the customer/appointment part, so the report importer reads it.
  h('hgFills', async () => {
    const hg = settings().hgDir()
    if (!hg) return []
    const out = []
    const root = path.join(hg, 'AutoFill')
    for (const e of await fsp.readdir(root, { withFileTypes: true }).catch(() => [])) {
      if (!e.isDirectory()) continue
      const d = path.join(root, e.name)
      for (const f of await fsp.readdir(d).catch(() => [])) {
        if (!/\.hf3$/i.test(f)) continue
        const st = await fsp.stat(path.join(d, f))
        out.push({ path: path.join(d, f), name: safeName(f.replace(/\.hf3$/i, '')), updated: st.mtime.toISOString() })
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
  })
  h('importHgFills', async (paths) => {
    const done = []
    let n = 0
    for (const p of paths) {
      win.webContents.send('progress', `Importing report fill ${++n} of ${paths.length}…`)
      try {
        const r = importer.parseReportXml(await fsp.readFile(p, 'utf8'))
        const src = path.dirname(p)
        const name = safeName(path.basename(p).replace(/\.hf3$/i, ''))
        const d = fillDir(name), tmp = d + '.saving'
        await fsp.rm(tmp, { recursive: true, force: true })
        await fsp.mkdir(tmp, { recursive: true })
        // keep only photos that HomeGauge actually stored with the fill
        let photos = 0, missing = 0
        for (const s of r.sections) for (const inst of s.instances) for (const it of inst.items) for (const en of it.entries) {
          en.photos = en.photos.filter((ph) => {
            if (ph.placeholder) return true
            const ok = ph.file && fs.existsSync(path.join(src, ph.file))
            if (!ok) { missing++; return false }
            return true
          })
          for (const ph of en.photos) { if (ph.placeholder) continue; if (!fs.existsSync(path.join(tmp, ph.file))) await fsp.copyFile(path.join(src, ph.file), path.join(tmp, ph.file)); photos++ }
        }
        // previousSelections.txt = the rows ticked in HomeGauge's Select Sections (0 = General, 1… = sections in order)
        let selected = null
        try {
          const txt = (await fsp.readFile(path.join(src, 'previousSelections.txt'), 'utf8')).trim()
          if (txt) selected = new Set(txt.split(/[,\s]+/).filter(Boolean).map(Number))
        } catch {}
        // (only when the file kept every section; otherwise HomeGauge already left the unticked ones out)
        if (selected && r.sections.length >= Math.max(...selected)) {
          r.sections = r.sections.filter((_, i) => selected.has(i + 1))
          if (!selected.has(0)) r.generalInfo = { html: '', materials: [] }
        }
        const st = await fsp.stat(p)
        const fill = {
          selected: [...(!selected || selected.has(0) ? ['General'] : []), ...r.sections.map((x) => x.name)],
          version: 2, name, date: st.mtime.toISOString(), template: r.template.name, from: '', source: p,
          report: { sections: r.sections, generalInfo: r.generalInfo, template: r.template },
          counts: fillCounts(r), missingPhotos: missing,
        }
        await writeJsonAtomic(path.join(tmp, 'fill.json'), fill)
        await fsp.rm(d, { recursive: true, force: true })
        await fsp.rename(tmp, d)
        done.push({ name, photos, missing })
      } catch (e) { done.push({ name: path.basename(p), error: String(e?.message || e) }) }
    }
    win.webContents.send('progress', '')
    return done
  })
  h('deleteContact', async (id) => { const list = await settings().contacts(); const i = list.findIndex((c) => c.id === id); if (i >= 0) { list.splice(i, 1); await fsp.writeFile(path.join(dirs().root, 'contacts.json'), JSON.stringify(list)) } return list })
  const csv = (rows) => rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n')
  async function saveCsv(title, name, rows) {
    const res = await dialog.showSaveDialog(win, { title, defaultPath: path.join(app.getPath('documents'), name), filters: [{ name: 'CSV (Excel)', extensions: ['csv'] }] })
    if (!res.filePath) return null
    await fsp.writeFile(res.filePath, '\ufeff' + csv(rows)); shell.showItemInFolder(res.filePath); return res.filePath
  }
  h('exportContacts', async () => {
    const list = await settings().contacts()
    const cols = ['type', 'first', 'last', 'company', 'email', 'phone', 'workPhone', 'homePhone', 'address', 'address2', 'city', 'state', 'zip', 'note', 'id']
    return saveCsv('Export contacts', 'contacts.csv', [cols, ...list.map((c) => cols.map((k) => c[k]))])
  })
  h('exportReportInfo', async () => {
    const rows = [['Date', 'Report ID', 'Address', 'City', 'State', 'Zip', 'Client', 'Client email', 'Client phone', 'Agents', 'Inspector', 'Lead source', 'Total', 'Payment status']]
    for (const id of await fsp.readdir(dirs().reports)) {
      try {
        const r = await readJson(path.join(reportDir(id), 'report.json'))
        const c = r.clients?.[0] || {}
        const total = (r.services || []).filter((x) => x.selected).reduce((n, x) => n + x.priceCents * x.qty, 0) / 100 + (r.invoice?.taxCents || 0) / 100
        rows.push([r.inspection.date, r.reportNumber, r.inspection.address, r.inspection.city, r.inspection.state, r.inspection.zip,
          `${c.first || ''} ${c.last || ''}`.trim(), c.email, c.phone, (r.people || []).map((p) => `${p.first} ${p.last}`.trim()).join('; '),
          r.inspection.inspector, r.misc?.leadSource, total.toFixed(2), r.invoice?.status])
      } catch {}
    }
    return saveCsv('Export report info & customers', 'reports.csv', rows)
  })
  h('exportComments', async (comments, folderOf) => saveCsv('Export comments', 'comments.csv',
    [['id', 'name', 'folder', 'text'], ...Object.values(comments).map((c) => [c.id, c.name, folderOf[c.id] || '', c.html])]))
  h('importCommentsCsv', async () => {
    const f = (await dialog.showOpenDialog(win, { title: 'Import comments (CSV)', properties: ['openFile'], filters: [{ name: 'CSV', extensions: ['csv'] }] })).filePaths?.[0]
    if (!f) return null
    const { parseCsv } = require('./settings')
    const rows = parseCsv((await fsp.readFile(f, 'utf8')).replace(/^\ufeff/, ''))
    const head = rows.shift().map((x) => x.toLowerCase())
    return rows.map((r) => ({ id: r[head.indexOf('id')] || '', name: r[head.indexOf('name')] || '', folder: r[head.indexOf('folder')] || '', html: r[head.indexOf('text')] || '' })).filter((x) => x.html)
  })
  h('dataSizes', async (reportId) => {
    const dir = reportDir(reportId)
    const sizeOf = async (d, filter = () => true) => { let n = 0, c = 0; for (const f of await fsp.readdir(d).catch(() => [])) { const st = await fsp.stat(path.join(d, f)); if (st.isFile() && filter(f)) { n += st.size; c++ } } return { n, c } }
    return {
      photos: await sizeOf(dir, (f) => IMG_EXT.test(f)), originals: await sizeOf(path.join(dir, 'originals')),
      attachments: await sizeOf(path.join(dir, 'attachments')), data: await sizeOf(dir, (f) => f.endsWith('.json')),
    }
  })
  h('photoLocker', async (reportId) => { const d = path.join(reportDir(reportId), 'originals'); await fsp.mkdir(d, { recursive: true }); shell.openPath(d) })
  h('misc:openPath', (p) => shell.openPath(p))
  h('pickLogo', async () => {
    const f = (await dialog.showOpenDialog(win, { title: 'Choose your company logo', properties: ['openFile'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }] })).filePaths?.[0]
    if (!f) return getBranding()
    await fsp.mkdir(dirs().branding, { recursive: true })
    for (const old of await fsp.readdir(dirs().branding)) if (/^logo\./i.test(old)) await fsp.rename(path.join(dirs().branding, old), path.join(dirs().branding, `old-${Date.now()}-${old}`))
    await fsp.copyFile(f, path.join(dirs().branding, 'logo' + path.extname(f).toLowerCase()))
    return getBranding()
  })
  h('printToPdf', async (html, suggested, hf, attach) => {
    const res = await dialog.showSaveDialog(win, { title: 'Save report PDF', defaultPath: path.join(app.getPath('documents'), (suggested || 'report') + '.pdf'), filters: [{ name: 'PDF', extensions: ['pdf'] }] })
    if (!res.filePath) return null
    let pdf = await renderPdf(html, hf)
    if (attach?.reportId && attach.files?.length) pdf = await appendAttachments(pdf, attach.files.map((f) => path.join(reportDir(attach.reportId), 'attachments', f)))
    await fsp.writeFile(res.filePath, pdf)
    shell.openPath(res.filePath)
    return res.filePath
  })
}

// ---------- PDF ----------
/** Print HTML to PDF twice: first to find which page each section lands on, then with real TOC page numbers. */
async function renderPdf(html, hf) {
  const pw = new BrowserWindow({ show: false, width: 816, height: 1056, webPreferences: { sandbox: true } })
  const tmp = path.join(app.getPath('temp'), `bridge-print-${Date.now()}.html`)
  const opts = {
    printBackground: true, pageSize: 'Letter', generateDocumentOutline: true,
    margins: { top: 0.55, bottom: 0.55, left: 0.4, right: 0.4 },
    displayHeaderFooter: !!hf, headerTemplate: hf?.header || '<span></span>', footerTemplate: hf?.footer || '<span></span>',
  }
  const print = async (h) => {
    await fsp.writeFile(tmp, h)
    await pw.loadFile(tmp)
    await pw.webContents.executeJavaScript('document.fonts.ready.then(() => Promise.all([...document.images].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r }))))')
    return pw.webContents.printToPDF(opts)
  }
  try {
    const tokens = [...new Set([...html.matchAll(/\{\{PG:([\w-]+)\}\}/g)].map((m) => m[1]))]
    if (!tokens.length) return await print(html)
    const first = await print(html.replace(/\{\{PG:[\w-]+\}\}/g, '00'))
    const pages = await findMarkers(first, tokens)
    return await print(html.replace(/\{\{PG:([\w-]+)\}\}/g, (_, id) => (pages[id] ? String(pages[id]) : '')))
  } finally {
    pw.destroy(); fsp.unlink(tmp).catch(() => {})
  }
}
async function findMarkers(pdfBuf, ids) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const doc = await getDocument({ data: new Uint8Array(pdfBuf), disableFontFace: true, isEvalSupported: false }).promise
  const out = {}
  for (let p = 1; p <= doc.numPages; p++) {
    const text = (await (await doc.getPage(p)).getTextContent()).items.map((i) => i.str).join('')
    for (const id of ids) if (!out[id] && text.includes(`QQ${id}QQ`)) out[id] = p
  }
  return out
}

/** Add attached PDFs (all pages) and images (one page each) to the end of the report PDF. */
async function appendAttachments(pdfBuf, files) {
  const { PDFDocument } = require('pdf-lib')
  const doc = await PDFDocument.load(pdfBuf)
  for (const f of files) {
    try {
      const bytes = await fsp.readFile(f)
      if (/\.pdf$/i.test(f)) {
        const src = await PDFDocument.load(bytes, { ignoreEncryption: true })
        for (const p of await doc.copyPages(src, src.getPageIndices())) doc.addPage(p)
      } else {
        const img = /\.png$/i.test(f) ? await doc.embedPng(bytes) : await doc.embedJpg(bytes)
        const page = doc.addPage([612, 792])
        const k = Math.min(540 / img.width, 720 / img.height, 1)
        page.drawImage(img, { x: (612 - img.width * k) / 2, y: (792 - img.height * k) / 2, width: img.width * k, height: img.height * k })
      }
    } catch (e) { console.error('attachment failed', f, e.message) }
  }
  return Buffer.from(await doc.save())
}

/**
 * Shrink report photos to the upload size. Safe to run repeatedly: photos already at or below
 * the size are left alone, so a report is never compressed twice. Untouched originals stay on this PC.
 */
async function compressPhotos(reportId, maxEdge = 640) {
  const dir = reportDir(reportId)
  let before = 0, after = 0, changed = 0
  for (const f of await fsp.readdir(dir)) {
    if (!IMG_EXT.test(f)) continue
    const p = path.join(dir, f)
    const st = await fsp.stat(p)
    before += st.size
    const img = nativeImage.createFromPath(p)
    const { width, height } = img.getSize()
    if (Math.max(width, height) > maxEdge) {
      const r = width >= height ? img.resize({ width: maxEdge, quality: 'best' }) : img.resize({ height: maxEdge, quality: 'best' })
      const buf = /\.png$/i.test(f) ? r.toPNG() : r.toJPEG(85)
      await fsp.writeFile(p, buf)
      after += buf.length; changed++
    } else after += st.size
  }
  return { changed, before, after }
}

// ---------- image protocols ----------
function registerProtocols() {
  // brimg://f/?p=<absolute path>
  protocol.handle('brimg', async (req) => {
    const u = new URL(req.url)
    const p = u.searchParams.get('p')
    if (!p || !fs.existsSync(p)) return new Response('', { status: 404 })
    const m = +(u.searchParams.get('m') || 0)
    if (m) { // downsampled copy (used by the report preview/PDF so high-res photos don't bloat it)
      const st = await fsp.stat(p)
      const cache = path.join(dirs().thumbs, Buffer.from(`${p}|${st.size}|${st.mtimeMs}|m${m}`).toString('base64url').slice(-120) + '.jpg')
      if (!fs.existsSync(cache)) {
        const img = nativeImage.createFromPath(p)
        const { width, height } = img.getSize()
        const out = Math.max(width, height) > m ? (width >= height ? img.resize({ width: m, quality: 'best' }) : img.resize({ height: m, quality: 'best' })) : img
        await fsp.writeFile(cache, out.toJPEG(85))
      }
      return new Response(await fsp.readFile(cache), { headers: { 'content-type': 'image/jpeg', 'access-control-allow-origin': '*' } })
    }
    const res = await net.fetch(pathToFileURL(p).toString())
    // allow canvas/fetch use from the app page (photo resizing and editing)
    return new Response(res.body, { status: res.status, headers: { 'content-type': res.headers.get('content-type') || 'image/jpeg', 'access-control-allow-origin': '*', 'cache-control': 'no-cache' } })
  })
  // brthumb://t/?p=<absolute path>&s=<px>  (cached thumbnails so big photo folders stay fast)
  protocol.handle('brthumb', async (req) => {
    const u = new URL(req.url)
    const p = u.searchParams.get('p')
    const size = +(u.searchParams.get('s') || 240)
    try {
      const st = await fsp.stat(p)
      const key = Buffer.from(`${p}|${st.size}|${st.mtimeMs}|${size}`).toString('base64url').slice(-120)
      const cache = path.join(dirs().thumbs, key + '.jpg')
      if (!fs.existsSync(cache)) {
        let img
        try { img = await nativeImage.createThumbnailFromPath(p, { width: size, height: size }) } catch {}
        if (!img || img.isEmpty()) img = nativeImage.createFromPath(p).resize({ width: size, quality: 'good' })
        await fsp.writeFile(cache, img.toJPEG(80))
      }
      return new Response(await fsp.readFile(cache), { headers: { 'content-type': 'image/jpeg', 'access-control-allow-origin': '*' } })
    } catch {
      return new Response('', { status: 404 })
    }
  })
}

function buildMenu(win) {
  const send = (cmd) => () => win.webContents.send('menu', cmd)
  const item = (label, cmd, accelerator) => ({ label, accelerator, click: send(cmd) })
  const soon = (label, accelerator) => ({ label: label + '  (cloud phase)', accelerator, enabled: false })
  const sep = { type: 'separator' }
  const template = [
    { label: 'File', submenu: [
      item('New Report', 'new', 'CmdOrCtrl+N'), item('Open Report…', 'openList', 'CmdOrCtrl+O'), item('Start Page', 'home'), item('Save Report', 'save', 'CmdOrCtrl+S'), sep,
      item('Merge Report Into This Report…', 'mergeInto'), sep,
      item('Save Template As…', 'saveTemplateAs'), sep,
      item('Import HomeGauge Reports…', 'importReports'), item('Import HomeGauge Upload (.zip)…', 'importZip'), item('Import HomeGauge Contacts (people4.csv)…', 'importContacts'), item('Import HomeGauge Settings (prices, pay lists, inspector)…', 'importHgSettings'), item('Import HomeGauge Report Fills…', 'importHgFills'), sep,
      item('Export Report Info && Customers…', 'exportReportInfo'), item('Export Contacts…', 'exportContacts'), sep,
      item('Preview Report', 'preview', 'CmdOrCtrl+P'), soon('Publish Report w/ Preview First…', 'CmdOrCtrl+U'), item('Print To File (PDF)…', 'pdf'), sep,
      { label: 'Open Data Folder', click: () => shell.openPath(dirs().root) }, sep,
      { role: 'quit', label: 'Exit' },
    ] },
    { label: 'Edit', submenu: [
      { role: 'undo' }, { role: 'redo' }, sep, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }, sep,
      item('Check Spelling', 'spellCheck', 'Alt+F7'),
    ] },
    { label: 'View', submenu: [
      item('Show/Hide Sections Panel', 'toggleTree', 'CmdOrCtrl+1'), item('Show/Hide Pictures Panel', 'togglePhotos', 'CmdOrCtrl+2'), item('Show/Hide Status Bar', 'toggleStatus'),
      item('Default Pane Layout', 'resetLayout'),
      { label: 'Theme', submenu: [item('Dark', 'themeDark'), item('Light', 'themeLight')] }, sep,
      { role: 'zoomIn', label: 'Bigger Text' }, { role: 'zoomOut', label: 'Smaller Text' }, { role: 'resetZoom', label: 'Normal Text Size' }, sep,
      { role: 'togglefullscreen' },
    ] },
    { label: 'Go', submenu: [
      item('Next', 'next', 'Alt+Right'), item('Back', 'back', 'Alt+Left'), sep,
      item('Find First Unanswered', 'findFirstUnanswered', 'CmdOrCtrl+F'), item('Find Next Unanswered', 'findUnanswered', 'F3'), sep,
      item('Find First Unanswered Style && Material', 'findFirstSM'), item('Find Next Unanswered Style && Material', 'findNextSM'), sep,
      item('Find First Flagged', 'findFirstFlag'), item('Find Next Flagged', 'findNextFlag'), sep,
      item('Find First Photo', 'findFirstPhoto'), item('Find Next Photo', 'findNextPhoto'), sep,
      item('Edit All Photos From Start', 'editPhotosStart'), item('Edit All Photos From Current', 'editPhotosCurrent'), sep,
      item('Customer', 'customer'), item('Report Info', 'info'), item('Summary', 'summary'),
    ] },
    { label: 'Report', submenu: [
      item('Apply Report Fill…', 'applyFill'), item('Save New Report Fill…', 'saveFill'), sep,
      item('Merge Report Into This Report…', 'mergeInto'), sep,
      item('Spell Check Report', 'spellCheck'), sep,
      item('Display Report Data Sizes…', 'dataSizes'), item('Show Photo Locker', 'photoLocker'), item('Compress Photos for Upload…', 'compress'), sep,
      item('Preview', 'preview'), item('Save as PDF…', 'pdf'),
    ] },
    { label: 'Template', submenu: [
      item('Edit Column Headers…', 'columnHeaders'), item('All Comments…', 'allComments'), sep,
      item('Save Template As…', 'saveTemplateAs'), item('Import HomeGauge Template (.ht5)…', 'importTemplate'), sep,
      item('Export Comments…', 'exportComments'), item('Import Comments…', 'importComments'), sep,
      { label: 'Open Templates Folder', click: () => shell.openPath(dirs().templates) },
    ] },
    { label: 'Cloud', submenu: [
      soon('Publish Report w/ Preview First…'), soon('View Published Reports'), soon('Dashboard'), sep,
      soon('View Online Appointments'), soon('Download Online Appointments'), sep,
      soon('Send Report To Cloud…'), soon('Get Report From Cloud…'), sep,
      soon('Upload Templates && Settings…'), soon('Download Templates && Settings…'),
    ] },
    { label: 'Office', submenu: [
      item('Contacts…', 'contacts'), item('Import HomeGauge Contacts…', 'importContacts'), item('Export Contacts…', 'exportContacts'),
    ] },
    { label: 'Options', submenu: [
      item('Inspector && License…', 'inspectorProfile'), item('Company Settings (name, phone, logo)…', 'companySettings'), item('Picture Default Settings…', 'photoSettings'),
    ] },
    { label: 'Help', submenu: [
      item('CYA Library', 'cya'), sep,
      { label: 'About Bridge Report', click: () => dialog.showMessageBox(win, { title: 'Bridge Report', message: `Bridge Report ${app.getVersion()}`, detail: `Data folder:\n${dirs().root}` }) }, sep,
      { role: 'reload', label: 'Reload Window' }, { role: 'toggleDevTools', label: 'Developer Tools' },
    ] },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// ---------- window size & position (remembered between launches) ----------
const winStateFile = () => path.join(dataDir(), '.window.json')
function loadWinState() {
  try {
    const st = JSON.parse(fs.readFileSync(winStateFile(), 'utf8'))
    const { screen } = require('electron')
    // only reuse the spot if it is still on a connected monitor
    const area = screen.getDisplayMatching(st.bounds).workArea
    const visible = st.bounds.x < area.x + area.width - 100 && st.bounds.x + st.bounds.width > area.x + 100 &&
      st.bounds.y >= area.y - 20 && st.bounds.y < area.y + area.height - 100
    return visible ? st : { bounds: { width: st.bounds.width, height: st.bounds.height }, maximized: st.maximized }
  } catch { return null }
}
function trackWinState(win) {
  let t = null
  const write = () => {
    try {
      const st = { bounds: win.isMaximized() || win.isMinimized() || win.isFullScreen() ? win.getNormalBounds() : win.getBounds(), maximized: win.isMaximized() }
      fs.writeFileSync(winStateFile(), JSON.stringify(st))
    } catch {}
  }
  const later = () => { clearTimeout(t); t = setTimeout(write, 400) }
  win.on('resize', later); win.on('move', later); win.on('maximize', later); win.on('unmaximize', later)
  win.on('close', () => { clearTimeout(t); write() })
}

async function createWindow() {
  if (!gotLock) return
  await ensureDirs()
  registerProtocols()
  const ws = loadWinState()
  const win = new BrowserWindow({
    width: 1600, height: 1000, ...(ws?.bounds || {}), show: false, backgroundColor: '#1e1e1e', title: 'Bridge Report',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: false },
  })
  if (ws?.maximized) win.maximize()
  win.once('ready-to-show', () => win.show())
  setTimeout(() => { if (!win.isDestroyed() && !win.isVisible()) win.show() }, 4000)
  trackWinState(win)
  mainWin = win
  buildMenu(win)
  win.webContents.session.setSpellCheckerLanguages(['en-US'])
  win.webContents.on('context-menu', (_e, p) => {
    const items = []
    if (p.misspelledWord) {
      for (const sug of p.dictionarySuggestions.slice(0, 6)) items.push({ label: sug, click: () => win.webContents.replaceMisspelling(sug) })
      if (!p.dictionarySuggestions.length) items.push({ label: 'No suggestions', enabled: false })
      items.push({ label: `Add “${p.misspelledWord}” to dictionary`, click: () => win.webContents.session.addWordToSpellCheckerDictionary(p.misspelledWord) }, { type: 'separator' })
    }
    if (p.isEditable) items.push({ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' })
    else if (p.selectionText) items.push({ role: 'copy' })
    if (items.length) Menu.buildFromTemplate(items).popup({ window: win })
  })
  registerIpc(win)
  if (isDev) await win.loadURL('http://localhost:5199')
  else await win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
}

app.whenReady().then(createWindow)
app.on('window-all-closed', () => app.quit())
