import { useId } from 'react'
import { recentEntries } from '../lib/workspacePreferences'

export default function RecentDescriptions({ userId, scope, type, children }) {
  const id = useId()
  const entries = [...new Set(recentEntries(userId,scope).filter(entry => entry.type === type).map(entry => entry.description).filter(Boolean))]
  return <>{children(`descriptions-${id}`)}<datalist id={`descriptions-${id}`}>{entries.map(description => <option key={description} value={description}/>)}</datalist></>
}
