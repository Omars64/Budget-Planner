import { useEffect, useRef, useState } from 'react'
import { Camera, Download, Image, Mountain, Plus, RefreshCcw, Save, ShieldCheck, Trash2, Upload, UserRound, X } from 'lucide-react'
import { api, jsonBody } from '../lib/api'
import { useApp } from '../App'
import Modal from '../components/Modal'

const imageData = async (file, maxBytes, label) => {
  if (!file) throw new Error(`Choose a ${label.toLowerCase()} first`)
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error(`${label} must be PNG, JPEG, or WebP`)
  if (file.size > maxBytes) throw new Error(`${label} is too large`)
  const bitmap = await createImageBitmap(file)
  try {
    const maxSide = label === 'Wallpaper' ? 1920 : 256
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/webp', .85)
  } finally { bitmap.close() }
}

export default function Settings(){
  const {user,settings,setSettings,appearance,setAppearance,reloadSettings,refresh,notify,lock,confirm}=useApp()
  const [form,setForm]=useState(settings)
  const [cats,setCats]=useState([])
  const [catOpen,setCatOpen]=useState(false)
  const [clearOpen,setClearOpen]=useState(false)
  const [clearScope,setClearScope]=useState('budget')
  const [clearConfirm,setClearConfirm]=useState('')
  const [recovery,setRecovery]=useState([])
  const [cat,setCat]=useState({name:'',kind:'expense',icon:'circle',color:'#0a4173'})
  const inputRef=useRef(null)
  const profileRef=useRef(null)
  const wallpaperRef=useRef(null)
  useEffect(()=>setForm(settings),[settings])
  useEffect(()=>{api('/api/categories').then(setCats);api('/api/recovery').then(setRecovery).catch(()=>{})},[])
  const save=async e=>{e.preventDefault();const updated=await api('/api/settings',{method:'PUT',...jsonBody(form)});setSettings(updated);notify('Settings saved')}
  const addCat=async e=>{e.preventDefault();await api('/api/categories',{method:'POST',...jsonBody(cat)});setCats(await api('/api/categories'));setCatOpen(false);setCat({name:'',kind:'expense',icon:'circle',color:'#0a4173'});refresh();notify('Category added')}
  const removeCat=async c=>{if(!await confirm(`Delete ${c.name}?`))return;try{await api(`/api/categories/${c.id}`,{method:'DELETE'});setCats(await api('/api/categories'));refresh();notify('Category deleted')}catch(err){notify(err.message,'error')}}
  const exportBackup=async()=>{const data=await api('/api/backup');const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`flowbudget-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(url);notify('Backup exported')}
  const restore=async e=>{const file=e.target.files?.[0]; if(!file)return; try{const data=JSON.parse(await file.text());await api('/api/backup/restore',{method:'POST',body:JSON.stringify(data)});await reloadSettings();refresh();setCats(await api('/api/categories'));notify('Backup restored')}catch(err){notify(`Restore failed: ${err.message}`,'error')} finally {e.target.value=''}}
  const clearWorkspace=async e=>{e.preventDefault();try{const result=await api('/api/workspace/clear',{method:'POST',...jsonBody({confirmation:'CLEAR',scope:clearScope})});await reloadSettings();refresh();setCats(await api('/api/categories'));setRecovery(await api('/api/recovery'));setClearOpen(false);setClearConfirm('');notify(`Workspace cleared. Recovery copy #${result.recovery_id} was saved.`)}catch(err){notify(err.message,'error')}}
  const downloadRecovery=async id=>{try{const data=await api(`/api/recovery/${id}`);const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`flowbudget-recovery-${id}.json`;a.click();URL.revokeObjectURL(url)}catch(err){notify(err.message,'error')}}

  const updateAppearance=async patch=>{const updated=await api('/api/account/appearance',{method:'PUT',...jsonBody(patch)});setAppearance(updated);return updated}
  const pickProfile=async e=>{const file=e.target.files?.[0];try{const data=await imageData(file,1_000_000,'Profile picture');await updateAppearance({profile_image:data});notify('Profile picture updated')}catch(err){notify(err.message,'error')}finally{e.target.value=''}}
  const pickWallpaper=async e=>{const file=e.target.files?.[0];try{const data=await imageData(file,2_500_000,'Wallpaper');await updateAppearance({wallpaper_image:data});notify('Wallpaper updated')}catch(err){notify(err.message,'error')}finally{e.target.value=''}}
  const clearAppearance=async key=>{try{await updateAppearance({[key]:''});notify(key==='profile_image'?'Profile picture removed':'Wallpaper removed')}catch(err){notify(err.message,'error')}}

  return <div className="settings-grid">
    <section className="panel glass"><h3>Personal preferences</h3><form onSubmit={save} className="stack gap-16">
      <label className="field"><span>Mobile number (with country code)</span><input type="tel" autoComplete="tel" pattern="\+[1-9][0-9]{6,14}" title="Use an international number, such as +96512345678" placeholder="+96512345678" value={form.phone || ''} onChange={e => setForm({...form, phone:e.target.value})}/></label>
      <label className="field"><span>Font</span><select aria-label="Font" value={form.font_family || 'system'} onChange={e => setForm({...form, font_family:e.target.value})}><option value="system">System</option><option value="arial">Arial</option><option value="georgia">Georgia</option><option value="verdana">Verdana</option></select></label>
      <label className="field"><span>Text colour</span><select aria-label="Text colour" value={form.text_color || 'ink'} onChange={e => setForm({...form, text_color:e.target.value})}><option value="ink">Ink</option><option value="charcoal">Charcoal</option><option value="forest">Forest</option></select></label>
      <label className="field"><span>Accent colour</span><input aria-label="Accent colour" type="color" value={form.accent_color || '#0a4173'} onChange={e => setForm({...form, accent_color:e.target.value})}/></label>
      <label className="check-row"><input type="checkbox" checked={!!form.reminders_enabled} onChange={e => setForm({...form, reminders_enabled:e.target.checked})}/><span>Daily transaction reminder</span></label>
      {form.reminders_enabled && <><label className="field"><span>Reminder time (this device's time)</span><input required type="time" value={form.reminder_time || '20:00'} onChange={e => setForm({...form, reminder_time:e.target.value})}/></label><p className="muted">Reminders appear while FlowBudget is open. Browser notifications depend on device permissions.</p><button type="button" className="button ghost" onClick={async () => { if (!('Notification' in window)) return notify('This browser does not support notifications.', 'error'); try { const permission = await Notification.requestPermission(); notify(permission === 'granted' ? 'Browser notifications enabled' : 'In-app reminders remain available') } catch { notify('Notifications are unavailable in this browser.', 'error') } }}>Enable browser notifications</button></>}
      <button className="button primary"><Save/>Save preferences</button>
    </form></section>
    <section className="panel glass"><div className="panel-head"><div><p className="eyebrow">Preferences</p><h3>Display & locale</h3></div></div><form onSubmit={save} className="stack gap-16"><label className="field"><span>Budget name</span><input value={form.display_name||''} onChange={e=>setForm({...form,display_name:e.target.value})}/></label><div className="form-grid two"><label className="field"><span>Currency</span><input value={form.currency||'KWD'} maxLength="6" onChange={e=>setForm({...form,currency:e.target.value.toUpperCase()})}/></label><label className="field"><span>Week starts on</span><select value={form.week_starts_on||'sunday'} onChange={e=>setForm({...form,week_starts_on:e.target.value})}><option value="sunday">Sunday</option><option value="monday">Monday</option></select></label></div><label className="check-row"><input type="checkbox" checked={!!form.compact_numbers} onChange={e=>setForm({...form,compact_numbers:e.target.checked})}/><span>Use compact large numbers where possible</span></label><button className="button primary self-start"><Save/>Save preferences</button></form></section>

    <section className="panel glass"><div className="panel-head"><div><p className="eyebrow">Account</p><h3>Profile & session</h3></div><ShieldCheck className="muted-icon"/></div><div className="security-card"><div className="profile-account-row">{appearance.profile_image?<img className="settings-avatar" src={appearance.profile_image} alt="Profile"/>:<span className="settings-avatar fallback"><Mountain/></span>}<div><strong>{user?.username}</strong><p className="muted">{user?.email} · {user?.role === 'admin' ? 'Administrator' : 'User'} access</p></div></div><div className="button-row"><button className="button ghost small" onClick={()=>profileRef.current?.click()}><Camera/>Change photo</button>{appearance.profile_image&&<button className="button ghost small" onClick={()=>clearAppearance('profile_image')}><X/>Remove</button>}<button className="button ghost small" onClick={lock}>Sign out</button></div><input ref={profileRef} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={pickProfile}/></div></section>

    <section className="panel glass span-2-settings appearance-panel"><div className="panel-head"><div><p className="eyebrow">Personalization</p><h3>Workspace wallpaper</h3></div><Image className="muted-icon"/></div><div className="wallpaper-settings"><div className={`wallpaper-preview ${appearance.wallpaper_image?'has-image':''}`} style={appearance.wallpaper_image?{backgroundImage:`url(${JSON.stringify(appearance.wallpaper_image)})`}:{}}>{!appearance.wallpaper_image&&<><Image/><span>No wallpaper selected</span></>}</div><div className="stack gap-10"><p className="muted">Your wallpaper is private to your account. FlowBudget’s glass panels stay translucent above it.</p><div className="button-row"><button className="button primary small" onClick={()=>wallpaperRef.current?.click()}><Upload/>Choose wallpaper</button>{appearance.wallpaper_image&&<button className="button ghost small" onClick={()=>clearAppearance('wallpaper_image')}><Trash2/>Remove wallpaper</button>}</div><small className="appearance-hint">PNG, JPEG, or WebP · maximum 2.5 MB</small></div><input ref={wallpaperRef} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={pickWallpaper}/></div></section>

    <section className="panel glass span-2-settings"><div className="panel-head"><div><p className="eyebrow">Organization</p><h3>Categories</h3></div><button className="button ghost small" onClick={()=>setCatOpen(true)}><Plus/>Add category</button></div><div className="category-settings">{cats.map(c=><div key={c.id}><span><i style={{background:c.color}}/>{c.name}<small>{c.kind}</small></span><button className="row-icon danger" onClick={()=>removeCat(c)}><Trash2/></button></div>)}</div></section>

    <section className="panel glass"><div className="panel-head"><div><p className="eyebrow">Portability</p><h3>Backup & restore</h3></div></div><p className="muted">Export a JSON snapshot of your workspace. Other users and passwords are never included.</p><div className="stack gap-10"><button className="button ghost full" onClick={exportBackup}><Download/>Export backup</button><button className="button ghost full" onClick={()=>inputRef.current?.click()}><Upload/>Restore backup</button><input ref={inputRef} hidden type="file" accept="application/json,.json" onChange={restore}/></div></section>

    <section className="panel glass"><div className="panel-head"><div><p className="eyebrow">Fresh start</p><h3>Reset workspace</h3></div><RefreshCcw className="muted-icon"/></div><p className="muted">Clear budget activity and extra wallets. Your default Main Wallet stays available at zero, and categories are preserved.</p><button className="button ghost full" onClick={()=>setClearOpen(true)}><RefreshCcw/>Reset workspace</button>{recovery.length>0&&<div className="recovery-list"><small className="muted">Recent recovery copies</small>{recovery.slice(0,3).map(item=><button key={item.id} className="recovery-row" onClick={()=>downloadRecovery(item.id)}><span><strong>{item.reason}</strong><small>{new Date(item.created_at).toLocaleString()}</small></span><Download size={15}/></button>)}</div>}</section>

    <Modal open={catOpen} onClose={()=>setCatOpen(false)} title="Add category"><form onSubmit={addCat} className="stack gap-16"><label className="field"><span>Name</span><input required value={cat.name} onChange={e=>setCat({...cat,name:e.target.value})}/></label><div className="form-grid two"><label className="field"><span>Type</span><select value={cat.kind} onChange={e=>setCat({...cat,kind:e.target.value})}><option value="expense">Expense</option><option value="income">Income</option></select></label><label className="field"><span>Accent</span><input type="color" value={cat.color} onChange={e=>setCat({...cat,color:e.target.value})}/></label></div><div className="modal-actions"><button type="button" className="button ghost" onClick={()=>setCatOpen(false)}>Cancel</button><button className="button primary">Add category</button></div></form></Modal>
    <Modal open={clearOpen} onClose={()=>setClearOpen(false)} title="Reset workspace"><form onSubmit={clearWorkspace} className="stack gap-16"><p className="muted">This only affects your account. Type <strong>CLEAR</strong> to confirm. Categories are never removed by this action. Recovery copy will be available in Settings.</p><label className="field"><span>What should be cleared?</span><select value={clearScope} onChange={e=>setClearScope(e.target.value)}><option value="budget">Budget data and extra wallets</option><option value="workspace">Budget data, extra wallets, and Notes</option></select></label><label className="field"><span>Confirmation</span><input required value={clearConfirm} onChange={e=>setClearConfirm(e.target.value)} placeholder="Type CLEAR" autoComplete="off"/></label><div className="modal-actions"><button type="button" className="button ghost" onClick={()=>setClearOpen(false)}>Cancel</button><button className="button danger" disabled={clearConfirm !== 'CLEAR'}>Reset workspace</button></div></form></Modal>
  </div>
}
