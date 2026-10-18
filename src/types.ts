export interface RatingColumn {
  short: string; label: string; sendsToSummary: boolean; removesFromSummary: boolean
  isExclude: boolean; visible: boolean; color: string | null
}
export interface Comment { id: string; name: string; html: string; text: string; smart: boolean; auto: boolean; defaultPhotos: { path: string; caption: string }[] }
export interface LibFolder { name: string; commentIds: string[]; children: LibFolder[] }
export interface Item { id: string; title: string; helpHtml: string; commentIds: string[] }
export interface Material { id: string; name: string; options: string[]; extraInfoLabel: string | null }

export interface TemplateLib {
  format: string; name: string; source?: string
  ratingColumns: RatingColumn[]; costRanges: string[]
  smartFields: Record<string, string[]>
  comments: Record<string, Comment>; commentLibrary: LibFolder[]
  items: Record<string, Item>; materials: Record<string, Material>
  generalInfo: { commentIds: string[]; materialIds: string[] }
}
export interface TemplateSection {
  group: string; name: string; excludedByDefault: boolean; repeatNames: string[]
  introCommentIds: string[]; footerCommentIds: string[]; itemIds: string[]; materialIds: string[]
  ratingColumns: RatingColumn[] | null
}
export interface TemplateFile extends TemplateLib { sections: TemplateSection[] }

/** placeholder = an empty, labeled photo slot (from a HomeGauge fill/template) waiting for a real photo; file is '' */
export interface Photo { file: string; caption: string; src?: string; size?: 's' | 'm' | 'l' | 'xl'; edit?: unknown; placeholder?: boolean }
export interface Entry { id: string; html: string; summary: boolean; photos: Photo[] }
export interface ItemAnswer { itemId: string; ratings: string[]; excluded: boolean; entries: Entry[]; flagged?: boolean; originalRatings?: string[] }
export interface MaterialAnswer { materialId: string; selected: string[]; extraInfo: string; excluded?: boolean }
export interface Instance { id: string; name: string; introHtml: string; footerHtml: string; items: ItemAnswer[]; materials: MaterialAnswer[] }
export interface Section {
  id: string; group: string; name: string; excluded: boolean; repeatNames: string[]
  ratingColumns: RatingColumn[] | null; itemIds: string[]; materialIds: string[]
  introCommentIds: string[]; footerCommentIds: string[]; instances: Instance[]
}
export interface Person {
  first: string; last: string; company?: string; email?: string; phone?: string; role?: string; id?: string
  workPhone?: string; homePhone?: string; address?: string; address2?: string; city?: string; state?: string; zip?: string
}
export interface Contact extends Person { id: string; type: 'Rep' | 'Customer'; note?: string }
export interface Attachment { file: string; name: string; include: boolean }
export interface Settings {
  company: { name: string; phone: string; email: string; website: string }
  inspector: { name: string; company: string; phone: string; license: string; email: string }
  services: { name: string; priceCents: number }[]
  lists: { payMethods: string[]; payStatus: string[]; payNotes: string[]; leadSources: string[] }
  photos: { workingEdge: number; uploadEdge: number }
}
export interface Report {
  format: string; id: string; created: string; updated: string; reportNumber: string
  inspection: { date: string; start: string; end: string; address: string; city: string; state: string; zip: string; inspector: string; company: string; license: string; notes: string; address2?: string; county?: string; country?: string; mls?: string; inspectorPhone?: string }
  clients: Person[]; people: Person[]
  services: { name: string; selected: boolean; priceCents: number; qty: number }[]
  generalInfo: { html: string; materials: MaterialAnswer[] }
  template: TemplateLib
  sections: Section[]
  photoFolder: string
  coverPhoto?: string
  coverLabel?: string
  misc?: { leadSource?: string; mileage?: string; directions?: string }
  attachments?: Attachment[]
  invoice?: { taxCents: number; method: string; status: string; note: string }
  uploadCompressed?: number
  published?: string
  reinspectionOf?: string
  draft?: boolean
}
export interface ReportRow {
  id: string; date: string; client: string; address: string; city: string; zip: string; reportNumber: string; agent: string
  template: string; inspector: string; updated: string; published: string; paid: string; reinspection: string
  coverPhoto: string; dir: string; importedFrom?: string
  details: { clientName: string; company: string; start: string; end: string; inspAddress: string; billing: string
    workPhone: string; homePhone: string; mobile: string; email: string; mls: string; reps: string[]; reinspectionOf: string }
}
export interface FillInfo {
  name: string; date: string; template: string; from: string; source: string; version: 1 | 2
  counts: { sections: number; items: number; comments: number; photos: number; materials: number } | null
}
export interface BackupInfo { file: string; time: string; size: number }

export interface Dirs { root: string; templates: string; reports: string; library: string }
export interface Api {
  dirs(): Promise<Dirs>
  listTemplates(): Promise<string[]>
  loadTemplate(name: string): Promise<TemplateFile>
  saveTemplate(name: string, t: TemplateFile): Promise<void>
  listReports(force?: boolean): Promise<ReportRow[]>
  copyReport(id: string): Promise<string>
  mergeFiles(fromId: string, toId: string, photos: string[], attachments: string[], dryRun?: boolean): Promise<{ map: Record<string, string>; copied: number; same: number; missing: number }>
  createReinspection(id: string): Promise<{ id: string; kept: number }>
  listBackups(id: string): Promise<BackupInfo[]>
  restoreBackup(id: string, file: string): Promise<void>
  openReportFolder(id: string): Promise<string>
  newDraft(): Promise<Report>
  createFromDraft(template: string, draft: Report): Promise<string>
  templateInfo(): Promise<{ name: string; sections: number; comments: number; source: string; folder: string; updated: string }[]>
  hgTemplates(): Promise<{ path: string; name: string; folder: string; updated: string; size: number }[]>
  importTemplateFiles(paths: string[]): Promise<string[]>
  importHgSettings(): Promise<null | { services: number; payMethods: number; payStatus: number; payNotes: number; inspector: string }>
  loadReport(id: string): Promise<Report>
  saveReport(r: Report): Promise<string>
  reportDir(id: string): Promise<string>
  createReport(template: string, info: Record<string, string>): Promise<string>
  deleteReport(id: string): Promise<void>
  importTemplate(): Promise<string[]>
  importReports(mode: 'folder' | 'zip'): Promise<{ done: string[]; failed: string[]; skipped: number }>
  onProgress(cb: (msg: string) => void): () => void
  onMenu(cb: (cmd: string) => void): () => void
  pickFolder(title?: string, defaultPath?: string): Promise<string | null>
  pickFiles(title?: string): Promise<string[]>
  listImages(folder: string, recursive: boolean): Promise<{ path: string; name: string; folder: string }[]>
  addPhoto(reportId: string, bytes: ArrayBuffer, ext: string, original?: ArrayBuffer): Promise<string>
  savePhoto(reportId: string, file: string, bytes: ArrayBuffer): Promise<string>
  originalOf(reportId: string, file: string): Promise<string>
  importLibrary(): Promise<number>
  addToLibrary(paths: string[], sub?: string): Promise<void>
  openDataFolder(): Promise<void>
  printToPdf(html: string, name: string, hf?: { header: string; footer: string }, attach?: { reportId: string; files: string[] }): Promise<string | null>
  branding(): Promise<import('./preview').Branding>
  saveBranding(company: import('./preview').Branding['company']): Promise<import('./preview').Branding>
  pickLogo(): Promise<import('./preview').Branding>
  getSettings(): Promise<Settings>
  saveSettings(s: Settings): Promise<Settings>
  contacts(): Promise<Contact[]>
  saveContact(c: Contact): Promise<Contact[]>
  importContacts(): Promise<number>
  openExternal(url: string): Promise<void>
  addAttachments(reportId: string): Promise<Attachment[]>
  openAttachment(reportId: string, file: string): Promise<void>
  compressForUpload(reportId: string, maxEdge: number): Promise<{ changed: number; before: number; after: number }>
  listFills(): Promise<FillInfo[]>
  loadFill(name: string): Promise<any>
  saveFill(name: string, fromReportId: string, data: any): Promise<string>
  deleteFill(name: string): Promise<void>
  renameFill(oldName: string, newName: string): Promise<string>
  hgFills(): Promise<{ path: string; name: string; updated: string }[]>
  importHgFills(paths: string[]): Promise<{ name: string; photos?: number; missing?: number; error?: string }[]>
  deleteContact(id: string): Promise<Contact[]>
  exportContacts(): Promise<string | null>
  exportReportInfo(): Promise<string | null>
  exportComments(comments: Record<string, Comment>, folderOf: Record<string, string>): Promise<string | null>
  importCommentsCsv(): Promise<{ id: string; name: string; folder: string; html: string }[] | null>
  dataSizes(reportId: string): Promise<Record<'photos' | 'originals' | 'attachments' | 'data', { n: number; c: number }>>
  photoLocker(reportId: string): Promise<void>
  misspelled(words: string[]): string[]
  platform: string
}
declare global { interface Window { api: Api } }
