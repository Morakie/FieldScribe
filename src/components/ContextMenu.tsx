import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export type MenuItem = { label: string; onClick?: () => void; disabled?: boolean; hint?: string } | 'sep'

/** A right-click menu at the mouse position. Closes on click elsewhere, Escape, scroll or window blur. */
export default function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })
  // keep the menu on screen
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPos({ x: Math.max(4, Math.min(x, window.innerWidth - r.width - 4)), y: Math.max(4, Math.min(y, window.innerHeight - r.height - 4)) })
  }, [x, y])
  useEffect(() => {
    const down = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose() }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('mousedown', down, true)
    window.addEventListener('keydown', key)
    window.addEventListener('blur', onClose)
    window.addEventListener('wheel', onClose, { passive: true })
    return () => {
      window.removeEventListener('mousedown', down, true); window.removeEventListener('keydown', key)
      window.removeEventListener('blur', onClose); window.removeEventListener('wheel', onClose)
    }
  }, [onClose])
  return (
    <div ref={ref} className="ctx-menu" style={{ left: pos.x, top: pos.y }} onContextMenu={(e) => e.preventDefault()}>
      {items.map((it, i) => it === 'sep'
        ? <div key={i} className="ctx-sep" />
        : <button key={i} disabled={it.disabled} title={it.hint} onClick={() => { onClose(); it.onClick?.() }}>{it.label}</button>)}
    </div>
  )
}
