import { useEffect, useState } from 'react'
import { Save } from 'lucide-react'
import { useApp } from '../App'
import { api, jsonBody } from '../lib/api'
import CurrencyField from './CurrencyField'
import SettingsSection from './SettingsSection'

export default function CurrencyConfiguration(){
  const {settings,setSettings,refresh,notify}=useApp()
  const [currency,setCurrency]=useState(settings.currency||'KWD')
  const [busy,setBusy]=useState(false)
  useEffect(()=>setCurrency(settings.currency||'KWD'),[settings.currency])
  async function save(event){
    event.preventDefault()
    if(busy)return
    setBusy(true)
    try{
      const updated=await api('/api/settings',{method:'PUT',...jsonBody({currency})})
      setSettings(previous=>({...previous,...updated}))
      refresh()
      notify('Currency saved. Existing amounts have not been converted.')
    }catch(error){notify(error.message,'error')}finally{setBusy(false)}
  }
  return <SettingsSection title="Currency configuration"><form className="stack gap-16" onSubmit={save} aria-busy={busy}>
    <CurrencyField value={currency} onChange={setCurrency}/>
    <button className="button primary self-start" disabled={busy}><Save size={17}/>{busy?'Saving...':'Save currency'}</button>
  </form></SettingsSection>
}
