/**
 * Merge Report Into This Report.
 *
 * Brings the findings of another report (the "source") into the open report (the "target"):
 *  - sections with the same name merge; sections with a different name are added
 *  - inside a section, items are matched by id and then by title; new items are added
 *  - ratings are combined, comments already in the target (same text) are not duplicated,
 *    and photos are copied over (the main process renames them and skips exact duplicates)
 *  - Styles & Materials selections are combined
 *  - the target keeps its customer, agents, services and price unless asked otherwise
 *
 * Pure functions only (no DOM, no file access) so the same code builds the preview and does the merge.
 */
import type { Report, Section, Instance, ItemAnswer, MaterialAnswer, Entry, Photo, RatingColumn } from './types'

export interface MergeOptions {
  /** source section id → bring it over (sections with nothing in them are skipped anyway) */
  sections: Record<string, boolean>
  materials: boolean
  generalInfo: 'keep' | 'replace'
  customer: boolean
  services: boolean
  inspection: boolean
  cover: boolean
  attachments: boolean
}

export interface ItemPlan {
  title: string; newItem: boolean; ratings: string[]; ratingConflict: boolean
  comments: number; dupComments: number; photos: number; summary: number; unexclude: boolean
}
export interface SectionPlan {
  srcId: string; group: string; name: string
  /** name of the matching section in this report, or null when it will be added as a new section */
  match: string | null
  newInstances: string[]
  unexclude: boolean
  items: ItemPlan[]
  materials: { name: string; added: string[]; extraInfo: boolean; newMaterial: boolean }[]
  totals: { items: number; comments: number; photos: number; materials: number }
}
export interface MergePlan {
  sections: SectionPlan[]
  /** sections in the other report with nothing filled in (left out of the list) */
  emptySections: number
  generalInfo: { replace: boolean; materials: number }
  photosToCopy: string[]
  attachmentsToCopy: string[]
  cover: string | null
  warnings: string[]
}

// ---------- helpers ----------
const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" }
/** HTML → plain text for comparing comments (no DOM so this also runs in tests). */
export function plain(html: string): string {
  return String(html || '')
    .replace(/<(br|\/p|\/div|\/li)[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#?\w+);/g, (m, e) => ENT[e.toLowerCase()] ?? (/^#\d+$/.test(e) ? String.fromCharCode(+e.slice(1)) : m))
    .replace(/\s+/g, ' ')
    .trim()
}
const key = (s: string) => plain(s).toLowerCase().replace(/[^\w ]+/g, '').replace(/\s+/g, ' ').trim()
const norm = (s: string) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))
const newId = () => (globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now().toString(36))

const entryHas = (e: Entry) => !!plain(e.html) || (e.photos || []).length > 0
export const itemHasContent = (it: ItemAnswer) => !it.excluded && ((it.ratings || []).length > 0 || (it.entries || []).some(entryHas) || !!it.flagged)
const matHasContent = (m: MaterialAnswer) => !m.excluded && ((m.selected || []).length > 0 || !!plain(m.extraInfo || ''))
export function sectionHasContent(s: Section) {
  if (s.excluded) return false
  // section intro/closing text comes from the template, so on its own it does not count as findings
  return s.instances.some((i) => i.items.some(itemHasContent) || i.materials.some(matHasContent))
}

interface Ctx {
  T: Report; S: Report; map: (f: string) => string
  /** source item id → target item id (for new item defs that had to be renamed) */
  itemRemap: Record<string, string>; matRemap: Record<string, string>
  warnings: string[]
  used: Set<string>
}

/** Make sure the target template knows an item the source uses; returns the id to use in the target. */
function ensureItemDef(c: Ctx, srcItemId: string): string {
  if (c.itemRemap[srcItemId]) return c.itemRemap[srcItemId]
  const def = c.S.template.items[srcItemId]
  const have = c.T.template.items[srcItemId]
  let id = srcItemId
  if (!def) { c.itemRemap[srcItemId] = id; return id }
  if (have && norm(have.title) !== norm(def.title)) { let k = 1; while (c.T.template.items[`${srcItemId}-m${k}`]) k++; id = `${srcItemId}-m${k}` }
  if (!c.T.template.items[id]) c.T.template.items[id] = { ...clone(def), id }
  for (const cid of def.commentIds || []) if (!c.T.template.comments[cid] && c.S.template.comments[cid]) c.T.template.comments[cid] = clone(c.S.template.comments[cid])
  c.itemRemap[srcItemId] = id
  return id
}
function ensureMatDef(c: Ctx, srcMatId: string): string {
  if (c.matRemap[srcMatId]) return c.matRemap[srcMatId]
  const def = c.S.template.materials[srcMatId]
  const have = c.T.template.materials[srcMatId]
  let id = srcMatId
  if (!def) { c.matRemap[srcMatId] = id; return id }
  if (have && norm(have.name) !== norm(def.name)) { let k = 1; while (c.T.template.materials[`${srcMatId}-m${k}`]) k++; id = `${srcMatId}-m${k}` }
  if (!c.T.template.materials[id]) c.T.template.materials[id] = { ...clone(def), id }
  c.matRemap[srcMatId] = id
  return id
}

const itemTitleOf = (r: Report, id: string) => r.template.items[id]?.title || ''
const matNameOf = (r: Report, id: string) => r.template.materials[id]?.name || ''
const colsOf = (r: Report, s: Section): RatingColumn[] => s.ratingColumns || r.template.ratingColumns || []

/** Find the target item id for a source item inside a target section (same id, else same title). */
function findItem(c: Ctx, ts: Section, srcId: string): string | null {
  const title = norm(itemTitleOf(c.S, srcId))
  if (ts.itemIds.includes(srcId) && (!title || norm(itemTitleOf(c.T, srcId)) === title)) return srcId
  if (!title) return null
  return ts.itemIds.find((id) => norm(itemTitleOf(c.T, id)) === title) || null
}
function findMat(c: Ctx, ids: string[], srcId: string): string | null {
  const name = norm(matNameOf(c.S, srcId))
  if (ids.includes(srcId) && (!name || norm(matNameOf(c.T, srcId)) === name)) return srcId
  if (!name) return null
  return ids.find((id) => norm(matNameOf(c.T, id)) === name) || null
}

const mapPhotos = (c: Ctx, photos: Photo[]) => (photos || []).map((p) => { c.used.add(p.file); return { ...clone(p), file: c.map(p.file) } })

/** Merge one source item answer into one target item answer. */
function mergeItem(c: Ctx, t: ItemAnswer, s: ItemAnswer, title: string, isNew: boolean): ItemPlan {
  const plan: ItemPlan = { title, newItem: isNew, ratings: [], ratingConflict: false, comments: 0, dupComments: 0, photos: 0, summary: 0, unexclude: false }
  if (t.excluded) { t.excluded = false; plan.unexclude = true }
  const tr = t.ratings || (t.ratings = [])
  const add = (s.ratings || []).filter((x) => !tr.includes(x))
  if (add.length) { if (tr.length) plan.ratingConflict = true; tr.push(...add); plan.ratings = add }
  if (s.flagged) t.flagged = true

  // the target item may only have empty placeholder entries
  if (!t.entries.some(entryHas)) t.entries = []
  for (const se of s.entries || []) {
    if (!entryHas(se)) continue
    const k = key(se.html)
    const same = k ? t.entries.find((te) => key(te.html) === k) : null
    const photos = mapPhotos(c, se.photos)
    if (same) {
      plan.dupComments++
      const have = new Set(same.photos.map((p) => p.file))
      for (const p of photos) if (!have.has(p.file)) { same.photos.push(p); have.add(p.file); plan.photos++ }
      if (se.summary && !same.summary) { same.summary = true; plan.summary++ }
    } else {
      // a photo-only entry whose photos are all already in this item adds nothing
      const inItem = new Set(t.entries.flatMap((e) => e.photos.map((p) => p.file)))
      if (!k && photos.every((p) => inItem.has(p.file))) continue
      t.entries.push({ id: newId(), html: se.html, summary: !!se.summary, photos })
      if (k) plan.comments++
      plan.photos += photos.length
      if (se.summary) plan.summary++
    }
  }
  return plan
}

function emptyItem(itemId: string): ItemAnswer { return { itemId, ratings: [], excluded: false, entries: [] } }
function emptyMat(materialId: string): MaterialAnswer { return { materialId, selected: [], extraInfo: '' } }

/** Merge material answers (S&M or General Info materials). Returns what was added. */
function mergeMats(c: Ctx, targetIds: string[], tAns: MaterialAnswer[], sAns: MaterialAnswer[], addId: (id: string) => void, forEachOtherInstance?: (fn: (m: MaterialAnswer[]) => void) => void) {
  const out: SectionPlan['materials'] = []
  for (const sm of sAns) {
    if (!matHasContent(sm)) continue
    let tid = findMat(c, targetIds, sm.materialId)
    let isNew = false
    if (!tid) {
      tid = ensureMatDef(c, sm.materialId); isNew = true
      addId(tid)
      forEachOtherInstance?.((list) => list.push(emptyMat(tid!)))
    }
    let tm = tAns.find((m) => m.materialId === tid)
    if (!tm) { tm = emptyMat(tid); tAns.push(tm) }
    const added = (sm.selected || []).filter((x) => !(tm!.selected || []).includes(x))
    tm.selected = [...(tm.selected || []), ...added]
    let extra = false
    if (plain(sm.extraInfo || '') && key(sm.extraInfo) !== key(tm.extraInfo || '')) {
      tm.extraInfo = plain(tm.extraInfo || '') ? `${tm.extraInfo}; ${sm.extraInfo}` : sm.extraInfo
      extra = true
    }
    if (tm.excluded && (added.length || extra)) tm.excluded = false
    if (added.length || extra || isNew) out.push({ name: matNameOf(c.T, tid) || matNameOf(c.S, sm.materialId), added, extraInfo: extra, newMaterial: isNew })
  }
  return out
}

/** A new, empty instance shaped like the target section. */
function blankInstance(ts: Section, name: string): Instance {
  return { id: newId(), name, introHtml: '', footerHtml: '', items: ts.itemIds.map(emptyItem), materials: ts.materialIds.map(emptyMat) }
}

function mergeSection(c: Ctx, ts: Section, ss: Section, opts: MergeOptions, plan: SectionPlan) {
  const tCols = colsOf(c.T, ts).map((x) => x.short).join(','), sCols = colsOf(c.S, ss).map((x) => x.short).join(',')
  if (tCols && sCols && tCols !== sCols) c.warnings.push(`${ts.name}: the two reports use different rating columns (${sCols} vs ${tCols}); ratings were copied as-is.`)
  ss.instances.forEach((si, k) => {
    if (!si.items.some(itemHasContent) && !si.materials.some(matHasContent)) return
    let ti = ts.instances.find((x) => norm(x.name) === norm(si.name))
      || (ss.instances.length === 1 && ts.instances.length === 1 ? ts.instances[0] : null)
      || (k === 0 ? ts.instances[0] : null)
    if (!ti) { ti = blankInstance(ts, si.name); ts.instances.push(ti); plan.newInstances.push(si.name) }
    if (!plain(ti.introHtml) && plain(si.introHtml)) ti.introHtml = si.introHtml
    if (!plain(ti.footerHtml) && plain(si.footerHtml)) ti.footerHtml = si.footerHtml
    for (const sit of si.items) {
      if (!itemHasContent(sit)) continue
      let tid = findItem(c, ts, sit.itemId)
      let isNew = false
      if (!tid) {
        tid = ensureItemDef(c, sit.itemId); isNew = true
        ts.itemIds.push(tid)
        for (const inst of ts.instances) if (!inst.items.some((x) => x.itemId === tid)) inst.items.push(emptyItem(tid))
      }
      let tit = ti.items.find((x) => x.itemId === tid)
      if (!tit) { tit = emptyItem(tid); ti.items.push(tit) }
      const ip = mergeItem(c, tit, sit, itemTitleOf(c.T, tid) || itemTitleOf(c.S, sit.itemId), isNew)
      if (ip.newItem || ip.ratings.length || ip.comments || ip.photos || ip.summary || ip.unexclude) plan.items.push(ip)
    }
    if (opts.materials) {
      const added = mergeMats(c, ts.materialIds, ti.materials, si.materials,
        (id) => ts.materialIds.push(id),
        (fn) => ts.instances.filter((x) => x !== ti).forEach((x) => fn(x.materials)))
      plan.materials.push(...added)
    }
  })
  // a section left out of this report comes back in only if something was actually added to it
  if (ts.excluded && (plan.items.length || plan.materials.length || plan.newInstances.length)) { ts.excluded = false; plan.unexclude = true }
}

/** Copy a whole source section in as a new section. */
function addSection(c: Ctx, ss: Section, opts: MergeOptions): Section {
  const ns: Section = clone(ss)
  if (c.T.sections.some((x) => x.id === ns.id)) ns.id = newId()
  // keep the rating columns this section was filled with if the templates differ
  const sCols = colsOf(c.S, ss)
  if (!ns.ratingColumns && sCols.map((x) => x.short).join() !== (c.T.template.ratingColumns || []).map((x) => x.short).join()) ns.ratingColumns = clone(sCols)
  ns.itemIds = ss.itemIds.map((id) => ensureItemDef(c, id))
  ns.materialIds = ss.materialIds.map((id) => ensureMatDef(c, id))
  for (const inst of ns.instances) {
    inst.id = newId()
    for (const it of inst.items) {
      it.itemId = ensureItemDef(c, it.itemId)
      for (const e of it.entries) { e.id = newId(); e.photos = mapPhotos(c, e.photos) }
    }
    for (const m of inst.materials) { m.materialId = ensureMatDef(c, m.materialId); if (!opts.materials) { m.selected = []; m.extraInfo = '' } }
  }
  ns.excluded = false
  // put it after the last section of the same group, or at the end
  let at = -1
  c.T.sections.forEach((x, i) => { if (x.group === ns.group) at = i })
  if (at < 0) c.T.sections.push(ns); else c.T.sections.splice(at + 1, 0, ns)
  return ns
}

/**
 * Merge `source` into a copy of `target`. Returns the merged report and a plan describing what changed.
 * `photoMap` maps source photo file names to their names in the target folder (after copying);
 * leave it out for a preview.
 */
export function mergeReports(target: Report, source: Report, opts: MergeOptions, photoMap?: Record<string, string>): { result: Report; plan: MergePlan } {
  const T = clone(target), S = source
  // in a preview, source photos get a prefix so they never look like the target's own files (both start at i1.jpg)
  const c: Ctx = { T, S, map: (f) => (photoMap ? photoMap[f] ?? f : 'src:' + f), itemRemap: {}, matRemap: {}, warnings: [], used: new Set() }
  const plan: MergePlan = { sections: [], emptySections: 0, generalInfo: { replace: false, materials: 0 }, photosToCopy: [], attachmentsToCopy: [], cover: null, warnings: c.warnings }

  for (const ss of S.sections) {
    if (!sectionHasContent(ss)) { plan.emptySections++; continue }
    const ts = T.sections.find((x) => norm(x.name) === norm(ss.name) && norm(x.group) === norm(ss.group))
      || T.sections.find((x) => norm(x.name) === norm(ss.name))
    const sp: SectionPlan = { srcId: ss.id, group: ss.group, name: ss.name, match: ts ? ts.name : null, newInstances: [], unexclude: false, items: [], materials: [], totals: { items: 0, comments: 0, photos: 0, materials: 0 } }
    const include = opts.sections[ss.id] !== false
    if (include) {
      if (ts) mergeSection(c, ts, ss, opts, sp)
      else {
        addSection(c, ss, opts)
        for (const inst of ss.instances) for (const it of inst.items) if (itemHasContent(it)) {
          const e = it.entries.filter(entryHas)
          sp.items.push({ title: itemTitleOf(S, it.itemId), newItem: false, ratings: it.ratings || [], ratingConflict: false, comments: e.filter((x) => plain(x.html)).length, dupComments: 0, photos: e.reduce((n, x) => n + x.photos.length, 0), summary: e.filter((x) => x.summary).length, unexclude: false })
        }
        if (opts.materials) for (const inst of ss.instances) for (const m of inst.materials) if (matHasContent(m)) sp.materials.push({ name: matNameOf(S, m.materialId), added: m.selected || [], extraInfo: !!plain(m.extraInfo || ''), newMaterial: false })
      }
    } else {
      // still describe it so the list can show what unticking leaves out
      for (const inst of ss.instances) for (const it of inst.items) if (itemHasContent(it)) sp.items.push({ title: itemTitleOf(S, it.itemId), newItem: false, ratings: it.ratings || [], ratingConflict: false, comments: it.entries.filter((x) => plain(x.html)).length, dupComments: 0, photos: it.entries.reduce((n, x) => n + x.photos.length, 0), summary: 0, unexclude: false })
    }
    sp.totals = {
      items: sp.items.length,
      comments: sp.items.reduce((n, x) => n + x.comments, 0),
      photos: sp.items.reduce((n, x) => n + x.photos, 0),
      materials: sp.materials.length,
    }
    plan.sections.push(sp)
  }

  // General Info
  const gi = S.generalInfo || { html: '', materials: [] }
  T.generalInfo ||= { html: '', materials: [] }
  if (plain(gi.html) && (opts.generalInfo === 'replace' || !plain(T.generalInfo.html)) && key(gi.html) !== key(T.generalInfo.html)) {
    T.generalInfo.html = gi.html; plan.generalInfo.replace = true
  }
  if (opts.materials) {
    const ids = T.template.generalInfo.materialIds
    const added = mergeMats(c, ids, T.generalInfo.materials, gi.materials || [], (id) => ids.push(id))
    plan.generalInfo.materials = added.length
  }

  // Cover photo, only when this report has none
  if (opts.cover && !T.coverPhoto && S.coverPhoto) { c.used.add(S.coverPhoto); T.coverPhoto = c.map(S.coverPhoto); if (S.coverLabel && !T.coverLabel) T.coverLabel = S.coverLabel; plan.cover = S.coverPhoto }

  // Customer, services, inspection info — the target keeps its own unless asked
  if (opts.customer) {
    if (S.clients?.some((p) => p.first || p.last)) T.clients = clone(S.clients)
    if (S.people?.length) T.people = clone(S.people)
  }
  if (opts.services) {
    if (S.services?.length) T.services = clone(S.services)
    if (S.invoice) T.invoice = clone(S.invoice)
  }
  if (opts.inspection) {
    const keep = { inspector: T.inspection.inspector, company: T.inspection.company, license: T.inspection.license, inspectorPhone: T.inspection.inspectorPhone }
    T.inspection = { ...clone(S.inspection), ...keep }
  }

  // Attachments (by file name; the main process renames clashes)
  if (opts.attachments) {
    const have = new Set((T.attachments || []).map((a) => norm(a.name)))
    for (const a of S.attachments || []) if (!have.has(norm(a.name))) {
      plan.attachmentsToCopy.push(a.file)
      ;(T.attachments ||= []).push({ ...a, file: photoMap ? (photoMap['att:' + a.file] ?? a.file) : a.file })
    }
  }

  plan.photosToCopy = [...c.used]
  T.updated = new Date().toISOString()
  return { result: T, plan }
}

export function defaultOptions(source: Report): MergeOptions {
  const sections: Record<string, boolean> = {}
  for (const s of source.sections) sections[s.id] = true
  return { sections, materials: true, generalInfo: 'keep', customer: false, services: false, inspection: false, cover: true, attachments: true }
}
