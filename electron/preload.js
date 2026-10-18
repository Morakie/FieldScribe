const { contextBridge, ipcRenderer, webFrame } = require('electron')

const names = [
  'dirs', 'listTemplates', 'loadTemplate', 'saveTemplate', 'listReports', 'loadReport', 'saveReport', 'reportDir',
  'createReport', 'deleteReport', 'importTemplate', 'importReports', 'pickFolder', 'pickFiles', 'listImages',
  'addPhoto', 'savePhoto', 'originalOf', 'importLibrary', 'addToLibrary', 'openDataFolder', 'printToPdf',
  'branding', 'saveBranding', 'pickLogo', 'getSettings', 'saveSettings', 'contacts', 'saveContact', 'importContacts',
  'openExternal', 'addAttachments', 'openAttachment', 'compressForUpload',
  'listFills', 'loadFill', 'saveFill', 'deleteFill', 'deleteContact', 'exportContacts', 'exportReportInfo', 'exportComments', 'importCommentsCsv', 'dataSizes', 'photoLocker',
  'copyReport', 'createReinspection', 'mergeFiles', 'listBackups', 'restoreBackup', 'openReportFolder',
  'newDraft', 'createFromDraft', 'templateInfo', 'hgTemplates', 'importTemplateFiles', 'importHgSettings',
]
const api = {}
for (const n of names) api[n] = (...args) => ipcRenderer.invoke(n, ...args)
api.platform = process.platform
// spell check words using the same dictionary as the red underlines
api.misspelled = (words) => words.filter((w) => webFrame.isWordMisspelled(w))
api.onProgress = (cb) => { const f = (_e, m) => cb(m); ipcRenderer.on('progress', f); return () => ipcRenderer.off('progress', f) }
api.onMenu = (cb) => { const f = (_e, m) => cb(m); ipcRenderer.on('menu', f); return () => ipcRenderer.off('menu', f) }
contextBridge.exposeInMainWorld('api', api)
