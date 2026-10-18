/** Small inline icons so badges look the same on every PC (emoji differ between Windows versions). */
export const CamIcon = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden><path fillRule="evenodd" d="M4 7h3.5L9 5h6l1.5 2H20a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1zm8 11a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zm0-2a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z" /></svg>
)
export const NoteIcon = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden><path d="M5 4h14v16H5zM8 9h8M8 13h8M8 17h5" /></svg>
)
export const Badge = ({ icon, n, title, tone }: { icon: React.ReactNode; n: number; title: string; tone?: 'sum' }) => (
  <span className={'badge-pill' + (tone ? ' ' + tone : '')} title={title}>{icon}{n}</span>
)
