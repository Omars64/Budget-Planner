import { useId } from 'react'

export default function ReportingMonthField({ value, onChange, type, error, disabled = false }) {
  const id = useId()
  const helpId = 'reporting-month-help-' + id
  const errorId = 'reporting-month-error-' + id
  const required = type === 'income'
  return <label className="field reporting-month-field">
    <span>Month this is for{required ? ' (required)' : ' (optional)'}</span>
    <input
      type="month"
      aria-label="Month this is for"
      aria-invalid={Boolean(error)}
      aria-describedby={error ? errorId : helpId}
      required={required}
      value={value || ''}
      onChange={event => onChange(event.target.value)}
      disabled={disabled}
    />
    {error
      ? <small id={errorId} className="field-error">{error}</small>
      : <small id={helpId} className="muted">{required ? 'Choose the month this money is for.' : 'Leave blank to use the date above.'}</small>}
  </label>
}
