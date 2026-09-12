import { ChevronRight } from 'lucide-react'

export default function SettingsSection({ title, children, className = '' }) {
  return <details className={`settings-section ${className}`}>
    <summary><span>{title}</span><ChevronRight size={18} aria-hidden="true"/></summary>
    <div className="settings-section-body">{children}</div>
  </details>
}
