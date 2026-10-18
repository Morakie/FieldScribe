import type { Report, Section, Instance, RatingColumn, Entry } from './types'

export const api = window.api
export const imgUrl = (p: string) => `brimg://f/?p=${encodeURIComponent(p)}`
export const thumbUrl = (p: string, s = 240) => `brthumb://t/?p=${encodeURIComponent(p)}&s=${s}`
export const joinPath = (dir: string, f: string) => dir + (dir.includes('\\') ? '\\' : '/') + f
export const uid = () => crypto.randomUUID()

export const htmlToText = (s: string) => {
  const d = document.createElement('div')
  d.innerHTML = s || ''
  return (d.innerText || d.textContent || '').trim()
}
export const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export const SMART_RE = /\*([A-Z]+)\(([^)]*)\)\*/g
export const smartKeys = (html: string) => [...htmlToText(html).matchAll(SMART_RE)].map((m) => `${m[1]}(${m[2]})`)

export const colsFor = (r: Report, s: Section): RatingColumn[] => s.ratingColumns || r.template.ratingColumns

export const itemTitle = (r: Report, id: string) => r.template.items[id]?.title ?? '(missing item)'

export function sectionNumber(r: Report, s: Section): string {
  const inGroup = r.sections.filter((x) => x.group === s.group)
  if (s.excluded) return 'X'
  return String(inGroup.filter((x) => !x.excluded).indexOf(s) + 1)
}

export function instanceProgress(inst: Instance) {
  const total = inst.items.filter((i) => !i.excluded).length
  const done = inst.items.filter((i) => !i.excluded && i.ratings.length > 0).length
  return { done, total }
}

export const newEntry = (html = ''): Entry => ({ id: uid(), html, summary: false, photos: [] })

export type ReportPhotoSize = 's' | 'm' | 'l' | 'xl'
export interface PhotoSettings { reportSize: ReportPhotoSize }
export const UPLOAD_EDGES: [number, string][] = [[400, '400px (smallest)'], [640, '640px (same as HomeGauge)'], [800, '800px'], [1024, '1024px'], [1600, '1600px (largest)']]
export const WORKING_EDGES: [number, string][] = [[1600, '1600px'], [2400, '2400px (recommended)'], [4000, 'Full size (largest files)']]
/** Photos are kept at this size while working; set from Options → Photo Settings. */
export const workingEdge = () => { try { return Number(localStorage.getItem('workingEdge')) || 2400 } catch { return 2400 } }
export const REPORT_SIZES: [ReportPhotoSize, string][] = [['s', 'Small'], ['m', 'Medium'], ['l', 'Large'], ['xl', 'X-Large']]
export function photoSettings(): PhotoSettings {
  try { return { reportSize: 'm', ...JSON.parse(localStorage.getItem('photoSettings') || '{}') } } catch { return { reportSize: 'm' } }
}
export function savePhotoSettings(p: PhotoSettings) { try { localStorage.setItem('photoSettings', JSON.stringify(p)) } catch {} }

const toJpeg = (c: HTMLCanvasElement, q = 0.86): Promise<ArrayBuffer> => new Promise((res) => c.toBlob((b) => res(b!.arrayBuffer()), 'image/jpeg', q))
export function scaledCanvas(src: CanvasImageSource & { width: number; height: number }, maxEdge: number) {
  const k = Math.min(1, maxEdge / Math.max(src.width, src.height))
  const c = document.createElement('canvas')
  c.width = Math.round(src.width * k); c.height = Math.round(src.height * k)
  c.getContext('2d')!.drawImage(src, 0, 0, c.width, c.height)
  return c
}
/**
 * Load a photo (fixing phone EXIF rotation) at the high working resolution. Photos stay high-res in the
 * report until it is uploaded, when they are compressed once (see Report → Compress Photos for Upload).
 */
export async function resizeForReport(src: string, maxEdge = workingEdge()): Promise<{ report: ArrayBuffer; original: ArrayBuffer }> {
  const blob = await (await fetch(src)).blob()
  const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' })
  const bytes = await toJpeg(scaledCanvas(bmp, maxEdge), 0.9)
  return { report: bytes, original: bytes }
}
export { toJpeg }

export function debounce<T extends (...a: any[]) => void>(fn: T, ms: number) {
  let t: any
  const d = (...a: any[]) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms) }
  d.flush = () => { clearTimeout(t); return fn() }
  return d as T & { flush: () => any }
}

/** Where the photo-folder picker starts: the user's chosen default, else the parent of the last folder picked. */
export const prefs = {
  get: (k: string, d = '') => { try { return localStorage.getItem('pref:' + k) ?? d } catch { return d } },
  set: (k: string, v: string) => { try { localStorage.setItem('pref:' + k, v) } catch {} },
}
export const parentDir = (p: string) => p.replace(/[\\/][^\\/]+[\\/]?$/, '')
