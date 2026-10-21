import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import UpcomingReminderPreferences from './UpcomingReminderPreferences'
function Editor() {
  const [form,setForm] = useState({upcoming_reminders_enabled:true,upcoming_reminder_days:2,upcoming_reminder_time:'09:00'})
  return <UpcomingReminderPreferences form={form} setForm={setForm}/>
}
afterEach(cleanup)
it('supports calendar days and a minute-based lead time without losing the calendar choice', () => {
  render(<Editor/> )
  expect(screen.getByLabelText('Days before')).toHaveValue(2)
  fireEvent.change(screen.getByLabelText('Reminder timing'),{target:{value:'before'}})
  expect(screen.getByLabelText('How long before?')).toHaveValue('1440')
  fireEvent.change(screen.getByLabelText('How long before?'),{target:{value:'custom'}})
  expect(screen.getByLabelText('Minutes before')).toHaveValue(1440)
  fireEvent.change(screen.getByLabelText('Minutes before'),{target:{value:'90'}})
  fireEvent.change(screen.getByLabelText('Reminder timing'),{target:{value:'calendar'}})
  expect(screen.getByLabelText('Days before')).toHaveValue(2)
  fireEvent.click(screen.getByRole('checkbox',{name:'Remind me about planned expenses'}))
  expect(screen.queryByLabelText('Reminder timing')).not.toBeInTheDocument()
})
