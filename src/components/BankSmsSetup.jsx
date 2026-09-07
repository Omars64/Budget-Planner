import { useEffect, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { useApp } from '../App'
import { BankSms, smsAvailable, syncBankSms } from '../lib/bankSms'

export default function BankSmsSetup() {
  const { user, notify } = useApp()
  const [senders, setSenders] = useState({'NBK':'','KFH':'','Gulf Bank':'','CBK':''})
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!smsAvailable()) return
    BankSms.status({owner:String(user.id)}).then(result => setSenders(current => ({...current,...Object.fromEntries(result.rules.map(rule=>[rule.bank,rule.sender]))}))).catch(e=>notify(e.message,'error'))
  }, [user.id,notify])
  const save = async e => {
    e.preventDefault(); setBusy(true)
    try {
      const rules = Object.entries(senders).filter(([,s]) => s.trim()).map(([bank,sender])=>({bank,sender:sender.trim()}))
      if (!rules.length) throw new Error('Enter at least one bank sender ID.')
      await BankSms.configure({owner:String(user.id),enabled:true,rules})
      await syncBankSms(user.id)
      notify('Bank SMS capture enabled on this phone')
    } catch(e) { notify(e.message,'error') } finally { setBusy(false) }
  }
  return <section className="panel glass"><h3>Automatic bank messages</h3>{smsAvailable() ? <form className="stack gap-12" onSubmit={save}><p className="muted">Allow FlowBudget to capture new transaction SMS from the senders below. Matching alerts are stored privately on this phone and uploaded when FlowBudget opens. Verification codes are excluded. No forwarding key is needed.</p>{Object.entries(senders).map(([bank,value])=><label className="field" key={bank}><span>{bank} sender ID</span><input maxLength={40} value={value} placeholder="Exact sender shown in your bank SMS" onChange={e=>setSenders({...senders,[bank]:e.target.value})}/></label>)}<div className="button-row"><button className="button primary" disabled={busy}>Enable bank SMS capture</button><button type="button" className="button ghost" disabled={busy} onClick={async()=>{try{await BankSms.configure({enabled:false});notify('SMS capture disabled')}catch(e){notify(e.message,'error')}}}>Disable capture</button></div></form> : <p className="muted">{Capacitor.getPlatform()==='ios' ? 'iPhone does not permit FlowBudget to capture bank SMS directly in Kuwait. Add a message manually for review.' : 'Direct SMS capture is available in the Android app with your permission. Browser access cannot read phone messages.'}</p>}</section>
}
