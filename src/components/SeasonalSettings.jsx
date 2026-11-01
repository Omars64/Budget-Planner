import { useEffect, useRef, useState } from 'react'
import { Save } from 'lucide-react'
import { useApp } from '../App'
import { api, jsonBody } from '../lib/api'
import { resolveSeason, seasonalPreferences, seasons } from '../lib/seasonal'
import { SeasonalScene } from './SeasonalAtmosphere'
import SettingsSection from './SettingsSection'
export default function SeasonalSettings() {
 const {settings,accountSettings,setSettings,notify}=useApp()
 const signature=JSON.stringify(seasonalPreferences(accountSettings||settings))
 const [draft,setDraft]=useState(()=>JSON.parse(signature)),[busy,setBusy]=useState(false),[status,setStatus]=useState('')
 const lock=useRef(false)
 useEffect(()=>{setDraft(JSON.parse(signature));setStatus('')},[signature])
 const change=(key,value)=>{setDraft(current=>({...current,[key]:value}));setStatus('Preview only · apply to save')}
 const save=async event=>{event.preventDefault();if(lock.current)return;lock.current=true;setBusy(true);try{const result=await api('/api/settings',{method:'PUT',...jsonBody(draft)});setSettings(current=>({...current,...result}));setStatus('Seasonal appearance saved');notify('Seasonal appearance saved')}catch(error){setStatus('Could not save. Your preview is still here.');notify(error.message,'error')}finally{lock.current=false;setBusy(false)}}
 const theme=resolveSeason(draft)
 return <SettingsSection title="Seasonal appearance" className="seasonal-settings"><p className="muted">Seasonal atmosphere, separate from wallpaper. Your financial colours and Space theme stay recognisable. Automatic mode follows the calendar, not live weather.</p><form className="stack gap-16" onSubmit={save}><fieldset disabled={busy} className="seasonal-controls"><legend>When to use a theme</legend><div className="seasonal-mode">{[['off','Off'],['automatic','Automatic'],['manual','Choose manually']].map(([value,label])=><label className="check-row" key={value}><input type="radio" name="seasonal-mode" checked={draft.seasonal_mode===value} onChange={()=>change('seasonal_mode',value)}/>{label}</label>)}</div>
 {draft.seasonal_mode==='automatic'&&<label className="field"><span>Season calendar</span><select value={draft.seasonal_hemisphere} onChange={e=>change('seasonal_hemisphere',e.target.value)}><option value="north">Northern hemisphere · Kuwait, Europe, North America</option><option value="south">Southern hemisphere · Australia, New Zealand</option></select><small>December–February is winter in the north and summer in the south. Halloween runs during October in both.</small></label>}
 {draft.seasonal_mode==='manual'&&<div className="seasonal-theme-grid" role="group" aria-label="Choose a seasonal theme">{Object.entries(seasons).map(([id,item])=><button type="button" key={id} className="seasonal-theme-choice" aria-pressed={draft.seasonal_theme===id} onClick={()=>change('seasonal_theme',id)}><span aria-hidden="true">{item.symbol}</span><strong>{item.name}</strong><small>{item.detail}</small></button>)}</div>}
 <label className="field"><span>Atmosphere effects</span><select value={draft.seasonal_effects} onChange={e=>change('seasonal_effects',e.target.value)}><option value="off">Off · static decoration</option><option value="subtle">Subtle · a few slow details</option><option value="full">Full · richer seasonal motion</option></select><small>Reduced-motion and Budgetly motion settings take priority. Effects pause when the app is hidden.</small></label></fieldset>
 <div className="seasonal-preview-frame"><SeasonalScene theme={theme} effects={draft.seasonal_effects} preview/><div className="seasonal-preview-content"><span className="eyebrow">Live preview</span><h4>{theme?seasons[theme].name:'Standard Budgetly'}</h4><p>{theme?seasons[theme].detail:'Your normal appearance and wallpaper stay as they are.'}</p><div className="seasonal-sample">Your financial screens stay clear and readable</div></div></div><p className="muted" role="status">{status}</p><button className="button primary self-start" disabled={busy}><Save/>{busy?'Saving…':'Apply seasonal appearance'}</button></form></SettingsSection>
}
