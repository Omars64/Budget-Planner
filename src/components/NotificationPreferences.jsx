import {useState} from 'react'
import {BellRing} from 'lucide-react'
import {testNotification,isNativeApp} from '../lib/deviceNotifications'
import {useApp} from '../App'
import { TimeField } from './DateTimeField'
import UpdateDelivery from './UpdateDelivery'

export default function NotificationPreferences({form,setForm}) {
  const {isGuest}=useApp()
  return <><label className="check-row"><input type="checkbox" checked={form.update_notifications_enabled !== false} onChange={event => setForm({...form, update_notifications_enabled:event.target.checked})}/><span>New Budgetly updates</span></label>{!isGuest && <><label className="check-row"><input type="checkbox" checked={!!form.scheduled_notifications_enabled} onChange={event=>setForm({...form,scheduled_notifications_enabled:event.target.checked})}/><span>Scheduled entries recorded</span></label><UpdateDelivery/></>}<ReminderPreferences form={form} setForm={setForm}/></>
}
function ReminderPreferences({form,setForm}){
  const {notify}=useApp()
  const [busy,setBusy]=useState(false)
  const [permission,setPermission]=useState(()=>isNativeApp()?'Check with test notification':('Notification' in window?window.Notification.permission:'unsupported'))
  return <div className="stack gap-12"><p className="muted">Time zone: Kuwait (UTC+03:00). Notification permission: {permission}. {isNativeApp()?'Android reminders repeat even when Budgetly is closed. Battery-saving settings may delay delivery.':'Browser reminders require Budgetly to be open. Closed-browser delivery is unavailable.'}</p><button type="button" className="button ghost" disabled={busy} onClick={async()=>{setBusy(true);try{await testNotification();notify('Test notification sent');setPermission('granted')}catch(e){notify(e.message,'error');if('Notification' in window)setPermission(window.Notification.permission)}finally{setBusy(false)}}}><BellRing size={16}/>{busy?'Sending...':'Send test notification'}</button><label className="check-row"><input type="checkbox" checked={!!form.quiet_hours_enabled} onChange={e=>setForm({...form,quiet_hours_enabled:e.target.checked})}/>Quiet hours</label>{form.quiet_hours_enabled&&<div className="form-grid two"><TimeField label="Quiet hours start (Kuwait)" value={form.quiet_start||'22:00'} onChange={value=>setForm({...form,quiet_start:value})}/><TimeField label="Quiet hours end (Kuwait)" value={form.quiet_end||'08:00'} onChange={value=>setForm({...form,quiet_end:value})}/></div>}<fieldset><legend>Reminder topics</legend>{[['daily','Transaction entry'],['budgets','Budget limits'],['bills','Recurring bills'],['debts','Debt payments']].map(([key,label])=><label className="check-row" key={key}><input type="checkbox" checked={(form.reminder_topics||['daily']).includes(key)} onChange={e=>setForm({...form,reminder_topics:e.target.checked?[...(form.reminder_topics||['daily']),key]:(form.reminder_topics||['daily']).filter(x=>x!==key)})}/>{label}</label>)}</fieldset></div>
}
