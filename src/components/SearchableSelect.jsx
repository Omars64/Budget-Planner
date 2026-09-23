import { useId, useState } from 'react'

// Retain the native picker and keyboard behavior; search narrows long lists.
export default function SearchableSelect({ label, value, onChange, options, recentKey, disabled, error, placeholder = 'Choose an option' }) {
  const id = useId()
  const [search, setSearch] = useState('')
  const [recent, setRecent] = useState(() => { try { const value = JSON.parse(localStorage.getItem(recentKey)); return Array.isArray(value) ? value : [] } catch { return [] } })
  const rows = options.filter(option => String(option.value) === String(value) || option.label.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const rank = item => { const i = recent.indexOf(String(item.value)); return i < 0 ? 100 : i }
      return rank(a) - rank(b)
    })
  return <div className="field searchable-field">
    <label htmlFor={id}>{label}</label>
    {options.length > 6 && <input type="search" aria-label={`Search ${label.toLowerCase()}`} placeholder="Search..." value={search} disabled={disabled} onChange={e => setSearch(e.target.value)}/>}
    <select id={id} aria-label={label} value={value} disabled={disabled} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} onChange={e => {
      onChange(e.target.value)
      const next = [e.target.value, ...recent.filter(v => v !== e.target.value)].slice(0, 5)
      setRecent(next); setSearch('')
      try { if (recentKey) localStorage.setItem(recentKey, JSON.stringify(next)) } catch { /* Choosing a field never requires storage. */ }
    }}>
      <option value="">{placeholder}</option>
      {rows.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
    {error && <small id={`${id}-error`} className="field-error">{error}</small>}
  </div>
}
