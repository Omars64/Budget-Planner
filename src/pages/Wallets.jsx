import { useEffect, useState } from 'react'
import { BookOpen, Landmark, Pencil, Plus, Trash2, Star } from 'lucide-react'
import { api, jsonBody, money } from '../lib/api'
import { DynamicIcon } from '../lib/icons'
import { useApp } from '../App'
import Modal from '../components/Modal'
import EmptyState from '../components/EmptyState'
import CardNetworkMark from '../components/CardNetworkMark'
import WalletLedger from '../components/WalletLedger'
import { walletCardStyle } from '../lib/walletCard'
import { useWorkspacePreferences } from '../lib/workspacePreferences'

const CARD_COLORS = [['#3158aa','Blue'],['#267d75','Teal'],['#75465f','Berry'],['#454f59','Graphite'],['#183d36','Emerald'],['#20283e','Midnight'],['#622e40','Burgundy'],['#584071','Amethyst'],['#596575','Titanium'],['#32647a','Ocean'],['#763d51','Rose'],['#35393c','Onyx']]
const fresh=()=>({name:'',type:'cash',initial_balance:0,icon:'wallet',color:'#3158aa',card_network:null,archived:false})
export default function Wallets(){
  const {user,settings,refreshKey,refresh,notify,confirm}=useApp(); const [rows,setRows]=useState([]); const [open,setOpen]=useState(false); const [editing,setEditing]=useState(null); const [form,setForm]=useState(fresh()); const [error,setError]=useState('')
  const [saving,setSaving]=useState(false)
  const [ledgerWallet,setLedgerWallet]=useState(null)
  const [preferences,savePreferences]=useWorkspacePreferences(user?.id)
  const orderedRows=[...rows].sort((a,b)=>Number(preferences.favoriteWallets.includes(b.id))-Number(preferences.favoriteWallets.includes(a.id)))
  useEffect(()=>{
    const controller = new window.AbortController()
    setError('')
    api('/api/wallets', {signal: controller.signal}).then(value => { if (!controller.signal.aborted) setRows(value) }).catch(err => { if (!controller.signal.aborted) setError(err.message) })
    return () => controller.abort()
  },[refreshKey]); const fmt=v=>money(v,settings.currency,settings.compact_numbers); const total=rows.filter(w=>!w.archived).reduce((a,w)=>a+w.balance,0)
  const show=(w=null)=>{setEditing(w);setForm(w?{...w,card_network:w.card_network || (['bank','card'].includes(w.type)?'visa':null)}:fresh());setOpen(true);setError('')}
  const setType=type=>setForm(current=>({...current,type,card_network:['bank','card'].includes(type)?current.card_network || 'visa':null}))
  const submit=async e=>{e.preventDefault();if(saving)return;setSaving(true);try{await api(editing?`/api/wallets/${editing.id}`:'/api/wallets',{method:editing?'PUT':'POST',...jsonBody({...form,initial_balance:Number(form.initial_balance)})});setOpen(false);refresh();notify(editing?'Wallet updated':'Wallet added')}catch(err){setError(err.message)}finally{setSaving(false)}}
  const remove=async w=>{
    if(!await confirm(`Delete ${w.name}? A recovery copy will be saved first.`))return
    try {
      await api(`/api/wallets/${w.id}`,{method:'DELETE'})
      refresh(); notify('Wallet deleted')
    } catch(err) {
      if (err.status === 409 && await confirm(`${w.name} still has transactions. Delete the wallet and all of its linked transactions? A recovery copy will be saved first.`)) {
        try { await api(`/api/wallets/${w.id}?delete_transactions=true`,{method:'DELETE'}); refresh(); notify('Wallet and linked transactions deleted') }
        catch (deleteErr) { notify(deleteErr.message,'error') }
      } else notify(err.message,'error')
    }
  }
  return <div className="stack gap-22">
    {error && <div className="form-error" role="alert">{error}<button className="button ghost small" onClick={()=>refresh()}>Retry</button></div>}
    <section className="wallet-hero glass"><div><p className="eyebrow">Available money</p><h1>{fmt(total)}</h1><p className="muted">Across {rows.filter(w=>!w.archived).length} active wallets</p></div><span className="wallet-orbit"><Landmark/></span></section>
    <div className="section-row"><div><p className="eyebrow">Accounts & cash</p><h3>Your wallets</h3></div><button className="button primary" onClick={()=>show()}><Plus/>Add wallet</button></div>
    <section className="wallet-grid">{rows.length ? orderedRows.map(w => {
      const card = ['bank','card'].includes(w.type)
      return <article className={'wallet-tile ' + (w.archived ? 'archived' : '')} key={w.id}>
        <div className={'wallet-card ' + (card ? 'payment-card' : '')} style={walletCardStyle(w.color)} onDoubleClick={() => show(w)}>
          <div className="card-top"><span className="round-icon" style={{color:w.color}}><DynamicIcon name={w.icon} size={21}/></span><span className="wallet-type">{w.type}{w.is_shared ? ' · Shared' : ''}</span></div>
          <div className="wallet-card-balance"><p className="muted">{w.archived ? 'Archived' : 'Available balance'}</p><h2>{fmt(w.balance)}</h2><strong>{w.name}</strong></div>
          {card && <CardNetworkMark network={w.card_network || 'visa'}/>}
        </div>
        <div className="wallet-tile-actions"><button className="icon-button wallet-favorite" aria-label={`Favorite ${w.name}`} title="Favorite wallet" aria-pressed={preferences.favoriteWallets.includes(w.id)} onClick={() => { const ids=preferences.favoriteWallets.includes(w.id) ? preferences.favoriteWallets.filter(id=>id!==w.id) : [...preferences.favoriteWallets,w.id]; if(!savePreferences({favoriteWallets:ids})) notify('Favorites could not be saved on this device.','error') }}><Star size={18}/></button>
          <button className="button ghost small" onClick={() => setLedgerWallet(w)}><BookOpen size={16}/>Ledger</button>
          <button className="icon-button" aria-label={`Edit ${w.name}`} title="Edit wallet" onClick={() => show(w)}><Pencil size={18}/></button>
          <button className="icon-button danger" aria-label={`Delete ${w.name}`} title="Delete wallet" onClick={() => remove(w)}><Trash2 size={18}/></button>
        </div>
      </article>
    }) : <div className="panel glass full-span"><EmptyState/></div>}</section>
    <WalletLedger wallet={ledgerWallet} shared={Boolean(ledgerWallet?.is_shared)} onClose={()=>setLedgerWallet(null)}/>
    <Modal protectChanges open={open} onClose={()=>setOpen(false)} title={editing?'Edit wallet':'Add wallet'}><form onSubmit={submit} className="stack gap-16"><label className="field"><span>Name</span><input required value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Main bank"/></label><div className="form-grid two"><label className="field"><span>Type</span><select value={form.type} onChange={e=>setType(e.target.value)}><option value="cash">Cash</option><option value="bank">Bank</option><option value="card">Card</option><option value="digital">Digital wallet</option></select></label><label className="field"><span>{editing?'Opening balance':'Current starting balance'}</span><input type="number" step="0.001" value={form.initial_balance} onChange={e=>setForm({...form,initial_balance:e.target.value})}/></label></div>{['bank','card'].includes(form.type)&&<div className="wallet-card-editor"><div className="stack gap-16"><fieldset className="wallet-card-setting"><legend>Card network</legend><div className="wallet-network-options"><button type="button" className={form.card_network==='visa'?'selected':''} aria-pressed={form.card_network==='visa'} onClick={()=>setForm({...form,card_network:'visa'})}><CardNetworkMark network="visa"/></button><button type="button" className={form.card_network==='mastercard'?'selected':''} aria-pressed={form.card_network==='mastercard'} onClick={()=>setForm({...form,card_network:'mastercard'})}><CardNetworkMark network="mastercard"/></button></div></fieldset><fieldset className="wallet-card-setting"><legend>Card color</legend><div className="wallet-color-options">{CARD_COLORS.map(([color,label])=><button key={color} type="button" className={form.color===color?'selected':''} aria-label={label} aria-pressed={form.color===color} style={{'--swatch':color}} onClick={()=>setForm({...form,color})}/>)}<label className="wallet-custom-color"><span>Custom color</span><input aria-label="Custom card color" type="color" value={form.color} onChange={e=>setForm({...form,color:e.target.value})}/></label></div></fieldset></div><article className="wallet-card-preview" style={walletCardStyle(form.color)}><div><span>Budgetly</span><span className="preview-chip"/></div><strong>{money(form.initial_balance,settings.currency)}</strong><footer><span>{form.name || 'Wallet name'}</span><CardNetworkMark network={form.card_network || 'visa'}/></footer></article></div>}<p className="form-note">A positive starting balance is recorded once as opening-balance income. Editing it updates the same entry.</p>{error&&<div className="form-error">{error}</div>}<div className="modal-actions"><button type="button" className="button ghost" onClick={()=>setOpen(false)}>Cancel</button><button className="button primary" disabled={saving}>{saving?'Saving...':'Save wallet'}</button></div></form></Modal>
  </div>
}
