import { useEffect, useRef, useState, type ReactNode } from 'react'

interface Geo { x: number; y: number; w: number; h: number }

/** A popup window inside the app that can be dragged by its title bar and resized; remembers its size/position per id. */
export default function FloatingWindow({ id, title, onClose, children, footer, initial }: {
  id: string; title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; initial?: { w: number; h: number }
}) {
  const key = 'win:' + id
  const clamp = (g: Geo): Geo => {
    const W = window.innerWidth, H = window.innerHeight
    const w = Math.max(560, Math.min(g.w, W - 8)), h = Math.max(380, Math.min(g.h, H - 8))
    return { w, h, x: Math.max(4, Math.min(g.x, W - w - 4)), y: Math.max(4, Math.min(g.y, H - h - 4)) }
  }
  const [geo, setGeo] = useState<Geo>(() => {
    try { const g = JSON.parse(localStorage.getItem(key) || ''); if (g?.w) return clamp(g) } catch {}
    const w = initial?.w || 1040, h = initial?.h || 700
    return clamp({ w, h, x: (window.innerWidth - w) / 2, y: (window.innerHeight - h) / 2 })
  })
  const geoRef = useRef(geo); geoRef.current = geo
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(geo)) } catch {} }, [geo])
  useEffect(() => {
    const f = () => setGeo((g) => clamp(g))
    window.addEventListener('resize', f)
    return () => window.removeEventListener('resize', f)
  }, [])

  function drag(e: React.PointerEvent, mode: 'move' | 'se' | 'e' | 's') {
    if ((e.target as HTMLElement).closest('button')) return
    e.preventDefault()
    const sx = e.clientX, sy = e.clientY, g0 = geoRef.current
    const mv = (ev: PointerEvent) => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy
      setGeo(clamp(mode === 'move' ? { ...g0, x: g0.x + dx, y: g0.y + dy }
        : { ...g0, w: g0.w + (mode !== 's' ? dx : 0), h: g0.h + (mode !== 'e' ? dy : 0) }))
    }
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); document.body.classList.remove('dragging-win') }
    document.body.classList.add('dragging-win')
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up)
  }
  return (
    <div className="fw-back">
      <div className="fw" style={{ left: geo.x, top: geo.y, width: geo.w, height: geo.h }}>
        <div className="modal-head fw-head" onPointerDown={(e) => drag(e, 'move')} onDoubleClick={() => setGeo(clamp({ x: 4, y: 4, w: window.innerWidth, h: window.innerHeight }))}>
          <span>{title}</span>
          <button className="icon" onClick={onClose} title="Close">✕</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
        <div className="fw-rs fw-e" onPointerDown={(e) => drag(e, 'e')} />
        <div className="fw-rs fw-s" onPointerDown={(e) => drag(e, 's')} />
        <div className="fw-rs fw-se" onPointerDown={(e) => drag(e, 'se')} title="Drag to resize" />
      </div>
    </div>
  )
}
