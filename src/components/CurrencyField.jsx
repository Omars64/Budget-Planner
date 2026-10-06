import {currencyCodes,currencyLabel} from '../lib/currency'

export default function CurrencyField({value,onChange}) {
  return <label className="field"><span>Currency</span><select aria-label="Currency" value={value||'KWD'} onChange={event=>onChange(event.target.value)}>{currencyCodes.map(code=><option key={code} value={code}>{currencyLabel(code)}</option>)}</select><small className="muted">Applies across your account. Existing amounts are not converted.</small></label>
}
