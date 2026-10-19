import { useEffect, useMemo, useState } from 'react'
import { useEditor, currentSection } from './Editor'
import { api, parentDir, prefs, thumbUrl } from '../util'
import { DRAG_TYPE, attachPhotos, usedSources } from '../photoOps'

type Img = { path: string; name: string; folder: string }

/** Right-hand photo panel: job photo folder + Drawings/CYA library. Drag onto an item, or double-click to add. */
export default function PhotoPanel() {
  const { r, mutate, sel, version } = useEditor()
  const [tab, setTab] = useState<'pics' | 'lib'>('pics')
  const [imgs, setImgs] = useState<Img[]>([])
  const [lib, setLib] = useState<Img[]>([])
  const [libDir, setLibDir] = useState('')
  const remembered = (k: string) => { try { return localStorage.getItem(k) === '1' } catch { return false } }
  const remember = (k: string, v: boolean) => { try { localStorage.setItem(k, v ? '1' : '0') } catch {} }
  const [sub, setSubState] = useState(() => remembered('photoSubfolders'))
  const [hideUsed, setHideUsedState] = useState(() => remembered('photoHideUsed'))
  const setSub = (v: boolean) => { setSubState(v); remember('photoSubfolders', v) }
  const setHideUsed = (v: boolean) => { setHideUsedState(v); remember('photoHideUsed', v) }
  const [picked, setPicked] = useState<string[]>([])
  const [busy, setBusy] = useState('')
  // thumbnail size, Subfolders and Hide used are remembered between reports and launches
  const [size, setSizeState] = useState(() => { try { return Number(localStorage.getItem('thumbSize')) || 150 } catch { return 150 } })
  const setSize = (v: number) => { setSizeState(v); try { localStorage.setItem('thumbSize', String(v)) } catch {} }

  const used = useMemo(() => usedSources(r), [r, version])
  const refresh = async () => { if (r.photoFolder) setImgs(await api.listImages(r.photoFolder, sub)) }
  const refreshLib = async () => { const d = await api.dirs(); setLibDir(d.library); setLib(await api.listImages(d.library, true)) }
  useEffect(() => { refresh() }, [r.photoFolder, sub])
  useEffect(() => { const f = (e: Event) => setTab((e as CustomEvent).detail); window.addEventListener('bridge-photo-tab', f); return () => window.removeEventListener('bridge-photo-tab', f) }, [])
  useEffect(() => { if (tab === 'lib') refreshLib() }, [tab])

  async function chooseFolder() {
    const start = prefs.get('photoRoot') || (r.photoFolder ? parentDir(r.photoFolder) : '') || prefs.get('lastPhotoRoot')
    const f = await api.pickFolder('Choose the photo folder for this inspection', start || undefined)
    if (f) { prefs.set('lastPhotoRoot', parentDir(f)); mutate(() => { r.photoFolder = f }) }
  }
  const list = tab === 'pics' ? imgs.filter((i) => !hideUsed || !used.has(i.path)) : lib
  const cur = currentSection(r, sel)

  async function addToCurrent(paths: string[]) {
    if (!cur || sel.kind !== 'section') return alert('Select an inspection item first, then add photos.')
    const item = cur.instance.items[sel.itemIdx]
    if (!item) return
    setBusy(`Adding ${paths.length} photo(s)…`)
    try {
      const caption = (p: string) => (tab === 'lib' ? p.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ') : '')
      await attachPhotos(r, mutate, item, sel.entryIdx, paths.map((p) => ({ path: p, caption: caption(p) })))
    } finally { setBusy(''); setPicked([]) }
  }

  return (
    <aside className="photos">
      <div className="ptabs">
        <button className={tab === 'pics' ? 'on' : ''} onClick={() => setTab('pics')}>1 · Pictures</button>
        <button className={tab === 'lib' ? 'on' : ''} onClick={() => setTab('lib')}>2 · Drawings / CYA</button>
      </div>
      {tab === 'pics' ? (
        <div className="pbar">
          <button onClick={chooseFolder} title="Choose this job's photo folder">📂 Folder</button>
          <button onClick={refresh} title="Refresh">⟳</button>
          <label title="Include sub folders"><input type="checkbox" checked={sub} onChange={(e) => setSub(e.target.checked)} /> Subfolders</label>
          <label title="Hide photos already used in the report"><input type="checkbox" checked={hideUsed} onChange={(e) => setHideUsed(e.target.checked)} /> Hide used</label>
        </div>
      ) : (
        <div className="pbar">
          <button onClick={async () => { setBusy('Importing…'); const n = await api.importLibrary(); setBusy(''); if (n) refreshLib() }} title="Copy a folder of illustrations in, e.g. HomeGauge\Drawings">⤓ Import folder</button>
          <button onClick={async () => { const f = await api.pickFiles('Add illustrations'); if (f.length) { await api.addToLibrary(f); refreshLib() } }}>＋ Add files</button>
          <button onClick={refreshLib}>⟳</button>
        </div>
      )}
      <div className="pinfo">
        {tab === 'pics'
          ? r.photoFolder ? <><div className="path" title={r.photoFolder}>{r.photoFolder.length > 48 ? '…' + r.photoFolder.slice(-47) : r.photoFolder}</div><div>{imgs.length} photos · {imgs.filter((i) => used.has(i.path)).length} used</div></> : <div>No folder chosen yet. Click 📂 Folder.</div>
          : <div>{lib.length} illustrations in the shared library</div>}
        {busy && <div className="busy">{busy}</div>}
        <div className="row">
          <input type="range" min={90} max={300} value={size} onChange={(e) => setSize(+e.target.value)} title="Thumbnail size" />
          {picked.length > 0 && <button className="primary" onClick={() => addToCurrent(picked)}>Add {picked.length} to item</button>}
        </div>
      </div>
      <div className="thumbs" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${size}px, 1fr))` }}>
        {list.map((im, k) => {
          const isUsed = tab === 'pics' && used.has(im.path)
          const isPicked = picked.includes(im.path)
          const showFolder = (tab === 'lib' || sub) && im.folder && (k === 0 || list[k - 1].folder !== im.folder)
          return (
            <div key={im.path} style={{ display: 'contents' }}>
              {showFolder && <div className="tfolder">{im.folder.replace(/^[^\\/]+[\\/]?/, (m) => (tab === 'lib' ? '' : m)) || im.folder}</div>}
              <div className={'thumb' + (isUsed ? ' used' : '') + (isPicked ? ' picked' : '')} draggable
                onDragStart={(e) => {
                  const paths = isPicked ? picked : [im.path]
                  e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(paths.map((p) => ({ path: p, caption: tab === 'lib' ? p.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ') : '' }))))
                  e.dataTransfer.effectAllowed = 'copy'
                }}
                onClick={(e) => setPicked(e.ctrlKey || e.shiftKey ? (isPicked ? picked.filter((p) => p !== im.path) : [...picked, im.path]) : isPicked && picked.length === 1 ? [] : [im.path])}
                onDoubleClick={() => addToCurrent([im.path])}
                title={`${im.name}\nDrag onto an item, or double-click to add to the selected item. Ctrl+click to pick several.`}>
                <img src={thumbUrl(im.path, 320)} loading="lazy" draggable={false} />
                <div className="tname">{isUsed && <span className="usedmark">✔ Used</span>} {k + 1}</div>
              </div>
            </div>
          )
        })}
      </div>
      <div className="small muted pad-s">{libDir && tab === 'lib' ? libDir : ''}</div>
    </aside>
  )
}
