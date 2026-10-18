import { useEffect, useRef, useState } from 'react'

/** Small rich-text box (bold/italic/underline/lists/alignment) that stores HTML. */
export default function RichText({ value, onChange, placeholder, minHeight = 120, toolbarExtra }: {
  value: string; onChange: (html: string) => void; placeholder?: string; minHeight?: number; toolbarExtra?: React.ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const last = useRef<string>('')
  useEffect(() => {
    if (ref.current && value !== last.current) { ref.current.innerHTML = value || ''; last.current = value }
  }, [value])
  const cmd = (c: string, v?: string) => (e: React.MouseEvent) => {
    e.preventDefault(); document.execCommand(c, false, v); emit()
  }
  // font colour: remember the selection so clicking the palette doesn't lose it
  const saved = useRef<Range | null>(null)
  const [palette, setPalette] = useState(false)
  const [fontColor, setFontColor] = useState(() => { try { return localStorage.getItem('pref:fontColor') || '#d00000' } catch { return '#d00000' } })
  const keep = () => { const s = window.getSelection(); if (s && s.rangeCount && ref.current?.contains(s.anchorNode)) saved.current = s.getRangeAt(0).cloneRange() }
  const applyColor = (c: string) => {
    const s = window.getSelection()
    if (saved.current && s) { s.removeAllRanges(); s.addRange(saved.current) }
    document.execCommand('foreColor', false, c); emit()
    setFontColor(c); try { localStorage.setItem('pref:fontColor', c) } catch {}
    setPalette(false)
  }
  const COLORS = ['#000000', '#444444', '#888888', '#ffffff', '#d00000', '#e8590c', '#f2c200', '#2b8a3e', '#1971c2', '#6741d9', '#c2255c', '#8b4513']
  const emit = () => { if (ref.current) { last.current = ref.current.innerHTML; onChange(last.current) } }
  return (
    <div className="rte">
      <div className="rte-bar">
        <button onMouseDown={cmd('bold')} title="Bold"><b>B</b></button>
        <button onMouseDown={cmd('italic')} title="Italic"><i>I</i></button>
        <button onMouseDown={cmd('underline')} title="Underline"><u>U</u></button>
        <button onMouseDown={cmd('insertUnorderedList')} title="Bullets">•≡</button>
        <button onMouseDown={cmd('insertOrderedList')} title="Numbered">1≡</button>
        <button onMouseDown={cmd('justifyLeft')} title="Left">⯇</button>
        <button onMouseDown={cmd('justifyCenter')} title="Center">≡</button>
        <span className="color-btn">
          <button onMouseDown={(e) => { e.preventDefault(); keep(); applyColor(fontColor) }} title="Font color (click to apply, ▾ for more)">
            <span className="fc-a">A</span><span className="fc-bar" style={{ background: fontColor }} />
          </button>
          <button className="fc-more" onMouseDown={(e) => { e.preventDefault(); keep(); setPalette(!palette) }} title="Choose font color">▾</button>
          {palette && <div className="fc-pop" onMouseDown={(e) => e.preventDefault()}>
            {COLORS.map((c) => <span key={c} style={{ background: c }} title={c} onMouseDown={(e) => { e.preventDefault(); applyColor(c) }} />)}
            <label className="fc-custom">Custom <input type="color" defaultValue={fontColor} onChange={(e) => applyColor(e.target.value)} /></label>
          </div>}
        </span>
        <button onMouseDown={cmd('removeFormat')} title="Clear formatting">⌫</button>
        {toolbarExtra}
      </div>
      <div ref={ref} className="rte-body" contentEditable suppressContentEditableWarning spellCheck
        data-placeholder={placeholder} style={{ minHeight }} onInput={emit} onBlur={emit} />
    </div>
  )
}
