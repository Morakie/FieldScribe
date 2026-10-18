import type { Report, ItemAnswer, Entry, Photo } from './types'
import { api, imgUrl, newEntry, photoSettings, prefs, resizeForReport } from './util'

export const DRAG_TYPE = 'application/x-bridge-photo'
export interface DraggedPhoto { path: string; caption?: string }

/** Copy a photo from disk into the report (resized), returning the stored file name. */
export async function importPhoto(reportId: string, srcPath: string): Promise<string> {
  const { report, original } = await resizeForReport(imgUrl(srcPath))
  return api.addPhoto(reportId, report, '.jpg', original)
}

/** Attach photos to an item; creates an entry if the item has none. */
export async function attachPhotos(
  r: Report, mutate: (fn: (r: Report) => void) => void,
  item: ItemAnswer, entryIdx: number, photos: DraggedPhoto[],
) {
  const files: Photo[] = []
  const size = photoSettings().reportSize
  for (const p of photos) files.push({ file: await importPhoto(r.id, p.path), caption: p.caption || '', src: p.path, size })
  mutate(() => {
    let e: Entry | undefined = item.entries[entryIdx] || item.entries[item.entries.length - 1]
    if (!e) { e = newEntry(); item.entries.push(e) }
    e.photos.push(...files)
  })
  // open the photo editor on a single newly added photo (Options → Photo Settings can turn this off)
  if (files.length === 1 && prefs.get('autoEditPhoto', '1') === '1') {
    setTimeout(() => window.dispatchEvent(new CustomEvent('bridge-edit-photo', { detail: files[0].file })), 60)
  }
}

export function readDrag(ev: React.DragEvent): DraggedPhoto[] | null {
  const raw = ev.dataTransfer.getData(DRAG_TYPE)
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}

export function usedSources(r: Report): Set<string> {
  const s = new Set<string>()
  for (const sec of r.sections) for (const inst of sec.instances) for (const it of inst.items) for (const e of it.entries) for (const p of e.photos) if (p.src) s.add(p.src)
  return s
}
