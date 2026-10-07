import {useState} from 'react'
import {currencyCodes,currencyLabel,validCurrency} from '../lib/currency'

export default function CurrencyField({value,onChange,scope='account'}) {
  const [search,setSearch]=useState(''),[manual,setManual]=useState(''),[error,setError]=useState('')
  const matches=currencyCodes.filter(code=>currencyLabel(code).toLowerCase().includes(search.toLowerCase().trim()))
  const options=[...new Set([value||'KWD',...matches])]
  return <div className="stack gap-12">
    <label className="field"><span>Search currencies</span><input type="search" value={search} onChange={event=>setSearch(event.target.value)} placeholder="Currency name or code"/></label>
    <label className="field"><span>Currency</span><select aria-label="Currency" value={value||'KWD'} onChange={event=>onChange(event.target.value)}>{options.map(code=><option key={code} value={code}>{currencyLabel(code)}</option>)}</select></label>
    {!matches.length&&<small role="status">No matching currencies. Your current selection is kept.</small>}
    <details className="form-options"><summary>Enter currency code manually</summary><div className="stack gap-12"><label className="field"><span>Three-letter currency code</span><input value={manual} maxLength={3} autoCapitalize="characters" onChange={event=>{setManual(event.target.value.toUpperCase().replace(/[^A-Z]/g,''));setError('')}} placeholder="USD"/></label><button type="button" className="button ghost self-start" onClick={()=>{if(!validCurrency(manual)){setError('Enter a supported three-letter currency code.');return}onChange(manual);setSearch('');setError('')}}>Use currency</button>{error&&<small role="alert" className="field-error">{error}</small>}</div></details>
    <small className="muted">{scope === 'space' ? 'Applies only to this space. Add a separate space for another currency.' : 'Applies across your account. Existing amounts are not converted.'}</small>
  </div>
}
