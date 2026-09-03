export default function ProgressBar({ value = 0, warning = false }) {
  const v = Math.max(0, Math.min(Number(value || 0), 100))
  return <div className={`progress ${warning ? 'warning' : ''}`}><span style={{ width: `${v}%` }} /></div>
}
