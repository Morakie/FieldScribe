import type { ReactNode } from 'react'

export default function Modal({ title, onClose, children, footer, wide, full }: {
  title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean; full?: boolean
}) {
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={'modal' + (wide ? ' wide' : '') + (full ? ' full' : '')}>
        <div className="modal-head">
          <span>{title}</span>
          <button className="icon" onClick={onClose} title="Close">✕</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}
