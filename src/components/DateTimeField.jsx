import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, Keyboard } from 'lucide-react'
import { dateInput } from '../lib/time'
import { calendarDate, calendarLabel, dayValue, dialPosition, dialValue, padTime, parseDateTime, timeValue } from '../lib/dateTimePicker'

function PickerDialog({ title, onClose, children }) {
  const ref = useRef(null)
  useEffect(() => {
    const node = ref.current
    const previous = document.activeElement
    node.showModal()
    const back = event => { if (!event.defaultPrevented && node.open) { event.preventDefault(); node.dispatchEvent(new window.Event('cancel', {cancelable:true})) } }
    window.addEventListener('budgetly:back', back)
    return () => { window.removeEventListener('budgetly:back', back); node.close(); if (previous?.isConnected) previous.focus() }
  }, [])
  return createPortal(<dialog ref={ref} className="transaction-picker" aria-label={title}
    onCancel={e => { e.preventDefault(); onClose() }}
    onMouseDown={e => {
      if (e.target !== e.currentTarget) return
      const rect = e.currentTarget.getBoundingClientRect()
      if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) onClose()
    }}>{children}</dialog>, document.body)
}

function DatePicker({ initial, onSave, onClose }) {
  const [picked, setPicked] = useState(initial.date)
  const [view, setView] = useState(() => calendarDate(initial.date.getUTCFullYear(), initial.date.getUTCMonth()))
  const daysRef = useRef(null)
  const focusDay = useRef(false)
  const year = view.getUTCFullYear(), month = view.getUTCMonth()
  const years = [...new Set([...Array.from({ length: 201 }, (_, i) => 1900 + i), picked.getUTCFullYear()])].sort((a, b) => a - b)
  const days = Array.from({ length: 42 }, (_, i) => calendarDate(year, month, 1 - view.getUTCDay() + i))
  const pick = (date, focus = false) => {
    focusDay.current = focus
    setPicked(date)
    setView(calendarDate(date.getUTCFullYear(), date.getUTCMonth()))
  }
  useEffect(() => {
    if (focusDay.current) { daysRef.current?.querySelector('[aria-pressed="true"]')?.focus(); focusDay.current = false }
  }, [picked])
  return <PickerDialog title="Choose date" onClose={onClose}>
    <header className="transaction-picker-head">
      <p className="transaction-picker-label">Select date</p>
      <select className="transaction-picker-year" aria-label="Calendar year" value={picked.getUTCFullYear()} onChange={e => {
        const y = Number(e.target.value), m = picked.getUTCMonth()
        pick(calendarDate(y, m, Math.min(picked.getUTCDate(), calendarDate(y, m + 1, 0).getUTCDate())))
      }}>{years.map(y => <option key={y}>{y}</option>)}</select>
      <h3>{calendarLabel(picked, { weekday: 'short', month: 'short', day: 'numeric' })}</h3>
    </header>
    <div className="transaction-picker-calendar">
      <div className="transaction-picker-month">
        <button type="button" className="transaction-picker-icon" title="Previous month" aria-label="Previous month" disabled={year === 1 && month === 0} onClick={() => setView(calendarDate(year, month - 1))}><ChevronLeft size={20}/></button>
        <strong aria-live="polite">{calendarLabel(view, { month: 'long', year: 'numeric' })}</strong>
        <button type="button" className="transaction-picker-icon" title="Next month" aria-label="Next month" disabled={year === 9999 && month === 11} onClick={() => setView(calendarDate(year, month + 1))}><ChevronRight size={20}/></button>
      </div>
      <div className="transaction-picker-week" aria-hidden="true">{['S','M','T','W','T','F','S'].map((d, i) => <span key={i}>{d}</span>)}</div>
      <div ref={daysRef} className="transaction-picker-days" role="group" aria-label="Days of the month" onKeyDown={e => {
        const offsets = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }
        if (!e.target.dataset.day || !(e.key in offsets)) return
        e.preventDefault()
        const date = new Date(`${e.target.dataset.day}T12:00:00Z`)
        const next = calendarDate(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + offsets[e.key])
        if (next.getUTCFullYear() >= 1 && next.getUTCFullYear() <= 9999) pick(next, true)
      }}>
        {days.map(date => <button type="button" key={date.toISOString()} data-day={dayValue(date)}
          className={date.getUTCMonth() !== month ? 'outside' : ''}
          disabled={date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999}
          aria-label={calendarLabel(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          aria-pressed={dayValue(date) === dayValue(picked)} onClick={() => pick(date, true)}>{date.getUTCDate()}</button>)}
      </div>
    </div>
    <footer className="transaction-picker-actions">
      <button type="button" onClick={onClose}>Cancel</button><button type="button" className="apply" onClick={() => onSave(dayValue(picked))}>Set date</button>
    </footer>
  </PickerDialog>
}

function TimePicker({ initial, onSave, onClose }) {
  const [clock, setClock] = useState(() => ({ hour: initial.hour, minute: initial.minute, period: initial.period }))
  const [phase, setPhase] = useState('hour')
  const [manual, setManual] = useState(false)
  const [typed, setTyped] = useState(() => ({ hour: String(initial.hour), minute: padTime(initial.minute) }))
  const [error, setError] = useState('')
  const dragging = useRef(null)
  const pointerClick = useRef(false)
  const clockRef = useRef(clock)
  const minuteRef = useRef(null)
  const inputRef = useRef(null)
  const inputId = useId()
  const updateClock = next => { clockRef.current = next; setClock(next) }
  const setNumber = number => updateClock({ ...clockRef.current, [phase]: number })
  const readTyped = () => {
    const { hour, minute } = typed
    if (!/^\d{1,2}$/.test(hour) || !/^\d{1,2}$/.test(minute) || Number(hour) < 1 || Number(hour) > 12 || Number(minute) > 59) {
      setError('Use an hour from 1 to 12 and minutes from 00 to 59.'); return false
    }
    setError(''); updateClock({ ...clockRef.current, hour: Number(hour), minute: Number(minute) }); return true
  }
  const showDial = next => {
    if (manual && !readTyped()) return
    setManual(false); setPhase(next)
  }
  useEffect(() => { if (manual) inputRef.current?.focus() }, [manual])
  const position = event => {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = event.clientX - rect.left - rect.width / 2, y = event.clientY - rect.top - rect.height / 2
    if (Math.hypot(x, y) >= rect.width * .1) setNumber(dialValue(x, y, phase === 'hour' ? 12 : 60))
  }
  const numbers = Array.from({ length: 12 }, (_, i) => phase === 'hour' ? i || 12 : i * 5)
  const exact = phase === 'minute' && clock.minute % 5 !== 0
  return <PickerDialog title="Choose time" onClose={onClose}>
    <header className="transaction-picker-head">
      <p className="transaction-picker-label">Select time</p>
      <div className="transaction-picker-digital">
        <button type="button" aria-label="Select hour" aria-pressed={phase === 'hour'} onClick={() => showDial('hour')}>{clock.hour}</button>
        <span>:</span>
        <button ref={minuteRef} type="button" aria-label="Select minutes" aria-pressed={phase === 'minute'} onClick={() => showDial('minute')}>{padTime(clock.minute)}</button>
        <div className="transaction-picker-period" role="group" aria-label="AM or PM">{['AM', 'PM'].map(period => <button key={period} type="button" aria-pressed={clock.period === period} onClick={() => updateClock({ ...clockRef.current, period })}>{period}</button>)}</div>
      </div>
    </header>
    {manual ? <div className="transaction-picker-manual">
      <label htmlFor={`${inputId}-hour`}>Hour<input ref={inputRef} id={`${inputId}-hour`} inputMode="numeric" type="number" min="1" max="12" value={typed.hour} aria-invalid={Boolean(error)} aria-describedby={error ? `${inputId}-error` : undefined} onChange={e => setTyped({ ...typed, hour: e.target.value })}/></label>
      <label htmlFor={`${inputId}-minute`}>Minute<input id={`${inputId}-minute`} inputMode="numeric" type="number" min="0" max="59" value={typed.minute} aria-invalid={Boolean(error)} aria-describedby={error ? `${inputId}-error` : undefined} onChange={e => setTyped({ ...typed, minute: e.target.value })}/></label>
    </div> : <div className="transaction-picker-clock">
      <p aria-live="polite">{phase === 'hour' ? 'Hour' : 'Minutes'}</p>
      <div className="transaction-picker-face" role="group" aria-label={phase === 'hour' ? 'Hour clock dial' : 'Minute clock dial'}
        onPointerDown={e => {
          if (e.isPrimary === false || e.button !== 0) return
          e.preventDefault(); pointerClick.current = true; dragging.current = { id: e.pointerId, previous: clockRef.current }
          e.currentTarget.setPointerCapture(e.pointerId); position(e)
        }}
        onPointerMove={e => { if (dragging.current?.id === e.pointerId) position(e) }}
        onPointerUp={e => {
          if (dragging.current?.id !== e.pointerId) return
          position(e); dragging.current = null
          if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
          if (phase === 'hour') { setPhase('minute'); minuteRef.current?.focus() }
        }}
        onPointerCancel={() => { if (dragging.current) updateClock(dragging.current.previous); dragging.current = null }}
        onKeyDown={e => {
          const steps = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }
          if (!(e.key in steps)) return
          e.preventDefault()
          const count = phase === 'hour' ? 12 : 60, value = (clock[phase] + steps[e.key] + count) % count
          setNumber(phase === 'hour' ? value || 12 : value)
        }}>
        {phase === 'minute' && Array.from({ length: 60 }, (_, i) => <i className="transaction-picker-tick" key={i} aria-hidden="true" style={{ left: `${50 + Math.sin(i * Math.PI / 30) * 45}%`, top: `${50 - Math.cos(i * Math.PI / 30) * 45}%`, height: i % 5 ? 3 : 6, transform: `rotate(${i * 6}deg)` }}/>) }
        <div className="transaction-picker-hand" aria-hidden="true" style={{ transform: `rotate(${clock[phase] * (phase === 'hour' ? 30 : 6)}deg)` }}/>
        {numbers.map((n, i) => {
          const distance = Math.abs(n - clock.minute)
          return <button type="button" key={`${phase}-${n}`} className="transaction-picker-number"
            style={{ ...dialPosition(i, 12), visibility: exact && Math.min(distance, 60 - distance) <= 2 ? 'hidden' : undefined }}
            aria-label={`${n} ${phase === 'hour' ? 'hours' : 'minutes'}`} aria-pressed={n === clock[phase]}
            onClick={e => {
              if (e.detail !== 0 && pointerClick.current) { pointerClick.current = false; return }
              setNumber(n)
              if (phase === 'hour') { setPhase('minute'); minuteRef.current?.focus() }
            }}>{phase === 'hour' ? n : padTime(n)}</button>
        })}
        {exact && <span className="transaction-picker-exact" aria-hidden="true" style={dialPosition(clock.minute, 60)}>{padTime(clock.minute)}</span>}
        <i className="transaction-picker-pivot" aria-hidden="true"/>
      </div>
    </div>}
    {error && <p id={`${inputId}-error`} className="transaction-picker-error" role="alert">{error}</p>}
    <footer className="transaction-picker-actions with-keyboard">
      <button type="button" className="transaction-picker-icon" aria-label={manual ? 'Use clock dial' : 'Type time instead'} title={manual ? 'Use clock dial' : 'Type time instead'} onClick={() => {
        if (manual) showDial(phase)
        else { setTyped({ hour: String(clock.hour), minute: padTime(clock.minute) }); setError(''); setManual(true) }
      }}>{manual ? <Clock3 size={20}/> : <Keyboard size={20}/>}</button>
      <div><button type="button" onClick={onClose}>Cancel</button><button type="button" className="apply" onClick={() => { if (!manual || readTyped()) onSave(timeValue(clockRef.current)) }}>Set time</button></div>
    </footer>
  </PickerDialog>
}

export default function DateTimeField({ value, onChange, disabled = false }) {
  const [picker, setPicker] = useState(null)
  const dateId = useId(), timeId = useId()
  const parsed = parseDateTime(value)
  const close = () => setPicker(null)
  const open = type => setPicker({ type, initial: parsed || parseDateTime(dateInput()), value: parsed ? value : dateInput() })
  return <>
    <div className="transaction-datetime">
      <div><span id={dateId}>Date</span><button type="button" aria-labelledby={dateId} aria-haspopup="dialog" disabled={disabled} onClick={() => open('date')}><CalendarDays size={19}/><span>{parsed ? calendarLabel(parsed.date, { day: 'numeric', month: 'short', year: 'numeric' }) : 'Choose date'}</span></button></div>
      <div><span id={timeId}>Time</span><button type="button" aria-labelledby={timeId} aria-haspopup="dialog" disabled={disabled} onClick={() => open('time')}><Clock3 size={19}/><span>{parsed ? `${parsed.hour}:${padTime(parsed.minute)} ${parsed.period}` : 'Choose time'}</span></button></div>
    </div>
    {picker && !disabled && (picker.type === 'date'
      ? <DatePicker initial={picker.initial} onClose={close} onSave={date => { onChange(date + picker.value.slice(10)); close() }}/>
      : <TimePicker initial={picker.initial} onClose={close} onSave={time => { onChange(picker.value.slice(0, 11) + time); close() }}/>) }
  </>
}
