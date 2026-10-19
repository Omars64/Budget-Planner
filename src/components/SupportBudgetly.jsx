import { Coffee, ExternalLink } from 'lucide-react'
import SettingsSection from './SettingsSection'
import { SUPPORT_URL } from '../lib/support'

export default function SupportBudgetly() {
  return <SettingsSection title="Buy me a coffee">
    <div className="stack gap-16">
      <p className="muted">Enjoying Budgetly? You can support its ongoing development with an optional tip. Your access to the app stays the same whether you tip or not.</p>
      <a className="button primary self-start" href={SUPPORT_URL} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"><Coffee size={18}/>Support on Ko-fi<ExternalLink size={16}/></a>
      <small className="muted">Payments are handled on Ko-fi through the creator's connected payment provider, outside Budgetly.</small>
    </div>
  </SettingsSection>
}
