import { useLayoutEffect, useRef, useState } from 'react'
import { CalendarDays } from 'lucide-react'
import Modal from './Modal'
import { dateInput } from '../lib/time'
import './AppSelect.css'

const names = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export default function AppMonthField({ value, onChange, required, disabled, min = '1900-01', max = '9999-12', emptyLabel = 'Choose month', ...props }) {
  const input = useRef(null)
  const trigger = useRef(null)
  const [open, setOpen] = useState(false)
  const [year, setYear] = useState(() => Number((value || dateInput().slice(0, 7)).slice(0, 4)))
  const [invalid, setInvalid] = useState(false)
  const [label, setLabel] = useState(props['aria-label'] || 'Month')
  useLayoutEffect(() => {
    setLabel(props['aria-label'] || input.current?.labels?.[0]?.querySelector('span')?.textContent?.trim() || 'Month')
  }, [props['aria-label']])
  const selected = /^\d{4}-\d{2}$/.test(value || '') ? `${names[Number(value.slice(5)) - 1]} ${value.slice(0, 4)}` : emptyLabel
  const choose = next => { setInvalid(false); onChange?.({ target: { value: next }, currentTarget: { value: next } }); setOpen(false); window.requestAnimationFrame(() => trigger.current?.focus()) }
  return <span className="app-month">
    <input {...props} ref={input} type="month" value={value || ''} onChange={onChange} min={min} max={max} required={required} disabled={disabled} tabIndex={-1} aria-hidden="true" className="app-select-native" onInvalid={event => { event.preventDefault(); setInvalid(true); trigger.current?.focus(); props.onInvalid?.(event) }}/>
    <button ref={trigger} type="button" className="app-select-trigger" aria-label={`Open ${label}`} aria-haspopup="dialog" aria-expanded={open} aria-required={required || undefined} disabled={disabled} onClick={() => { setYear(Number((value || dateInput().slice(0, 7)).slice(0, 4))); setOpen(true) }}><span>{selected}</span><CalendarDays size={18} aria-hidden="true"/></button>
    {invalid && <small className="field-error">Choose {label.toLowerCase()} before continuing.</small>}
    <Modal open={open} onClose={() => setOpen(false)} title={label} size="small" layerClass="app-select-layer">
      <div className="app-month-picker"><label className="field"><span>Year</span><input type="number" inputMode="numeric" min={Number(min.slice(0, 4))} max={Number(max.slice(0, 4))} value={year} onChange={event => setYear(Number(event.target.value))}/></label>
        <div className="app-month-grid" role="group" aria-label="Months">{names.map((name, index) => { const next = `${String(year).padStart(4, '0')}-${String(index + 1).padStart(2, '0')}`; return <button type="button" key={name} disabled={!Number.isInteger(year) || next < min || next > max} aria-pressed={next === value} onClick={() => choose(next)}>{name}</button> })}</div>
        {!required && <button type="button" className="button ghost" onClick={() => choose('')}>{emptyLabel === 'Choose month' ? 'Clear month' : emptyLabel}</button>}
      </div>
    </Modal>
  </span>
}
