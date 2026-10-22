import { ChevronRight } from 'lucide-react'
import { useContext, useId } from 'react'
import { SettingsInlineContext } from '../lib/settingsContext'

export default function SettingsSection({ title, heading = title, children, className = '' }) {
  const inline = useContext(SettingsInlineContext)
  const headingId = useId()
  if (inline) return <section className={`settings-subsection ${className}`} aria-labelledby={headingId}>
    <h3 id={headingId} data-tour-section={title}>{heading}</h3>
    <div className="settings-subsection-body">{children}</div>
  </section>
  return <details className={`settings-section ${className}`}>
    <summary data-tour-section={title}><span>{title}</span><ChevronRight size={18} aria-hidden="true"/></summary>
    <div className="settings-section-body">{children}</div>
  </details>
}
