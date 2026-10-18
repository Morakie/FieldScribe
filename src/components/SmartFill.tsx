import { useState } from 'react'
import Modal from './Modal'
import { useEditor } from './Editor'
import { escapeHtml } from '../util'

/** Fills *KEY(arg)* placeholders one by one from the template's pick lists (HomeGauge "Smart Text"). */
export default function SmartFill({ html, onDone, onClose }: { html: string; onDone: (html: string) => void; onClose: () => void }) {
  const { r, editTemplate } = useEditor()
  const keys = [...html.matchAll(/\*([A-Z]+)\(([^)]*)\)\*/g)].map((m) => ({ token: m[0], key: `${m[1]}(${m[2]})`, kind: m[1], arg: m[2] }))
  const [picks, setPicks] = useState<string[][]>(() => keys.map(() => []))
  const [typed, setTyped] = useState<string[]>(() => keys.map(() => ''))
  const join = (a: string[]) => (a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1])
  const vals = keys.map((_, i) => join([...picks[i], ...(typed[i].trim() ? [typed[i].trim()] : [])]))
  const toggle = (i: number, o: string) => setPicks(picks.map((p, j) => (j !== i ? p : p.includes(o) ? p.filter((x) => x !== o) : [...p, o])))

  function apply() {
    let out = html
    keys.forEach((k, i) => { out = out.replace(k.token, escapeHtml(vals[i] || '')) })
    onDone(out.replace(/ {2,}/g, ' '))
  }
  return (
    <Modal title="Smart Text — fill in the blanks (click several to combine)" onClose={onClose} full
      footer={<><button onClick={onClose}>Cancel</button><button onClick={() => onDone(html)}>Leave blanks</button><button className="primary" onClick={apply}>OK</button></>}>
      <div className="smart-preview sticky" dangerouslySetInnerHTML={{
        __html: keys.reduce((h, k, i) => h.replace(k.token, `<mark>${escapeHtml(vals[i] || k.kind.toLowerCase() + '…')}</mark>`), html),
      }} />
      <div className="smart-list">
        {keys.map((k, i) => {
          const opts = r.template.smartFields[k.key] || []
          return (
            <div key={i} className="smart-row">
              <div className="smart-label">{k.kind} <small>({k.arg})</small></div>
              <div className="smart-opts">
                {opts.map((o) => (
                  <button key={o} className={'chip' + (picks[i].includes(o) ? ' on' : '')} onClick={() => toggle(i, o)}>{picks[i].includes(o) && picks[i].length > 1 ? `${picks[i].indexOf(o) + 1}. ` : ''}{o}</button>
                ))}
                <input placeholder="or type…" value={typed[i]} onChange={(e) => setTyped(typed.map((v, j) => (j === i ? e.target.value : v)))} />
                {typed[i].trim() && !opts.includes(typed[i].trim()) && (
                  <button className="link" onClick={() => { const v = typed[i].trim(); editTemplate((t) => { (t.smartFields[k.key] ||= []).push(v) }); setTyped(typed.map((x, j) => (j === i ? '' : x))); toggle(i, v) }}>save to list</button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </Modal>
  )
}
