import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

/**
 * Two panes with a draggable divider. `size` is the pixel size of the `fixed` pane
 * ('first' or 'second'); the other pane takes the rest. Sizes are remembered per `id`.
 * An `initial` of 1 or less is a fraction of the available space (e.g. 0.5 = half).
 */
export default function Split({ id, dir, initial, min = 80, max = 2000, fixed = 'first', children }: {
  id: string; dir: 'h' | 'v'; initial: number; min?: number; max?: number; fixed?: 'first' | 'second'; children: [ReactNode, ReactNode]
}) {
  const key = 'split:' + id
  const [size, setSize] = useState<number>(() => {
    try { const v = Number(localStorage.getItem(key)); return v > 0 ? v : initial } catch { return initial }
  })
  const box = useRef<HTMLDivElement>(null)
  const fromFraction = () => {
    const r = box.current?.getBoundingClientRect()
    return r ? Math.max(min, Math.round((dir === 'h' ? r.width : r.height) * initial)) : 300
  }
  useLayoutEffect(() => { if (size <= 1) setSize(fromFraction()) }, [])
  const [drag, setDrag] = useState(false)

  function onDown(e: React.PointerEvent) {
    e.preventDefault()
    const el = box.current!
    const rect = el.getBoundingClientRect()
    setDrag(true)
    const move = (ev: PointerEvent) => {
      const pos = dir === 'h' ? ev.clientX - rect.left : ev.clientY - rect.top
      const total = dir === 'h' ? rect.width : rect.height
      let s = fixed === 'first' ? pos : total - pos
      s = Math.max(min, Math.min(max, Math.min(total - min, s)))
      setSize(s)
      try { localStorage.setItem(key, String(Math.round(s))) } catch {}
    }
    const up = () => { setDrag(false); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  function reset() { setSize(initial <= 1 ? fromFraction() : initial); try { localStorage.removeItem(key) } catch {} }

  const fixedStyle = { flex: size <= 1 ? `0 0 ${size * 100}%` : `0 0 ${size}px`, minWidth: 0, minHeight: 0 }
  const growStyle = { flex: '1 1 0', minWidth: 0, minHeight: 0 }
  return (
    <div ref={box} className={`split split-${dir}${drag ? ' dragging' : ''}`}>
      <div className="split-pane" style={fixed === 'first' ? fixedStyle : growStyle}>{children[0]}</div>
      <div className={`split-handle split-handle-${dir}`} onPointerDown={onDown} onDoubleClick={reset} title="Drag to resize · double-click to reset" />
      <div className="split-pane" style={fixed === 'second' ? fixedStyle : growStyle}>{children[1]}</div>
    </div>
  )
}

export function resetAllSplits() {
  try { Object.keys(localStorage).filter((k) => k.startsWith('split:')).forEach((k) => localStorage.removeItem(k)) } catch {}
}
