import { Children, Fragment, isValidElement, useLayoutEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Search } from 'lucide-react'
import Modal from './Modal'
import './AppSelect.css'

// Keep a real select for form values and validation, but open Budgetly's own
// accessible picker instead of the platform's full-screen option sheet.
export default function AppSelect({ children, value, onChange, disabled, required, className = '', ...props }) {
  const native = useRef(null)
  const trigger = useRef(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [invalid, setInvalid] = useState(false)
  const [resolvedLabel, setResolvedLabel] = useState('Choose an option')
  const optionText = node => Children.toArray(node).map(part => isValidElement(part) ? optionText(part.props.children) : String(part)).join('')
  const collect = node => Children.toArray(node).flatMap(part => {
    if (!isValidElement(part)) return []
    if (part.type === 'option') return [{ value: String(part.props.value ?? optionText(part.props.children)), label: optionText(part.props.children), disabled: Boolean(part.props.disabled) }]
    return part.type === Fragment || part.type === 'optgroup' ? collect(part.props.children) : []
  })
  const options = collect(children)
  const selected = options.find(option => String(option.value) === String(value))
  useLayoutEffect(() => {
    const next = props['aria-label'] || native.current?.labels?.[0]?.querySelector('span')?.textContent?.trim() || native.current?.labels?.[0]?.textContent?.trim() || 'Choose an option'
    setResolvedLabel(next)
  }, [props['aria-label']])
  const label = resolvedLabel
  const choose = next => {
    setInvalid(false)
    onChange?.({ target: { value: next }, currentTarget: { value: next } })
    setOpen(false); setQuery('')
    window.requestAnimationFrame(() => trigger.current?.focus())
  }
  return <span className={`app-select ${className}`}>
    <select {...props} ref={native} value={value} onChange={onChange} disabled={disabled} required={required} className="app-select-native" tabIndex={-1} aria-hidden="true" onInvalid={event => { event.preventDefault(); setInvalid(true); trigger.current?.focus(); props.onInvalid?.(event) }}>{children}</select>
    <button ref={trigger} type="button" className="app-select-trigger" role="combobox" aria-label={`Open ${label}`} aria-haspopup="dialog" aria-expanded={open} aria-invalid={invalid || props['aria-invalid']} aria-required={required || undefined} disabled={disabled} onClick={() => { setQuery(''); setOpen(true) }}>
      <span>{selected?.label || options[0]?.label || 'Choose an option'}</span><ChevronDown size={18} aria-hidden="true"/>
    </button>
    {invalid && <small className="field-error">Choose {label.toLowerCase()} before continuing.</small>}
    <Modal open={open} onClose={() => setOpen(false)} title={label} size="small" layerClass="app-select-layer">
      {options.length > 8 && <label className="app-select-search"><Search size={18}/><input autoFocus type="search" aria-label={`Search ${label.toLowerCase()}`} placeholder="Search options" value={query} onChange={event => setQuery(event.target.value)}/></label>}
      <div className="app-select-options" role="listbox" aria-label={label}>{options.filter(option => option.label.toLowerCase().includes(query.toLowerCase())).map((option, index) => <button type="button" role="option" aria-selected={String(value) === String(option.value)} key={`${option.value}-${index}`} disabled={option.disabled} onClick={() => choose(option.value)}>{option.label}{String(value) === String(option.value) && <Check size={18} aria-hidden="true"/>}</button>)}</div>
    </Modal>
  </span>
}
