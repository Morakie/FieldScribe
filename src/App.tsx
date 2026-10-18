import { useEffect, useRef, useState } from 'react'
import ReportsList from './components/ReportsList'
import StartPage from './components/StartPage'
import Editor from './components/Editor'
import { api } from './util'
import CompanySettings from './components/CompanySettings'
import PhotoSettingsModal from './components/PhotoSettings'
import InspectorProfile from './components/InspectorProfile'
import ContactsManager from './components/ContactsManager'
import { HgFillsImport } from './components/FillsModal'

const HOME_CMDS = ['importReports', 'importZip', 'importTemplate']
type Mode = { page: 'start'; pane?: 'customer' } | { page: 'list' }

/** Menu commands arrive from the window menu and are re-broadcast as a 'bridge-menu' event. */
export default function App() {
  const [openId, setOpenId] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>({ page: 'start' })
  const [startKey, setStartKey] = useState(0)
  const afterClose = useRef<Mode | null>(null)
  /** go to the start page or the reports list, closing (and saving) an open report first */
  const goTo = (m: Mode) => {
    if (m.page === 'start') setStartKey((k) => k + 1)
    if (openId) { afterClose.current = m; window.dispatchEvent(new CustomEvent('bridge-menu', { detail: 'close' })) } else setMode(m)
  }
  const pending = useRef<string | null>(null)
  const [settings, setSettings] = useState(false)
  const [photoSet, setPhotoSet] = useState(false)
  const [inspector, setInspector] = useState(false)
  const [contacts, setContacts] = useState(false)
  const [hgFills, setHgFills] = useState(false)
  useEffect(() => api.onMenu((cmd) => {
    if (cmd === 'companySettings') return setSettings(true)
    if (cmd === 'themeDark' || cmd === 'themeLight') {
      const t = cmd === 'themeDark' ? 'dark' : 'light'
      document.documentElement.dataset.theme = t
      try { localStorage.setItem('theme', t) } catch {}
      return
    }
    if (cmd === 'photoSettings') return setPhotoSet(true)
    if (cmd === 'importContacts') { api.importContacts().then((n) => n && alert(`Added ${n} new contact(s).`)); return }
    if (cmd === 'inspectorProfile') return setInspector(true)
    if (cmd === 'contacts') return setContacts(true)
    if (cmd === 'importHgFills') return setHgFills(true)
    if (cmd === 'exportContacts') { api.exportContacts(); return }
    if (cmd === 'exportReportInfo') { api.exportReportInfo(); return }
    if (cmd === 'mergeInto' && !openId) return alert('Open the report you want to merge INTO first (for example the office\'s prefilled report), then choose File → Merge Report Into This Report.')
    if (cmd === 'new') return goTo({ page: 'start', pane: 'customer' })
    if (cmd === 'home') return goTo({ page: 'start' })
    if (cmd === 'openList') return goTo({ page: 'list' })
    if (cmd === 'importHgSettings') {
      if (!confirm('Re-read the price list, payment lists and inspector name/license from HomeGauge?\n\nThis replaces those lists in Bridge Report with what HomeGauge has now.')) return
      api.importHgSettings().then((n) => alert(n ? `Imported from HomeGauge:\n${n.services} prices, ${n.payMethods} payment methods, ${n.payStatus} payment statuses, ${n.payNotes} payment notes\nInspector: ${n.inspector || '(not set)'}` : 'HomeGauge was not found on this PC.'))
      return
    }
    if (HOME_CMDS.includes(cmd) && (openId || mode.page !== 'list')) { pending.current = cmd; goTo({ page: 'list' }); return }
    window.dispatchEvent(new CustomEvent('bridge-menu', { detail: cmd }))
  }), [openId, mode])
  useEffect(() => {
    if (!openId && mode.page === 'list' && pending.current) {
      const cmd = pending.current; pending.current = null
      setTimeout(() => window.dispatchEvent(new CustomEvent('bridge-menu', { detail: cmd })), 50)
    }
  }, [openId, mode])
  const closeEditor = () => { setOpenId(null); setMode(afterClose.current || { page: 'list' }); afterClose.current = null }
  return <>
    {openId ? <Editor reportId={openId} onClose={closeEditor} />
      : mode.page === 'start' ? <StartPage key={startKey} startPane={mode.pane} onOpen={setOpenId} onOpenList={() => setMode({ page: 'list' })} />
      : <ReportsList onOpen={setOpenId} onNew={() => goTo({ page: 'start', pane: 'customer' })} onHome={() => goTo({ page: 'start' })} />}
    {settings && <CompanySettings onClose={() => setSettings(false)} />}
    {photoSet && <PhotoSettingsModal onClose={() => setPhotoSet(false)} />}
    {inspector && <InspectorProfile onClose={() => setInspector(false)} />}
    {contacts && <ContactsManager onClose={() => setContacts(false)} />}
    {hgFills && <HgFillsImport have={[]} onClose={() => setHgFills(false)} />}
  </>
}
