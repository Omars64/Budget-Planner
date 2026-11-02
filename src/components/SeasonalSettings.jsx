import { useEffect, useRef, useState } from 'react'
import { Pause, Play, Save } from 'lucide-react'
import { useApp } from '../App'
import { api, jsonBody } from '../lib/api'
import { resolveSeason, seasonalPreferences, seasons } from '../lib/seasonal'
import { SeasonalScene, SeasonalSticker } from './SeasonalAtmosphere'
import SettingsSection from './SettingsSection'

export default function SeasonalSettings() {
  const {user,settings,accountSettings,setSettings,notify}=useApp()
  const signature=JSON.stringify(seasonalPreferences(accountSettings||settings))
  const [draft,setDraft]=useState(()=>JSON.parse(signature))
  const [busy,setBusy]=useState(false),[status,setStatus]=useState(''),[paused,setPaused]=useState(false)
  const lock=useRef(false),alive=useRef(true),identity=useRef(user?.id)
  identity.current=user?.id
  useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[])
  useEffect(()=>setDraft(JSON.parse(signature)),[signature])
  const change=(key,value)=>{setDraft(current=>({...current,[key]:value}));setStatus('Preview only · apply to save')}
  const save=async event=>{
    event.preventDefault()
    if(lock.current)return
    const account=identity.current
    lock.current=true;setBusy(true)
    try {
      const result=await api('/api/settings',{method:'PUT',...jsonBody(draft)})
      if(!alive.current||identity.current!==account)return
      setSettings(current=>({...current,...result}));setStatus('Seasonal appearance saved');notify('Seasonal appearance saved')
    } catch(error) {
      if(alive.current&&identity.current===account){setStatus('Could not save. Your preview is still here.');notify(error.message,'error')}
    } finally {lock.current=false;if(alive.current&&identity.current===account)setBusy(false)}
  }
  const theme=resolveSeason(draft)
  return <SettingsSection title="Seasonal appearance" className="seasonal-settings">
    <p className="muted">Choose an animated seasonal world with see-through app surfaces. Wallpaper and Space colours are kept, and return to their normal appearance when seasons are off. Automatic mode follows the calendar, not live weather.</p>
    <form className="stack gap-16" onSubmit={save}>
      <fieldset disabled={busy} className="seasonal-controls"><legend>When to use a theme</legend>
        <div className="seasonal-mode">{[['off','Off'],['automatic','Automatic'],['manual','Choose manually']].map(([value,label])=><label className="check-row" key={value}><input type="radio" name="seasonal-mode" checked={draft.seasonal_mode===value} onChange={()=>change('seasonal_mode',value)}/>{label}</label>)}</div>
        {draft.seasonal_mode==='automatic'&&<label className="field"><span>Season calendar</span><select value={draft.seasonal_hemisphere} onChange={e=>change('seasonal_hemisphere',e.target.value)}><option value="north">Northern hemisphere · Kuwait, Europe, North America</option><option value="south">Southern hemisphere · Australia, New Zealand</option></select><small>December–February is winter in the north and summer in the south. Halloween runs during October in both.</small></label>}
        {draft.seasonal_mode==='manual'&&<div className="seasonal-theme-grid" role="group" aria-label="Choose a seasonal theme">{Object.entries(seasons).map(([id,item])=><button type="button" key={id} className="seasonal-theme-choice" aria-pressed={draft.seasonal_theme===id} onClick={()=>change('seasonal_theme',id)}><span className="seasonal-choice-art" aria-hidden="true">{item.art.length?<SeasonalSticker index={item.art[0]}/>:<i className="seasonal-raindrop seasonal-choice-drop"/>}</span><strong>{item.name}</strong><small>{item.detail}</small></button>)}</div>}
        <div className="form-grid two"><label className="field"><span>Atmosphere effects</span><select aria-label="Atmosphere effects" value={draft.seasonal_effects} onChange={e=>change('seasonal_effects',e.target.value)}><option value="off">Off · static seasonal scene</option><option value="subtle">Subtle · gentle seasonal details</option><option value="full">Full · richer seasonal motion</option></select></label>
        <label className="field"><span>Animation speed</span><select aria-label="Animation speed" value={draft.seasonal_speed} onChange={e=>change('seasonal_speed',e.target.value)}><option value="slow">Slow & calm</option><option value="normal">Normal</option><option value="lively">Lively</option></select></label></div>
        <label className="field seasonal-slider"><span>Surface tint · {draft.seasonal_tint}%</span><input type="range" min="0" max="18" step="1" value={draft.seasonal_tint} onChange={e=>change('seasonal_tint',Number(e.target.value))}/><small>0% clear → 18% light tint. Surfaces always remain see-through.</small></label>
        <small className="muted">Reduced-motion and Budgetly motion settings take priority. Effects pause when the app is hidden. Artwork is bundled for browser and Android; no location or weather service is used.</small>
      </fieldset>
      <div className="seasonal-preview-toolbar"><strong>Live preview</strong><button type="button" className="button ghost small" onClick={()=>setPaused(value=>!value)} aria-pressed={paused}>{paused?<Play size={16}/>:<Pause size={16}/>} {paused?'Resume preview':'Pause preview'}</button></div>
      <div className="seasonal-preview-frame" data-season={theme||undefined} style={{'--season-tint':draft.seasonal_tint/100}}><SeasonalScene theme={theme} effects={draft.seasonal_effects} tint={draft.seasonal_tint} speed={draft.seasonal_speed} paused={paused} preview/><div className="seasonal-preview-content"><span className="eyebrow">{theme?'Seasonal world':'Normal appearance'}</span><h4>{theme?seasons[theme].name:'Standard Budgetly'}</h4><p>{theme?seasons[theme].detail:'Your normal appearance and wallpaper stay as they are.'}</p><div className="seasonal-sample">The same artwork, transparency and motion as your full workspace.</div></div></div>
      <p className="muted" role="status">{status}</p><button className="button primary self-start" disabled={busy}><Save/>{busy?'Saving…':'Apply seasonal appearance'}</button>
    </form>
  </SettingsSection>
}
