/**
 * Report Fills — saved starting answers (ratings, comments, photos, Styles & Materials) taken from a report
 * and stamped onto another one. Applying a fill uses the same engine as Merge Report, so sections and items
 * are matched by name even when the fill was made with a different template, and nothing is duplicated.
 *
 * Fill file (v2): { version: 2, name, date, template, from, counts, report: { sections, generalInfo, template, coverPhoto } }
 * plus the photos it uses, in BridgeReport Data\Fills\<name>\.
 * Old v1 fills (Fills\<name>.json, no photos) are still applied with the old code.
 */
import type { Report } from './types'
import { mergeReports, itemHasContent, type MergeOptions, type MergePlan } from './merge'
import { api, uid } from './util'

export type FillMode = 'add' | 'blanks' | 'replace'
export const FILL_MODES: [FillMode, string, string][] = [
  ['add', 'Add to what is already in this report', 'Ratings and S&M picks are combined; comments already here are not repeated.'],
  ['blanks', 'Only fill items that are still empty', 'Anything you already answered is left alone.'],
  ['replace', "Replace this report's answers with the fill's", 'Items and S&M the fill has answers for are cleared first.'],
]

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))

/** Build the data saved for a fill from a report. Customer, agent, price and appointment are never saved. */
/**
 * `pick` = the section ids to save (HomeGauge's "Select Sections To Save"); `general` = save General Info too.
 * Leave `pick` out to save every section.
 */
export function fillFromReport(r: Report, withPhotos: boolean, pick?: Set<string>, general = true) {
  const sections = clone(r.sections.filter((s) => !pick || pick.has(s.id)))
  const photos = new Set<string>()
  let items = 0, comments = 0, photoN = 0, materials = 0
  for (const s of sections) for (const inst of s.instances) {
    for (const it of inst.items) {
      if (!withPhotos) for (const e of it.entries) e.photos = []
      if (itemHasContent(it)) items++
      for (const e of it.entries) { if (e.html.replace(/<[^>]+>/g, '').trim()) comments++; for (const p of e.photos) if (!p.placeholder && p.file) { photos.add(p.file); photoN++ } }
    }
    for (const m of inst.materials) if (m.selected.length) materials++
  }
  const coverPhoto = withPhotos && r.coverPhoto ? r.coverPhoto : undefined
  if (coverPhoto) photos.add(coverPhoto)
  return {
    template: r.template.name,
    from: r.reportNumber || r.inspection.address || '',
    counts: { sections: sections.length, items, comments, photos: photoN, materials },
    report: { sections, generalInfo: general ? clone(r.generalInfo) : { html: '', materials: [] }, template: r.template, coverPhoto, coverLabel: r.coverLabel },
    selected: [...(general ? ['General'] : []), ...sections.map((s) => s.name)],
    photos: [...photos],
  }
}

/** A v2 fill as a report-shaped object the merge engine can read. */
export function fillAsReport(name: string, f: any, general = true): Report {
  return {
    format: 'bridge-report/v1', id: 'fill:' + name, created: f.date || '', updated: f.date || '', reportNumber: name,
    inspection: { date: '', start: '', end: '', address: '', city: '', state: '', zip: '', inspector: '', company: '', license: '', notes: '' },
    clients: [], people: [], services: [], attachments: [],
    generalInfo: general && f.report.generalInfo ? f.report.generalInfo : { html: '', materials: [] },
    template: f.report.template, sections: f.report.sections || [], photoFolder: '',
    coverPhoto: f.report.coverPhoto, coverLabel: f.report.coverLabel,
  } as Report
}

/** `only` = the fill's section ids to apply (all when left out); `general` = apply its General Info. */
export function fillOptions(src: Report, mode: FillMode, only?: Set<string>, general = true): MergeOptions {
  const sections: Record<string, boolean> = {}
  for (const s of src.sections) sections[s.id] = !only || only.has(s.id)
  return { sections, materials: true, generalInfo: mode === 'replace' && general ? 'replace' : 'keep', customer: false, services: false, inspection: false, cover: true, attachments: false, mode }
}

/** Photo files a fill would bring in (for a dry run that finds the ones already in the report). */
export function fillPhotos(r: Report, name: string, f: any): string[] {
  if (f?.version !== 2) return []
  const src = fillAsReport(name, f)
  return mergeReports(r, src, fillOptions(src, 'add')).plan.photosToCopy
}

/** What applying this fill would do (for the info box), without changing anything. */
export function previewFill(r: Report, name: string, f: any, mode: FillMode, only?: Set<string>, general = true, photoMap?: Record<string, string>): MergePlan | null {
  if (f?.version !== 2) return null
  const src = fillAsReport(name, f, general)
  return mergeReports(r, src, fillOptions(src, mode, only, general), photoMap).plan
}

/**
 * Apply a fill to the open report. `flush` saves the report first (the main process backs it up before
 * copying photos), `mutate` changes the open report. Returns a one-line summary.
 */
export async function applyFillTo(r: Report, name: string, mode: FillMode, flush: () => any, mutate: (fn: (r: Report) => void) => void, only?: Set<string>, general = true): Promise<string> {
  const f = await api.loadFill(name)
  if (f?.version !== 2) {
    let n = 0
    mutate((rr) => { n = applyLegacyFill(rr, f, mode !== 'blanks') })
    return `Applied "${name}" — ${n} item(s) / list(s) filled.`
  }
  const src = fillAsReport(name, f, general)
  const opts = fillOptions(src, mode, only, general)
  const plan = mergeReports(r, src, opts).plan
  await flush()
  const files = await api.mergeFiles(src.id, r.id, plan.photosToCopy, [], false)
  let res = plan
  mutate((cur) => {
    const out = mergeReports(cur, src, opts, files.map)
    res = out.plan
    for (const k of Object.keys(out.result) as (keyof Report)[]) (cur as any)[k] = out.result[k]
  })
  await flush()
  const inc = res.sections.filter((s) => s.included)
  const items = inc.reduce((n, s) => n + s.totals.items, 0)
  const comments = inc.reduce((n, s) => n + s.totals.comments, 0)
  const mats = inc.reduce((n, s) => n + s.totals.materials, 0) + res.generalInfo.materials
  const added = inc.filter((s) => s.match == null).length
  return `Applied "${name}": ${items} item(s), ${comments} comment(s), ${files.copied} photo(s), ${mats} S&M list(s)` +
    (added ? `, ${added} new section(s)` : '') + (files.same ? ` (${files.same} photo(s) were already here)` : '') + '.'
}

// ---------- old (v1) fills: no photos, keyed by "group/section" ----------
function applyLegacyFill(r: Report, f: any, overwrite: boolean) {
  let n = 0
  for (const s of r.sections) {
    const fs = f.sections?.[`${s.group}/${s.name}`]
    if (!fs) continue
    s.instances.forEach((inst, k) => {
      const fi = fs[k] || fs[0]
      if (!fi) return
      for (const it of inst.items) {
        const src = fi.items[it.itemId]
        if (!src || (!src.ratings.length && !src.entries.length)) continue
        if (!overwrite && (it.ratings.length || it.entries.length)) continue
        it.ratings = [...src.ratings]; it.excluded = src.excluded
        it.entries = src.entries.map((e: any) => ({ id: uid(), html: e.html, summary: e.summary, photos: [] })); n++
      }
      for (const m of inst.materials) {
        const src = fi.materials[m.materialId]
        if (!src || (!overwrite && m.selected.length)) continue
        m.selected = [...src.selected]; m.extraInfo = src.extraInfo; m.excluded = src.excluded; n++
      }
    })
  }
  for (const m of r.generalInfo.materials) {
    const src = f.general?.[m.materialId]
    if (!src || (!overwrite && m.selected.length)) continue
    m.selected = [...src.selected]; m.extraInfo = src.extraInfo; m.excluded = src.excluded; n++
  }
  return n
}
