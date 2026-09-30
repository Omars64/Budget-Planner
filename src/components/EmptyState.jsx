import { Sparkles } from 'lucide-react'
export default function EmptyState({ title = 'Nothing here yet', text = 'Add your first item to get started.', icon, action }) {
  return <div className="empty-state"><span aria-hidden="true">{icon || <Sparkles size={20}/>}</span><h4>{title}</h4>{text && <p>{text}</p>}{action}</div>
}
