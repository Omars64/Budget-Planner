import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react'
import { useApp } from '../App'
import { clearEntryMemory, secondaryPages, useWorkspacePreferences } from '../lib/workspacePreferences'

export default function WorkspacePreferences() {
  const { user, notify } = useApp()
  const [prefs, save] = useWorkspacePreferences(user?.id)
  const persist = patch => { if (!save(patch)) notify('Device preferences could not be saved.', 'error') }
  const move = (group, path, direction) => {
    const order = prefs.navOrder.filter(value => secondaryPages.some(([id,,section]) => id === value && section === group))
    const index = order.indexOf(path), other = index + direction
    if (other < 0 || other >= order.length) return
    const all = [...prefs.navOrder], a = all.indexOf(path), b = all.indexOf(order[other])
    ;[all[a],all[b]] = [all[b],all[a]]
    persist({navOrder:all})
  }
  return <div className="workspace-preferences stack gap-16">
    <label className="check-row"><input type="checkbox" checked={prefs.rememberEntry} onChange={event => { persist({rememberEntry:event.target.checked}); if (!event.target.checked) clearEntryMemory(user.id) }}/><span>Remember wallet, category and recent descriptions on this device</span></label>
    <button type="button" className="button ghost small" onClick={() => { clearEntryMemory(user.id); notify('Recent entry choices cleared') }}><Trash2 size={16}/>Clear recent choices</button>
    <label className="field"><span>Notes view</span><select aria-label="Notes view" value={prefs.notesView} onChange={event => persist({notesView:event.target.value})}><option value="grid">Grid</option><option value="list">List</option></select></label>
    <details className="ledger-disclosure"><summary>Page order</summary>{['Planning','Workspace'].map(group => {
      const pages = prefs.navOrder.map(path => secondaryPages.find(([id]) => id === path)).filter(page => page?.[2] === group)
      return <section key={group}><h4>{group}</h4>{pages.map(([path,label],index) => <div className="preference-order-row" key={path}><span>{label}</span><button type="button" className="icon-button" aria-label={`Move ${label} up`} title="Move up" disabled={index === 0} onClick={() => move(group,path,-1)}><ArrowUp size={17}/></button><button type="button" className="icon-button" aria-label={`Move ${label} down`} title="Move down" disabled={index === pages.length-1} onClick={() => move(group,path,1)}><ArrowDown size={17}/></button></div>)}</section>
    })}<button type="button" className="button ghost small" onClick={() => persist({navOrder:secondaryPages.map(([path]) => path)})}>Reset page order</button></details>
  </div>
}
