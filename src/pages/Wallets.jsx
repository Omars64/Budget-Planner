import AppSelect from '../components/AppSelect'
import { useEffect, useEffectEvent, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import '../everyday-money.css'
import { ArrowLeft, ChevronDown, Pencil, Trash2, Star } from 'lucide-react'
import { api, jsonBody, money } from '../lib/api'
import { useApp } from '../App'
import Modal from '../components/Modal'
import EmptyState from '../components/EmptyState'
import CardNetworkMark from '../components/CardNetworkMark'
import WalletLedger from '../components/WalletLedger'
import WalletCardArt from '../components/WalletCardArt'
import TransactionModal from '../components/TransactionModal'
import { useWorkspacePreferences } from '../lib/workspacePreferences'

const CARD_COLORS = [['#3158aa','Blue'],['#267d75','Teal'],['#75465f','Berry'],['#454f59','Graphite'],['#183d36','Emerald'],['#20283e','Midnight'],['#622e40','Burgundy'],['#584071','Amethyst'],['#596575','Titanium'],['#32647a','Ocean'],['#763d51','Rose'],['#35393c','Onyx']]
const fresh=()=>({name:'',type:'cash',initial_balance:0,icon:'wallet',color:'#3158aa',card_network:null,card_finish:'cream',archived:false})
export default function Wallets(){
  const location = useLocation()
  const [params, setParams] = useSearchParams()
  const {user,settings,refreshKey,refresh,notify,confirm,isGuest,requestSignIn,canManage=true,canAdd=true,activeSpace}=useApp(); const [rows,setRows]=useState([]); const [open,setOpen]=useState(false); const [editing,setEditing]=useState(null); const [form,setForm]=useState(fresh()); const [error,setError]=useState('')
  const [saving,setSaving]=useState(false)
  const walletId = params.has('wallet') ? Number(params.get('wallet')) : location.state?.walletId ?? null
  const setWalletId = id => setParams(id == null ? {} : {wallet:String(id)}, {replace:id == null, state:null})
  const [entryType,setEntryType]=useState(null)
  const [loaded,setLoaded]=useState(false)
  const ledgerWallet = rows.find(row => row.id === walletId)
  const [preferences,savePreferences]=useWorkspacePreferences(user?.id)
  const orderedRows=[...rows].sort((a,b)=>Number(preferences.favoriteWallets.includes(b.id))-Number(preferences.favoriteWallets.includes(a.id)))
  useEffect(()=>{
    const controller = new window.AbortController()
    setError('')
    api('/api/wallets', {signal: controller.signal}).then(value => { if (!controller.signal.aborted) { setRows(value); setLoaded(true) } }).catch(err => { if (!controller.signal.aborted) setError(err.message) })
    return () => controller.abort()
  },[refreshKey]); const fmt=v=>money(v,settings.currency,settings.compact_numbers)
  const show=(w=null)=>{if(isGuest && !w && rows.filter(w=>!w.archived).length>=2){requestSignIn('more than two wallets');return}setEditing(w);setForm(w?{...w,card_finish:w.card_finish ?? null,card_network:w.card_network || (['bank','card'].includes(w.type)?'visa':null)}:fresh());setOpen(true);setError('')}
  const addWallet = useEffectEvent(() => { if (canManage && !walletId) show() })
  useEffect(() => {
    const openWalletEditor = () => addWallet()
    window.addEventListener('budgetly:add-wallet', openWalletEditor)
    return () => window.removeEventListener('budgetly:add-wallet', openWalletEditor)
  }, [])
  const setType=type=>setForm(current=>({...current,type,card_network:['bank','card'].includes(type)?current.card_network || 'visa':null}))
  const submit=async e=>{e.preventDefault();if(saving)return;setSaving(true);try{await api(editing?`/api/wallets/${editing.id}`:'/api/wallets',{method:editing?'PUT':'POST',...jsonBody({...form,initial_balance:Number(form.initial_balance)})});setOpen(false);refresh();notify(editing?'Wallet updated':'Wallet added')}catch(err){setError(err.message)}finally{setSaving(false)}}
  const remove=async w=>{
    if(!await confirm(isGuest ? `Delete ${w.name} from this device? Guest deletions cannot be recovered.` : `Delete ${w.name}? A recovery copy will be saved first.`))return
    try {
      await api(`/api/wallets/${w.id}`,{method:'DELETE'})
      setWalletId(null); refresh(); notify('Wallet deleted')
    } catch(err) {
      if (err.status === 409 && await confirm(`${w.name} still has transactions. Delete the wallet and all of its linked transactions? ${isGuest ? 'This cannot be undone.' : 'A recovery copy will be saved first.'}`)) {
        try { await api(`/api/wallets/${w.id}?delete_transactions=true`,{method:'DELETE'}); setWalletId(null); refresh(); notify('Wallet and linked transactions deleted') }
        catch (deleteErr) { notify(deleteErr.message,'error') }
      } else notify(err.message,'error')
    }
  }
  const canRecord = canAdd && ledgerWallet && !ledgerWallet.archived && (activeSpace || !ledgerWallet.is_shared)
  const isFavorite = preferences.favoriteWallets.includes(walletId)
  const toggleFavorite = () => {
    const ids = isFavorite ? preferences.favoriteWallets.filter(id => id !== walletId) : [...preferences.favoriteWallets,walletId]
    if (!savePreferences({favoriteWallets:ids})) notify('Favorites could not be saved on this device.','error')
  }
  return <div className="stack gap-22 everyday-page everyday-wallets">
    {error && <div className="form-error" role="alert">{error}<button className="button ghost small" onClick={()=>refresh()}>Retry</button></div>}
    {walletId == null ? <><h3 className="wallet-list-title">Your wallets</h3>
    <section className="budgetly-wallet-grid" aria-label="Your wallets">{rows.length ? orderedRows.map(w =>
      <button type="button" className="budgetly-wallet-tile" aria-label={`Open ${w.name} wallet`} key={w.id} onClick={() => setWalletId(w.id)}>
        <WalletCardArt wallet={w}/>
        <span className="budgetly-wallet-caption"><span><strong>{w.name}</strong><small>{w.archived ? 'Archived' : w.type}</small></span><strong>{fmt(w.balance)}</strong></span>
      </button>
    ) : loaded ? <div className="panel glass full-span"><EmptyState/></div> : <div className="list-skeleton"><i/><i/></div>}</section></> : <>
    <WalletLedger embedded wallet={ledgerWallet} shared={Boolean(ledgerWallet?.is_shared)} onClose={()=>setWalletId(null)}
      onAdd={canRecord ? () => setEntryType('expense') : undefined}
      onTransfer={canRecord && rows.some(w => w.id !== walletId && !w.archived && (activeSpace || !w.is_shared)) ? () => setEntryType('transfer') : undefined}
      management={ledgerWallet && <details className="wallet-management"><summary>Manage wallet <ChevronDown size={15}/></summary><div className="button-row">
        <button type="button" className="button ghost small" aria-pressed={isFavorite} onClick={toggleFavorite}><Star size={16}/>{isFavorite ? 'Remove favorite' : 'Favorite'}</button>
        {canManage && <><button type="button" className="button ghost small" aria-label={`Edit ${ledgerWallet.name}`} onClick={() => show(ledgerWallet)}><Pencil size={16}/>Edit wallet</button>
        <button type="button" className="button ghost small danger" onClick={() => remove(ledgerWallet)}><Trash2 size={16}/>Delete wallet</button></>}
      </div></details>}/>
    {!ledgerWallet && <div className="palette-dark-section"><Link to="/wallets"><ArrowLeft size={16}/> All wallets</Link><p role="status">{loaded ? 'This wallet is unavailable in this workspace.' : 'Loading wallet…'}</p></div>}
    </>}
    {entryType && ledgerWallet && <TransactionModal open entryWallet={walletId} entryType={entryType} onClose={() => setEntryType(null)}
      onSaved={(saved,scheduled) => {setEntryType(null); refresh(); notify(saved.queued ? 'Saved on this device. Will sync when connected.' : scheduled ? 'Transaction scheduled' : 'Transaction saved')}}/>}
    <Modal protectChanges open={open} onClose={() => setOpen(false)} title={editing ? 'Edit wallet' : 'Add wallet'}>
      <form onSubmit={submit} className="stack gap-16">
        <label className="field"><span>Name</span><input required value={form.name} onChange={event => setForm({...form,name:event.target.value})} placeholder="Main bank"/></label>
        <div className="form-grid two">
          <label className="field"><span>Type</span><AppSelect value={form.type} onChange={event => setType(event.target.value)}>
            <option value="cash">Cash</option><option value="bank">Bank</option><option value="card">Card</option><option value="digital">Digital wallet</option>
          </AppSelect></label>
          <label className="field"><span>{editing ? 'Opening balance' : 'Current starting balance'}</span><input type="number" step="0.001" value={form.initial_balance} onChange={event => setForm({...form,initial_balance:event.target.value})}/></label>
        </div>
        <div className="wallet-card-editor">
          <div className="stack gap-16">
            {['bank','card'].includes(form.type) && <fieldset className="wallet-card-setting">
              <legend>Card network</legend>
              <div className="wallet-network-options">{['visa','mastercard'].map(network => <button key={network} type="button" className={form.card_network === network ? 'selected' : ''} aria-pressed={form.card_network === network} onClick={() => setForm({...form,card_network:network})}><CardNetworkMark network={network}/></button>)}</div>
            </fieldset>}
            <label className="field"><span>Card finish</span><AppSelect value={form.card_finish || 'fixed'} onChange={event => setForm({...form,card_finish:event.target.value === 'fixed' ? null : event.target.value})}>
              <option value="cream">Follow palette · Automatic wordmark</option><option value="gold">Follow palette · Soft gold wordmark</option>
              <option value="charcoal">Follow palette · Charcoal wordmark</option><option value="fixed">Fixed color</option>
            </AppSelect></label>
            {!form.card_finish && <fieldset className="wallet-card-setting"><legend>Card color</legend><div className="wallet-color-options">
              {CARD_COLORS.map(([color,label]) => <button key={color} type="button" className={form.color === color ? 'selected' : ''} aria-label={label} aria-pressed={form.color === color} style={{'--swatch':color}} onClick={() => setForm({...form,color})}/>)}
              <label className="wallet-custom-color"><span>Custom color</span><input aria-label="Custom card color" type="color" value={form.color} onChange={event => setForm({...form,color:event.target.value})}/></label>
            </div></fieldset>}
          </div>
          <WalletCardArt wallet={form}/>
        </div>
        {editing && <label className="check-row"><input type="checkbox" checked={Boolean(form.archived)} onChange={event => setForm({...form,archived:event.target.checked})}/><span>Archive wallet</span></label>}
        <p className="form-note">A positive starting balance is recorded once as opening-balance income. Editing it updates the same entry.</p>
        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="modal-actions"><button type="button" className="button ghost" onClick={() => setOpen(false)}>Cancel</button><button className="button primary" disabled={saving}>{saving ? 'Saving...' : 'Save wallet'}</button></div>
      </form>
    </Modal>
  </div>
}
