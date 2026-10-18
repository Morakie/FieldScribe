import type { Instance } from '../types'
import { useEditor } from './Editor'
import RichText from './RichText'

export default function OverviewView({ instance }: { instance: Instance }) {
  const { mutate } = useEditor()
  return (
    <div className="overview pad">
      <h3>Section Introduction</h3>
      <RichText value={instance.introHtml} minHeight={140} onChange={(h) => mutate(() => { instance.introHtml = h })} />
      <h3>Section Footer</h3>
      <RichText value={instance.footerHtml} minHeight={140} onChange={(h) => mutate(() => { instance.footerHtml = h })} />
    </div>
  )
}
