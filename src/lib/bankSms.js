import { Capacitor, registerPlugin } from '@capacitor/core'
import { api, auth, jsonBody } from './api'
export const BankSms = registerPlugin('BankSms')
export const smsAvailable = () => Capacitor.getPlatform() === 'android' && Capacitor.isNativePlatform()
let syncing = false
export async function syncBankSms(owner) {
  if (!smsAvailable() || syncing) return
  syncing = true
  const token = auth.token
  try {
    const {messages} = await BankSms.pending({owner:String(owner)})
    for (const message of messages) {
      if (auth.token !== token) return
      await api('/api/bank-messages', {method:'POST', ...jsonBody(message)})
      await BankSms.acknowledge({owner:String(owner), reference:message.reference})
    }
  } finally { syncing = false }
}
