import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import DateTimeField from './DateTimeField'
import { calendarDate, dialValue, parseDateTime, timeValue } from '../lib/dateTimePicker'
import { dateInput, saveDate } from '../lib/time'

beforeAll(() => {
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true }
  window.HTMLDialogElement.prototype.close = function () { this.open = false }
})
afterEach(cleanup)
function Harness({ initial = '2026-09-14T06:29', onChange = () => {} }) {
  const [value, setValue] = useState(initial)
  return <DateTimeField value={value} onChange={next => { setValue(next); onChange(next) }}/>
}

it('keeps date and time independent and commits only when confirmed', () => {
  const change = vi.fn()
  render(<Harness onChange={change}/> )
  const date = screen.getByRole('button', { name: 'Date', exact: true })
  date.focus(); fireEvent.click(date)
  fireEvent.click(screen.getByRole('button', { name: 'Next month' }))
  fireEvent.click(screen.getByRole('button', { name: 'Wednesday, 21 October 2026' }))
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(change).not.toHaveBeenCalled()
  expect(date).toHaveFocus()
  fireEvent.click(date)
  fireEvent.click(screen.getByRole('button', { name: 'Monday, 21 September 2026' }))
  fireEvent.click(screen.getByRole('button', { name: 'Set date' }))
  expect(change).toHaveBeenLastCalledWith('2026-09-21T06:29')
  fireEvent.click(screen.getByRole('button', { name: 'Time', exact: true }))
  fireEvent.click(screen.getByRole('button', { name: '9 hours' }))
  expect(screen.getByRole('group', { name: 'Minute clock dial' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '15 minutes' }))
  fireEvent.click(screen.getByRole('button', { name: 'PM', exact: true }))
  fireEvent.click(screen.getByRole('button', { name: 'Set time' }))
  expect(change).toHaveBeenLastCalledWith('2026-09-21T21:15')
})

it('supports leap years, year changes, and Escape without changing the field', () => {
  const change = vi.fn()
  render(<Harness initial="2024-02-29T23:59" onChange={change}/> )
  fireEvent.click(screen.getByRole('button', { name: 'Date', exact: true }))
  fireEvent.change(screen.getByLabelText('Calendar year'), { target: { value: '2025' } })
  expect(screen.getByRole('button', { name: 'Friday, 28 February 2025' })).toHaveAttribute('aria-pressed', 'true')
  fireEvent(screen.getByRole('dialog'), new window.Event('cancel', { bubbles: true, cancelable: true }))
  expect(change).not.toHaveBeenCalled()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('validates typed time and handles midnight/noon without a timezone shift', () => {
  const change = vi.fn()
  render(<Harness onChange={change}/> )
  fireEvent.click(screen.getByRole('button', { name: 'Time', exact: true }))
  fireEvent.click(screen.getByRole('button', { name: 'Type time instead' }))
  fireEvent.change(screen.getByLabelText('Hour'), { target: { value: '12' } })
  fireEvent.change(screen.getByLabelText('Minute'), { target: { value: '60' } })
  fireEvent.click(screen.getByRole('button', { name: 'Set time' }))
  expect(screen.getByRole('alert')).toHaveTextContent('00 to 59')
  expect(change).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('Minute'), { target: { value: '00' } })
  fireEvent.click(screen.getByRole('button', { name: 'Set time' }))
  expect(change).toHaveBeenLastCalledWith('2026-09-14T00:00')
  expect(saveDate(change.mock.lastCall[0])).toBe('2026-09-13T21:00:00.000Z')
  expect(dateInput(saveDate(change.mock.lastCall[0]))).toBe('2026-09-14T00:00')
  expect(timeValue({ hour: 12, minute: 0, period: 'PM' })).toBe('12:00')
})

it('rejects invalid calendar values and calculates dial positions through the wraparound', () => {
  expect(parseDateTime('2026-02-29T12:00')).toBeNull()
  expect(parseDateTime('2026-09-14T24:00')).toBeNull()
  expect(parseDateTime('bad')).toBeNull()
  expect(parseDateTime('2024-02-29T12:00')).not.toBeNull()
  expect(calendarDate(2026, 12).toISOString().slice(0, 10)).toBe('2027-01-01')
  expect(dialValue(0, -100, 12)).toBe(12)
  expect(dialValue(-100, 0, 12)).toBe(9)
  expect(dialValue(-1, -100, 60)).toBe(0)
  expect(dialValue(Math.sin(14 * Math.PI / 30) * 100, -Math.cos(14 * Math.PI / 30) * 100, 60)).toBe(14)
})

it('keeps disabled pickers closed', () => {
  render(<DateTimeField value="2026-09-14T06:29" disabled onChange={vi.fn()}/> )
  expect(screen.getByRole('button', { name: 'Date', exact: true })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Time', exact: true })).toBeDisabled()
})
