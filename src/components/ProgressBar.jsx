export default function ProgressBar({ value = 0, warning = false }) {
  const v = Math.max(0, Math.min(Number(value || 0), 100))
  return <div className={`progress ${warning ? 'warning' : ''}`} role="progressbar" aria-label="Progress" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${v}%` }} /></div>
}
