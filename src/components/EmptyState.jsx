import { Sparkles } from 'lucide-react'
export default function EmptyState({ title = 'Nothing here yet', text = 'Add your first item to get started.' }) {
  return <div className="empty-state"><span><Sparkles size={20}/></span><h4>{title}</h4><p>{text}</p></div>
}
