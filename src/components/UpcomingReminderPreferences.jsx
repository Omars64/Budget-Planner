import { useState } from 'react'
import { TimeField } from './DateTimeField'

const leadTimes = [[15,'15 minutes'],[30,'30 minutes'],[60,'1 hour'],[120,'2 hours'],[360,'6 hours'],[1440,'1 day'],[2880,'2 days'],[10080,'1 week'],[20160,'2 weeks'],[43200,'30 days']]

export default function UpcomingReminderPreferences({form, setForm}) {
  const [custom, setCustom] = useState(() => !leadTimes.some(([value]) => value === (form.upcoming_reminder_minutes ?? 1440)))
  return <div className="stack gap-12">
    <h4>Upcoming expenses</h4>
    <label className="check-row"><input type="checkbox" role="switch" aria-label="Remind me about planned expenses" checked={!!form.upcoming_reminders_enabled} onChange={event => setForm({...form, upcoming_reminders_enabled:event.target.checked})}/><span>Remind me about planned expenses<small className="settings-control-description">Include the expense name before it is due.</small></span></label>
    {form.upcoming_reminders_enabled && <>
      <label className="field"><span>Reminder timing</span><select value={form.upcoming_reminder_mode || 'calendar'} onChange={event => setForm({...form, upcoming_reminder_mode:event.target.value})}><option value="calendar">Days before, at a chosen time</option><option value="before">Time before the expense</option></select></label>
      {form.upcoming_reminder_mode === 'before' ? <div className="stack gap-12"><label className="field"><span>How long before?</span><select value={custom ? 'custom' : form.upcoming_reminder_minutes ?? 1440} onChange={event => { setCustom(event.target.value === 'custom'); if (event.target.value !== 'custom') setForm({...form, upcoming_reminder_minutes:Number(event.target.value)}) }}>{leadTimes.map(([value,label]) => <option key={value} value={value}>{label}</option>)}<option value="custom">Custom</option></select></label>{custom && <label className="field"><span>Minutes before</span><input type="number" required min="1" max="43200" step="1" value={form.upcoming_reminder_minutes ?? 1440} onChange={event => setForm({...form, upcoming_reminder_minutes:event.target.value === '' ? '' : Number(event.target.value)})}/></label>}</div> : <div className="form-grid two">
        <label className="field"><span>Days before</span><input type="number" required min="0" max="30" step="1" value={form.upcoming_reminder_days ?? 1} onChange={event => setForm({...form, upcoming_reminder_days:event.target.value === '' ? '' : Number(event.target.value)})}/></label>
        <TimeField label="At what time? (Kuwait)" value={form.upcoming_reminder_time || '09:00'} onChange={value => setForm({...form, upcoming_reminder_time:value})}/>
      </div>}
    </>}
  </div>
}
