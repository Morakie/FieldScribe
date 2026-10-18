import { useEffect, useRef, useState } from 'react'
import type { Photo } from '../types'
import FloatingWindow from './FloatingWindow'
import { useEditor } from './Editor'
import { api, imgUrl, joinPath, photoSettings, REPORT_SIZES, scaledCanvas, toJpeg, uid, workingEdge, type ReportPhotoSize } from '../util'

/* ---------------- model ---------------- */
type Kind = 'rect' | 'ellipse' | 'line' | 'arrow' | 'text' | 'zo'
interface Obj {
  id: string; t: Kind
  x: number; y: number; w: number; h: number   // box (rect/ellipse/text/zo target); for line/arrow: (x,y)->(x+w,y+h)
  rot: number                                  // degrees, boxes only
  stroke: string; lw: number; fill: string | null
  text?: string; fs?: number; tcolor?: string  // text boxes
  sx?: number; sy?: number; sr?: number        // ZO: source circle (what gets magnified)
}
interface Grid { on: boolean; cols: number; rows: number; color: string }
export interface EditState { rot: number; bright: number; contrast: number; crop: { x: number; y: number; w: number; h: number } | null; objs: Obj[]; grid: Grid }
const blank = (): EditState => ({ rot: 0, bright: 0, contrast: 0, crop: null, objs: [], grid: { on: false, cols: 7, rows: 4, color: '#18c8ff' } })

type Tool = 'select' | 'rect' | 'ellipse' | 'line' | 'arrow' | 'text' | 'zo' | 'crop' | 'zcrop'
type Drag =
  | { mode: 'new'; obj: Obj; x0: number; y0: number }
  | { mode: 'crop'; x0: number; y0: number; x1: number; y1: number; fixed: boolean }
  | { mode: 'move'; id: string; part: 'body' | 'src'; dx: number; dy: number; start: EditState }
  | { mode: 'resize'; id: string; handle: string; start: EditState; obj0: Obj }

const isLine = (o: Obj) => o.t === 'line' || o.t === 'arrow'
const deg = (d: number) => (d * Math.PI) / 180

/** Editor for a single report photo. Markup is stored as objects on the photo, so it can be re-edited later. */
export default function PhotoEditor({ photo, onClose, onSaved, title, onSkip }: {
  photo: Photo; onClose: () => void; onSaved: (p: Partial<Photo>) => void; title?: string; onSkip?: () => void
}) {
  const { r, dir } = useEditor()
  const canvas = useRef<HTMLCanvasElement>(null)
  const base = useRef<HTMLCanvasElement | null>(null) // rotated + brightness/contrast, full size
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [failed, setFailed] = useState(false)
  const [st, setSt] = useState<EditState>(() => ({ ...blank(), ...((photo.edit as EditState) || {}) }))
  const [hist, setHist] = useState<EditState[]>([])
  const [tool, setTool] = useState<Tool>('select')
  const [selId, setSelId] = useState<string | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [stroke, setStroke] = useState('#ff2020')
  const [lw, setLw] = useState(4)
  const [useFill, setUseFill] = useState(false)
  const [fill, setFill] = useState('#1e5bff')
  const [size, setSize] = useState<ReportPhotoSize>(photo.size || photoSettings().reportSize)
  const edge = workingEdge()
  const [caption, setCaption] = useState(photo.caption)
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [, setTick] = useState(0)
  const stage = useRef<HTMLDivElement>(null)
  const [avail, setAvail] = useState({ w: 800, h: 500 })
  useEffect(() => {
    const el = stage.current
    if (!el) return
    const ro = new ResizeObserver(() => setAvail({ w: el.clientWidth - 16, h: el.clientHeight - 16 }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const sel = st.objs.find((o) => o.id === selId) || null
  const editing = st.objs.find((o) => o.id === editingId && o.t === 'text') || null

  // load the untouched original (high-res) so edits never stack up quality loss
  useEffect(() => {
    api.originalOf(r.id, photo.file).then((p) => {
      const im = new Image()
      im.crossOrigin = 'anonymous'
      im.onload = () => setImg(im)
      im.onerror = () => { // fall back to the report copy
        const im2 = new Image(); im2.crossOrigin = 'anonymous'
        im2.onload = () => setImg(im2); im2.onerror = () => setFailed(true)
        im2.src = imgUrl(joinPath(dir, photo.file)) + '&v=' + Date.now()
      }
      im.src = imgUrl(p) + '&v=' + Date.now()
    })
  }, [])

  const commit = (next: EditState) => { setHist((h) => [...h.slice(-60), st]); setSt(next) }
  const undo = () => { if (hist.length) { setSt(hist[hist.length - 1]); setHist(hist.slice(0, -1)) } }
  const updateObj = (id: string, patch: Partial<Obj>, record = true) => {
    const next = { ...st, objs: st.objs.map((o) => (o.id === id ? { ...o, ...patch } : o)) }
    record ? commit(next) : setSt(next)
  }

  /* -------- geometry -------- */
  const full = () => (img ? (st.rot % 2 ? { w: img.naturalHeight, h: img.naturalWidth } : { w: img.naturalWidth, h: img.naturalHeight }) : { w: 1, h: 1 })
  const view = () => st.crop || { x: 0, y: 0, ...full() }
  const unit = () => Math.max(full().w, full().h) / 1000 // ~1px of a 1000px photo, so sizes look alike on any photo

  // rebuild the base image when rotation/brightness/contrast change
  useEffect(() => {
    if (!img) return
    const { w, h } = full()
    const c = base.current || document.createElement('canvas')
    c.width = w; c.height = h
    const ctx = c.getContext('2d')!
    ctx.save()
    ctx.filter = `brightness(${100 + st.bright}%) contrast(${100 + st.contrast}%)`
    ctx.translate(w / 2, h / 2); ctx.rotate((st.rot * Math.PI) / 2)
    ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2)
    ctx.restore()
    base.current = c
    setTick((t) => t + 1)
  }, [img, st.rot, st.bright, st.contrast])
  useEffect(() => { paint() })

  function paint() {
    const cv = canvas.current
    if (!cv || !base.current) return
    const v = view()
    if (cv.width !== Math.round(v.w)) cv.width = Math.round(v.w)
    if (cv.height !== Math.round(v.h)) cv.height = Math.round(v.h)
    const ctx = cv.getContext('2d')!
    ctx.save(); ctx.clearRect(0, 0, cv.width, cv.height); ctx.translate(-v.x, -v.y)
    drawAll(ctx, base.current, st, unit(), editingId)
    if (drag?.mode === 'new') drawObj(ctx, base.current, drag.obj, unit())
    if (sel && sel.id !== editingId) drawSelection(ctx, sel, unit())
    if (drag?.mode === 'crop') {
      const x = Math.min(drag.x0, drag.x1), y = Math.min(drag.y0, drag.y1), w = Math.abs(drag.x1 - drag.x0), h = Math.abs(drag.y1 - drag.y0)
      ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.beginPath(); ctx.rect(v.x, v.y, v.w, v.h); ctx.rect(x, y, w, h); ctx.fill('evenodd')
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2 * unit(); ctx.setLineDash([10 * unit(), 6 * unit()]); ctx.strokeRect(x, y, w, h)
    }
    ctx.restore()
  }

  const pt = (e: React.PointerEvent) => {
    const cv = canvas.current!, b = cv.getBoundingClientRect(), v = view()
    return { x: v.x + ((e.clientX - b.left) / b.width) * cv.width, y: v.y + ((e.clientY - b.top) / b.height) * cv.height }
  }

  /* -------- pointer -------- */
  function down(e: React.PointerEvent) {
    if (!img) return
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    const p = pt(e)
    if (tool === 'crop' || tool === 'zcrop') return setDrag({ mode: 'crop', x0: p.x, y0: p.y, x1: p.x, y1: p.y, fixed: tool === 'zcrop' })
    if (tool === 'select') {
      if (sel) {
        const hnd = hitHandle(sel, p, unit() * 9)
        if (hnd) return setDrag({ mode: 'resize', id: sel.id, handle: hnd, start: st, obj0: { ...sel } })
      }
      const hit = [...st.objs].reverse().map((o) => ({ o, part: hitTest(o, p, unit() * 8) })).find((h) => h.part)
      if (hit) {
        if (hit.o.t === 'text' && hit.o.id === selId) { setHist((h) => [...h.slice(-60), st]); setEditingId(hit.o.id); return }
        setEditingId(null)
        setSelId(hit.o.id)
        const ax = hit.part === 'src' ? hit.o.sx! : hit.o.x, ay = hit.part === 'src' ? hit.o.sy! : hit.o.y
        return setDrag({ mode: 'move', id: hit.o.id, part: hit.part as 'body' | 'src', dx: p.x - ax, dy: p.y - ay, start: st })
      }
      setEditingId(null)
      return setSelId(null)
    }
    setEditingId(null)
    const o: Obj = {
      id: uid(), t: tool as Kind, x: p.x, y: p.y, w: 0, h: 0, rot: 0, stroke, lw: lw * unit(), fill: useFill ? fill : null,
      ...(tool === 'text' ? { text: '', fs: 26 * unit(), tcolor: stroke, lw: 0 } : {}),
      ...(tool === 'zo' ? { sx: p.x, sy: p.y, sr: 0, fill: null } : {}),
    }
    setDrag({ mode: 'new', obj: o, x0: p.x, y0: p.y })
  }
  function move(e: React.PointerEvent) {
    if (!drag) return
    const p = pt(e)
    if (drag.mode === 'crop') {
      let y1 = p.y
      if (drag.fixed) y1 = drag.y0 + Math.sign(p.y - drag.y0 || 1) * Math.abs(p.x - drag.x0) * 9 / 16
      return setDrag({ ...drag, x1: p.x, y1 })
    }
    if (drag.mode === 'new') {
      const o = { ...drag.obj }
      if (isLine(o)) { o.w = p.x - drag.x0; o.h = p.y - drag.y0 }
      else if (o.t === 'zo') { o.sr = Math.hypot(p.x - drag.x0, p.y - drag.y0) }
      else { o.x = Math.min(p.x, drag.x0); o.y = Math.min(p.y, drag.y0); o.w = Math.abs(p.x - drag.x0); o.h = Math.abs(p.y - drag.y0) }
      return setDrag({ ...drag, obj: o })
    }
    if (drag.mode === 'move') {
      const patch: Partial<Obj> = drag.part === 'src' ? { sx: p.x - drag.dx, sy: p.y - drag.dy } : { x: p.x - drag.dx, y: p.y - drag.dy }
      return setSt({ ...drag.start, objs: drag.start.objs.map((x) => (x.id === drag.id ? { ...x, ...patch } : x)) })
    }
    if (drag.mode === 'resize') {
      const o = { ...drag.obj0 }
      if (isLine(o)) {
        if (drag.handle === 'p1') { o.w = o.x + o.w - p.x; o.h = o.y + o.h - p.y; o.x = p.x; o.y = p.y } else { o.w = p.x - o.x; o.h = p.y - o.y }
      } else if (drag.handle === 'src') {
        o.sr = Math.max(4 * unit(), Math.hypot(p.x - o.sx!, p.y - o.sy!))
      } else {
        // resize in the box's own (rotated) frame, keeping the opposite side fixed
        const cx = o.x + o.w / 2, cy = o.y + o.h / 2, a = deg(-o.rot)
        const lx = Math.cos(a) * (p.x - cx) - Math.sin(a) * (p.y - cy), ly = Math.sin(a) * (p.x - cx) + Math.cos(a) * (p.y - cy)
        let l = -o.w / 2, t = -o.h / 2, rr = o.w / 2, b = o.h / 2
        if (drag.handle.includes('w')) l = Math.min(lx, rr - 6)
        if (drag.handle.includes('e')) rr = Math.max(lx, l + 6)
        if (drag.handle.includes('n')) t = Math.min(ly, b - 6)
        if (drag.handle.includes('s')) b = Math.max(ly, t + 6)
        if (o.t === 'zo') { const s = Math.max(rr - l, b - t); rr = l + s; b = t + s }
        const ncx = (l + rr) / 2, ncy = (t + b) / 2, A = deg(o.rot)
        const wcx = cx + Math.cos(A) * ncx - Math.sin(A) * ncy, wcy = cy + Math.sin(A) * ncx + Math.cos(A) * ncy
        o.w = rr - l; o.h = b - t; o.x = wcx - o.w / 2; o.y = wcy - o.h / 2
      }
      return setSt({ ...drag.start, objs: drag.start.objs.map((x) => (x.id === drag.id ? o : x)) })
    }
  }
  function up() {
    if (!drag) return
    if (drag.mode === 'crop') {
      const x = Math.min(drag.x0, drag.x1), y = Math.min(drag.y0, drag.y1), w = Math.abs(drag.x1 - drag.x0), h = Math.abs(drag.y1 - drag.y0)
      if (w > 12 && h > 12) { commit({ ...st, crop: { x, y, w, h } }); setTool('select') }
    } else if (drag.mode === 'new') {
      let o = drag.obj
      const tiny = isLine(o) ? Math.hypot(o.w, o.h) < 6 * unit() : o.t === 'zo' ? (o.sr || 0) < 6 * unit() : o.w < 6 * unit() || o.h < 6 * unit()
      if (o.t === 'text' && tiny) o = { ...o, w: 260 * unit(), h: 80 * unit() } // a click makes a default-size text box
      else if (tiny) { setDrag(null); return }
      if (o.t === 'zo') {
        // magnified circle 2.5x the source, placed beside it inside the photo
        const v = view(), R = Math.min(o.sr! * 2.5, Math.min(v.w, v.h) * 0.45)
        let cx = o.sx! + o.sr! + R * 1.4
        if (cx + R > v.x + v.w) cx = o.sx! - o.sr! - R * 1.4
        cx = Math.max(v.x + R, Math.min(v.x + v.w - R, cx))
        const cy = Math.max(v.y + R, Math.min(v.y + v.h - R, o.sy!))
        o = { ...o, x: cx - R, y: cy - R, w: 2 * R, h: 2 * R }
      }
      commit({ ...st, objs: [...st.objs, o] })
      setSelId(o.id)
      setTool('select')
      if (o.t === 'text') setEditingId(o.id) // start typing straight into the new box
    } else if (drag.mode === 'move' || drag.mode === 'resize') {
      setHist((h) => [...h.slice(-60), drag.start])
    }
    setDrag(null)
  }

  // keyboard: delete, nudge, undo
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') { if (e.key === 'Escape') setEditingId(null); return }
      if (e.key === 'z' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); undo(); return }
      if (!sel) return
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove() }
      const d = (e.shiftKey ? 20 : 4) * unit()
      const mv: Record<string, [number, number]> = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] }
      if (mv[e.key]) { e.preventDefault(); nudge(...mv[e.key]) }
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  })
  const nudge = (dx: number, dy: number) => sel && updateObj(sel.id, { x: sel.x + dx, y: sel.y + dy })
  const remove = () => { if (sel) { commit({ ...st, objs: st.objs.filter((o) => o.id !== sel.id) }); setSelId(null) } }

  function rotatePhoto(d: number) {
    if (st.objs.length && !confirm('Rotating the photo removes the markup (arrows, circles, text). Continue?')) return
    commit({ ...st, rot: (st.rot + d + 4) % 4, objs: [], crop: null }); setSelId(null)
  }

  // style controls also apply to the selected object
  function setStyle(patch: { stroke?: string; lw?: number; fill?: string; useFill?: boolean }) {
    if (patch.stroke !== undefined) setStroke(patch.stroke)
    if (patch.lw !== undefined) setLw(patch.lw)
    if (patch.fill !== undefined) setFill(patch.fill)
    if (patch.useFill !== undefined) setUseFill(patch.useFill)
    if (!sel) return
    const p: Partial<Obj> = {}
    if (patch.stroke !== undefined) { p.stroke = patch.stroke; if (sel.t === 'text') p.tcolor = patch.stroke }
    if (patch.lw !== undefined) p.lw = patch.lw * unit()
    if (patch.fill !== undefined && sel.fill) p.fill = patch.fill
    if (patch.useFill !== undefined) p.fill = patch.useFill ? fill : null
    updateObj(sel.id, p)
  }

  async function save() {
    if (!img || !base.current) return
    setSaving(true)
    const v = view()
    const c = document.createElement('canvas')
    c.width = Math.round(v.w); c.height = Math.round(v.h)
    const ctx = c.getContext('2d')!
    ctx.translate(-v.x, -v.y)
    drawAll(ctx, base.current, st, unit())
    const file = await api.savePhoto(r.id, photo.file, await toJpeg(scaledCanvas(c, edge), 0.88))
    onSaved({ file, size, caption, edit: st })
  }
  function revert() {
    if (!confirm('Remove all markup, crops and adjustments and go back to the original photo?')) return
    commit(blank()); setSelId(null)
  }

  const tools: [Tool, string, string][] = [
    ['select', '⬚ Select', 'Select, move and resize markup. Delete key removes it, arrow keys nudge it.'],
    ['arrow', '➚ Arrow', 'Drag to draw an arrow'], ['line', '╱ Line', 'Drag to draw a line'],
    ['rect', '▭ Rect', 'Drag to draw a box'], ['ellipse', '◯ Circle', 'Drag to draw a circle or oval'],
    ['text', 'T Text', 'Click or drag to place a text box, then type into it'],
    ['zo', '⊕ ZO', 'Drag a circle over a detail; a magnified copy appears beside it'],
    ['crop', '⛶ Free Crop', 'Drag the area to keep'],
    ['zcrop', '⛶ Zoom Crop', 'Drag the area to keep, locked to the 16:9 report shape'],
  ]
  const isBox = !!sel && !isLine(sel)
  const v = view()
  const k = Math.min(1, edge / Math.max(v.w, v.h))
  const fit = Math.min(avail.w / v.w, avail.h / v.h, 4)

  return (
    <FloatingWindow id="photoEditor" title={title || 'Edit Picture'} onClose={onClose}
      footer={<>
        <span className="hint">{img ? `Photo: ${Math.round(v.w * k)} × ${Math.round(v.h * k)} px (kept full quality until upload)` : ''}</span>
        <span className="grow" />
        <button onClick={revert}>Revert to original</button>
        <button onClick={onClose}>{onSkip ? 'Stop' : 'Cancel'}</button>
        {onSkip && <button onClick={onSkip}>Skip ▶</button>}
        <button className="primary" disabled={saving || !img} onClick={save}>{saving ? 'Saving…' : onSkip ? 'OK — next ▶' : 'OK'}</button>
      </>}>
      <div className="pe-top">
        <span className="lbl">Report size</span>
        {REPORT_SIZES.map(([key, l]) => <button key={key} className={size === key ? 'on' : ''} onClick={() => setSize(key)}>{l}</button>)}
        <span className="sep" />
        <button onClick={() => rotatePhoto(-1)} title="Rotate photo left">⟲ Left</button>
        <button onClick={() => rotatePhoto(1)} title="Rotate photo right">⟳ Right</button>
        <button disabled={!hist.length} onClick={undo} title="Undo (Ctrl+Z)">↶ Undo</button>
        {st.crop && <button onClick={() => commit({ ...st, crop: null })}>Uncrop</button>}
        <span className="sep" />
        <button className={st.grid.on ? 'on' : ''} onClick={() => commit({ ...st, grid: { ...st.grid, on: !st.grid.on } })} title="Number/letter grid for calling out areas">▦ Grid</button>
        {st.grid.on && <>
          <label className="mini">Cols <input type="number" min={2} max={12} value={st.grid.cols} onChange={(e) => setSt({ ...st, grid: { ...st.grid, cols: Math.max(2, +e.target.value || 2) } })} /></label>
          <label className="mini">Rows <input type="number" min={2} max={10} value={st.grid.rows} onChange={(e) => setSt({ ...st, grid: { ...st.grid, rows: Math.max(2, +e.target.value || 2) } })} /></label>
          <input type="color" value={st.grid.color} onChange={(e) => setSt({ ...st, grid: { ...st.grid, color: e.target.value } })} title="Grid color" />
        </>}
        <span className="grow" />
      </div>
      <div className="pe">
        <div className="pe-tools">
          {tools.map(([t, l, tip]) => <button key={t} className={tool === t ? 'on' : ''} title={tip} onClick={() => { setTool(t); if (t !== 'select') setSelId(null) }}>{l}</button>)}
          <hr />
          <div className="nudge">
            <button disabled={!sel} onClick={() => nudge(0, -4 * unit())} title="Move up">↑</button>
            <div><button disabled={!sel} onClick={() => nudge(-4 * unit(), 0)} title="Move left">←</button><button disabled={!sel} onClick={() => nudge(4 * unit(), 0)} title="Move right">→</button></div>
            <button disabled={!sel} onClick={() => nudge(0, 4 * unit())} title="Move down">↓</button>
          </div>
          <button disabled={!sel} className="danger" onClick={remove}>✕ Remove</button>
        </div>
        <div className="pe-stage">
          <div className="pe-canvas" ref={stage}>
          {img ? <canvas ref={canvas} onPointerDown={down} onPointerMove={move} onPointerUp={up}
            onDoubleClick={() => { if (sel?.t === 'text') setEditingId(sel.id) }}
            style={{ cursor: tool === 'select' ? 'default' : 'crosshair', width: v.w * fit, height: v.h * fit }} />
            : failed ? <div className="pe-error">This photo file could not be found or opened.</div> : <div className="muted">Loading…</div>}
          {editing && canvas.current && (() => {
            const cv = canvas.current!, fs = (editing.fs || 26 * unit()) * fit, pad = 6 * unit() * fit
            return <textarea className="pe-textedit" autoFocus value={editing.text || ''} placeholder="Type here…"
              onChange={(e) => setSt({ ...st, objs: st.objs.map((o) => (o.id === editing.id ? { ...o, text: e.target.value } : o)) })}
              onBlur={() => { if (!editing.text?.trim()) setSt({ ...st, objs: st.objs.filter((o) => o.id !== editing.id) }); setEditingId(null) }}
              style={{
                left: cv.offsetLeft + (editing.x - v.x) * fit, top: cv.offsetTop + (editing.y - v.y) * fit,
                width: editing.w * fit, height: editing.h * fit, transform: `rotate(${editing.rot}deg)`,
                fontSize: fs, lineHeight: 1.2, padding: pad, color: editing.tcolor || editing.stroke,
                background: editing.fill || 'rgba(0,0,0,.15)', border: `${Math.max(1, editing.lw * fit)}px solid ${editing.lw > 0 ? editing.stroke : '#00e5ff'}`,
              }} />
          })()}
          </div>
          <div className="pe-sliders">
            <label>Brightness <input type="range" min={-100} max={100} value={st.bright} onPointerDown={() => setHist((h) => [...h, st])} onChange={(e) => setSt({ ...st, bright: +e.target.value })} /> {st.bright}</label>
            <label>Contrast <input type="range" min={-100} max={100} value={st.contrast} onPointerDown={() => setHist((h) => [...h, st])} onChange={(e) => setSt({ ...st, contrast: +e.target.value })} /> {st.contrast}</label>
          </div>
        </div>
        <div className="pe-props">
          <label>{sel?.t === 'text' ? 'Text color' : 'Line color'} <input type="color" value={sel?.t === 'text' ? sel.tcolor || sel.stroke : sel?.stroke ?? stroke} onChange={(e) => setStyle({ stroke: e.target.value })} /></label>
          <div className="swatches">{['#ff2020', '#ffd400', '#20d020', '#1e90ff', '#ffffff', '#000000'].map((c) => (
            <span key={c} style={{ background: c }} className={c === (sel?.stroke ?? stroke) ? 'on' : ''} onClick={() => setStyle({ stroke: c })} />))}</div>
          <label>Border
            <select value={sel ? Math.round(sel.lw / unit()) : lw} onChange={(e) => setStyle({ lw: +e.target.value })}>
              {[0, 1, 2, 3, 4, 6, 8, 10, 14].map((n) => <option key={n} value={n}>{n === 0 ? 'None' : n}</option>)}
            </select></label>
          <label className="row"><input type="checkbox" checked={sel ? !!sel.fill : useFill} disabled={!!sel && (isLine(sel) || sel.t === 'zo')} onChange={(e) => setStyle({ useFill: e.target.checked })} /> Use fill</label>
          <label>Fill color <input type="color" value={sel?.fill ?? fill} onChange={(e) => setStyle({ fill: e.target.value })} /></label>
          {isBox && sel!.t !== 'zo' && <label>Angle (degrees)
            <div className="row"><input type="number" value={Math.round(sel!.rot)} onChange={(e) => updateObj(sel!.id, { rot: +e.target.value || 0 })} style={{ width: 64 }} />
              <input type="range" min={-180} max={180} value={sel!.rot} onPointerDown={() => setHist((h) => [...h, st])} onChange={(e) => updateObj(sel!.id, { rot: +e.target.value }, false)} /></div></label>}
          {sel?.t === 'text' && <>
            <hr />
            <p className="muted small">Click the selected text box (or double-click it) to type. Text wraps inside the box — drag its handles to resize.</p>
            <label>Text size
              <input type="range" min={10} max={90} value={Math.round((sel.fs || 26 * unit()) / unit())} onChange={(e) => updateObj(sel.id, { fs: +e.target.value * unit() }, false)} /></label>
          </>}
          {sel?.t === 'zo' && <p className="muted small">Drag the zoom circle to move it, its corner handles to resize. The dashed circle (only visible while selected) is the area being magnified — drag it to change what's zoomed. Draw a line or arrow if you want to connect them.</p>}
          {!sel && <p className="muted small">Pick a tool, then drag on the photo. Use Select to move, resize or delete markup — you can come back and change it later.</p>}
          <hr />
          <label>Caption <input value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Caption under the photo" /></label>
        </div>
      </div>
    </FloatingWindow>
  )
}

/* ---------------- drawing ---------------- */
function drawAll(ctx: CanvasRenderingContext2D, base: HTMLCanvasElement, st: EditState, u: number, skipText?: string | null) {
  ctx.drawImage(base, 0, 0)
  for (const o of st.objs) drawObj(ctx, base, o.id === skipText ? { ...o, text: '' } : o, u)
  if (st.grid.on) drawGrid(ctx, st, base, u)
}

function drawObj(ctx: CanvasRenderingContext2D, base: HTMLCanvasElement, o: Obj, u: number) {
  ctx.save()
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'
  ctx.strokeStyle = o.stroke; ctx.lineWidth = o.lw
  if (o.t === 'line' || o.t === 'arrow') {
    const x2 = o.x + o.w, y2 = o.y + o.h, a = Math.atan2(o.h, o.w)
    const L = Math.max(o.lw * 4, 14 * u), half = 0.42
    // stop the shaft inside the arrowhead so it never pokes past the tip
    const ex = o.t === 'arrow' ? x2 - Math.cos(a) * L * 0.7 : x2, ey = o.t === 'arrow' ? y2 - Math.sin(a) * L * 0.7 : y2
    ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = 3 * u
    ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(ex, ey); ctx.stroke()
    if (o.t === 'arrow') {
      ctx.fillStyle = o.stroke
      ctx.beginPath(); ctx.moveTo(x2, y2)
      ctx.lineTo(x2 - L * Math.cos(a - half), y2 - L * Math.sin(a - half))
      ctx.lineTo(x2 - L * Math.cos(a + half), y2 - L * Math.sin(a + half))
      ctx.closePath(); ctx.fill()
    }
    ctx.restore(); return
  }
  if (o.t === 'zo') {
    const R = o.w / 2, cx = o.x + R, cy = o.y + R, sr = o.sr || 1
    ctx.lineWidth = Math.max(o.lw, 2 * u)
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip()
    ctx.drawImage(base, o.sx! - sr, o.sy! - sr, sr * 2, sr * 2, cx - R, cy - R, R * 2, R * 2)
    ctx.restore()
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke()
    ctx.restore(); return
  }
  // boxes (rect / ellipse / text), rotated around their centre
  const cx = o.x + o.w / 2, cy = o.y + o.h / 2
  ctx.translate(cx, cy); ctx.rotate(deg(o.rot))
  const x = -o.w / 2, y = -o.h / 2
  ctx.beginPath()
  if (o.t === 'ellipse') ctx.ellipse(0, 0, o.w / 2, o.h / 2, 0, 0, Math.PI * 2)
  else ctx.rect(x, y, o.w, o.h)
  if (o.fill) { ctx.fillStyle = o.fill; ctx.fill() }
  if (o.lw > 0) {
    ctx.save()
    if (o.t !== 'text') { ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = 3 * u }
    ctx.stroke(); ctx.restore()
  }
  if (o.t === 'text') {
    const fs = o.fs || 26 * u, pad = 6 * u, color = o.tcolor || o.stroke
    ctx.font = `bold ${fs}px "Segoe UI", Arial, sans-serif`
    ctx.textBaseline = 'top'
    const lines = wrap(ctx, o.text || '', o.w - pad * 2)
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, o.w, o.h); ctx.clip()
    lines.forEach((ln, i) => {
      const ty = y + pad + i * fs * 1.2
      ctx.fillStyle = color; ctx.fillText(ln, x + pad, ty)
    })
    ctx.restore()
  }
  ctx.restore()
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = []
  for (const para of text.split('\n')) {
    let line = ''
    for (const word of para.split(/\s+/)) {
      const t = line ? line + ' ' + word : word
      if (ctx.measureText(t).width > maxW && line) { out.push(line); line = word } else line = t
    }
    out.push(line)
  }
  return out
}

function drawGrid(ctx: CanvasRenderingContext2D, st: EditState, base: HTMLCanvasElement, u: number) {
  const v = st.crop || { x: 0, y: 0, w: base.width, h: base.height }
  const { cols, rows, color } = st.grid
  ctx.save()
  ctx.strokeStyle = color; ctx.lineWidth = 2.5 * u
  for (let i = 1; i < cols; i++) { const x = v.x + (v.w * i) / cols; ctx.beginPath(); ctx.moveTo(x, v.y); ctx.lineTo(x, v.y + v.h); ctx.stroke() }
  for (let j = 1; j < rows; j++) { const y = v.y + (v.h * j) / rows; ctx.beginPath(); ctx.moveTo(v.x, y); ctx.lineTo(v.x + v.w, y); ctx.stroke() }
  const fs = Math.min(v.w / cols, v.h / rows) * 0.3
  ctx.font = `900 ${fs}px Impact, "Arial Black", sans-serif`; ctx.textBaseline = 'top'
  ctx.lineWidth = fs / 6; ctx.strokeStyle = '#000'; ctx.fillStyle = '#fff'; ctx.lineJoin = 'round'
  const label = (t: string, x: number, y: number) => { ctx.strokeText(t, x, y); ctx.fillText(t, x, y) }
  for (let i = 0; i < cols; i++) label(String(i + 1), v.x + (v.w * i) / cols + (v.w / cols) * 0.4, v.y + 4 * u)
  for (let j = 0; j < rows; j++) label(String.fromCharCode(65 + j), v.x + 6 * u, v.y + (v.h * j) / rows + (v.h / rows) * 0.36)
  ctx.restore()
}

/* ---------------- selection & hit-testing ---------------- */
function handles(o: Obj): [string, number, number][] {
  if (o.t === 'line' || o.t === 'arrow') return [['p1', o.x, o.y], ['p2', o.x + o.w, o.y + o.h]]
  const cx = o.x + o.w / 2, cy = o.y + o.h / 2, a = deg(o.rot)
  const rot = (lx: number, ly: number): [number, number] => [cx + Math.cos(a) * lx - Math.sin(a) * ly, cy + Math.sin(a) * lx + Math.cos(a) * ly]
  const hw = o.w / 2, hh = o.h / 2
  const list: [string, number, number][] = [['nw', ...rot(-hw, -hh)], ['ne', ...rot(hw, -hh)], ['sw', ...rot(-hw, hh)], ['se', ...rot(hw, hh)]]
  if (o.t !== 'zo') list.push(['n', ...rot(0, -hh)], ['s', ...rot(0, hh)], ['w', ...rot(-hw, 0)], ['e', ...rot(hw, 0)])
  if (o.t === 'zo') list.push(['src', o.sx! + (o.sr || 0), o.sy!])
  return list
}
function hitHandle(o: Obj, p: { x: number; y: number }, r: number) {
  return handles(o).find(([, x, y]) => Math.hypot(p.x - x, p.y - y) <= r * 1.4)?.[0] || null
}
function hitTest(o: Obj, p: { x: number; y: number }, tol: number): 'body' | 'src' | null {
  if (o.t === 'line' || o.t === 'arrow') {
    const L2 = o.w * o.w + o.h * o.h || 1
    const t = Math.max(0, Math.min(1, ((p.x - o.x) * o.w + (p.y - o.y) * o.h) / L2))
    return Math.hypot(p.x - (o.x + t * o.w), p.y - (o.y + t * o.h)) <= tol + o.lw ? 'body' : null
  }
  if (o.t === 'zo') {
    if (Math.hypot(p.x - (o.x + o.w / 2), p.y - (o.y + o.h / 2)) <= o.w / 2) return 'body'
    if (Math.hypot(p.x - o.sx!, p.y - o.sy!) <= (o.sr || 0) + tol) return 'src'
    return null
  }
  const cx = o.x + o.w / 2, cy = o.y + o.h / 2, a = deg(-o.rot)
  const lx = Math.cos(a) * (p.x - cx) - Math.sin(a) * (p.y - cy), ly = Math.sin(a) * (p.x - cx) + Math.cos(a) * (p.y - cy)
  if (o.t === 'ellipse' && !o.fill) {
    const d = Math.hypot(lx / (o.w / 2 || 1), ly / (o.h / 2 || 1))
    return Math.abs(d - 1) * (Math.min(o.w, o.h) / 2) <= tol + o.lw ? 'body' : null
  }
  return Math.abs(lx) <= o.w / 2 + tol && Math.abs(ly) <= o.h / 2 + tol ? 'body' : null
}
function drawSelection(ctx: CanvasRenderingContext2D, o: Obj, u: number) {
  if (!(o.t === 'line' || o.t === 'arrow')) {
    ctx.save()
    ctx.translate(o.x + o.w / 2, o.y + o.h / 2); ctx.rotate(deg(o.rot))
    ctx.setLineDash([6 * u, 4 * u]); ctx.lineWidth = 1.5 * u; ctx.strokeStyle = '#00e5ff'
    ctx.strokeRect(-o.w / 2, -o.h / 2, o.w, o.h)
    ctx.restore()
  }
  if (o.t === 'zo') { // the area being magnified is only shown while selected
    ctx.save(); ctx.setLineDash([6 * u, 4 * u]); ctx.lineWidth = 2 * u; ctx.strokeStyle = '#00e5ff'
    ctx.beginPath(); ctx.arc(o.sx!, o.sy!, o.sr || 1, 0, Math.PI * 2); ctx.stroke(); ctx.restore()
  }
  ctx.save()
  for (const [, x, y] of handles(o)) {
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#0091ea'; ctx.lineWidth = 1.5 * u
    ctx.beginPath(); ctx.rect(x - 5 * u, y - 5 * u, 10 * u, 10 * u); ctx.fill(); ctx.stroke()
  }
  ctx.restore()
}
