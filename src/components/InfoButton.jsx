import { Info } from 'lucide-react'

export default function InfoButton({ label, onClick }) {
  return <button type="button" className="icon-button compact-info-button" aria-label={label} title={label} aria-haspopup="dialog" onClick={onClick}>
    <Info size={18} aria-hidden="true"/>
  </button>
}
