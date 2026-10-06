import { useRef, useState } from 'react'
import { Upload, Download } from 'lucide-react'
import Modal from './Modal'
import { api, jsonBody, money } from '../lib/api'
import { useApp } from '../App'

export default function StatementImport({wallets, compact=false}) {
  const {settings,refresh,notify}=useApp()
  const [open,setOpen]=useState(false),[wallet,setWallet]=useState(''),[text,setText]=useState('')
  const [rows,setRows]=useState([]),[selected,setSelected]=useState([]),[matches,setMatches]=useState({})
  const [busy,setBusy]=useState(false),[error,setError]=useState('')
  const operation=useRef(false),fileVersion=useRef(0)
  const reset=()=>{setRows([]);setSelected([]);setMatches({})}
  async function preview(event) {
    event.preventDefault();if(operation.current)return
    operation.current=true;setBusy(true);setError('')
    try{const result=await api('/api/statements/preview',{method:'POST',...jsonBody({text,wallet_id:Number(wallet)})});setRows(result);setMatches({});setSelected(result.filter(row=>!row.error&&!row.duplicate&&!row.candidates?.length).map(row=>row.line))}
    catch(failure){setError(failure.message)}finally{operation.current=false;setBusy(false)}
  }
  async function save() {
    if(operation.current)return
    operation.current=true;setBusy(true);setError('')
    try{
      const transactions=rows.filter(row=>selected.includes(row.line)).map(row=>({...row.transaction,matched_transaction_id:matches[row.line]?Number(matches[row.line]):null}))
      const result=await api('/api/statements/import',{method:'POST',...jsonBody({transactions})})
      notify(`${result.imported} imported; ${result.matched||0} matched; ${result.skipped} duplicates skipped`)
      setOpen(false);setText('');reset();refresh()
    }catch(failure){setError(failure.message)}finally{operation.current=false;setBusy(false)}
  }
  return <>
    <button className={compact?'icon-button':'button ghost'} title="Import statement" aria-label="Import statement" onClick={()=>setOpen(true)}><Upload size={18}/>{!compact&&'Import statement'}</button>
    <Modal open={open} protectChanges isDirty={Boolean(text)} onClose={()=>!operation.current&&setOpen(false)} title="Review bank statement" size="large">
      <form className="stack gap-16" onSubmit={preview}>
        <details><summary>CSV format</summary><p className="muted">Date, description, amount, type (income or expense). Dates use YYYY-MM-DD or YYYY-MM-DDTHH:mm in Kuwait time. Up to 500 rows.</p><a href="/statement-example.csv" download className="button ghost"><Download size={16}/>Example CSV</a></details>
        <label className="field"><span>Wallet</span><select required disabled={busy} value={wallet} onChange={event=>{setWallet(event.target.value);reset()}}><option value="">Choose wallet</option>{wallets.filter(item=>!item.archived).map(item=><option value={item.id} key={item.id}>{item.name} · {money(item.balance,settings.currency)}</option>)}</select></label>
        <label className="field"><span>CSV statement</span><input required disabled={busy} type="file" accept=".csv,text/csv" onChange={async event=>{
          const file=event.target.files?.[0],version=++fileVersion.current;reset();setText('');setError('')
          if(!file)return
          if(file.size>1000000){setError('Choose a CSV smaller than 1 MB');return}
          try{const content=await file.text();if(version===fileVersion.current)setText(content)}catch{if(version===fileVersion.current)setError('Could not read this file.')}
        }}/></label>
        <button className="button ghost" disabled={busy||!text||!wallet}>{busy?'Processing...':'Preview rows'}</button>
      </form>
      {error&&<p className="form-error" role="alert">{error}</p>}
      {!!rows.length&&<div className="stack gap-16">
        <p className="muted">Matching keeps the existing record unchanged and does not add another transaction.</p>
        <div className="import-preview">{rows.map(row=><div className="security-item stack gap-10" key={row.line}>
          <label className="check-row"><input type="checkbox" disabled={busy||!!row.error||row.duplicate} checked={selected.includes(row.line)} onChange={event=>setSelected(current=>event.target.checked?[...current,row.line]:current.filter(line=>line!==row.line))}/><span>Row {row.line}: {row.error||`${row.transaction.description} · ${money(row.transaction.amount,settings.currency)} · ${row.transaction.date.slice(0,10)}`}{row.duplicate?' · Already recorded':''}</span></label>
          {!row.error&&!row.duplicate&&row.candidates?.length>0&&<label className="field"><span>Possible match for row {row.line}</span><select disabled={busy||!selected.includes(row.line)} value={matches[row.line]||''} onChange={event=>setMatches(current=>({...current,[row.line]:event.target.value}))}><option value="">Add as a separate transaction</option>{row.candidates.map(item=><option key={item.id} value={item.id}>Match {item.description} · {item.date.slice(0,10)} · #{item.id}</option>)}</select></label>}
        </div>)}</div>
        <button type="button" className="button primary" disabled={busy||!selected.length} onClick={save}>{busy?'Saving...':`Confirm ${selected.length} rows`}</button>
      </div>}
    </Modal>
  </>
}
