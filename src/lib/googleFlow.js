import { Capacitor, registerPlugin } from '@capacitor/core'
import { api, jsonBody } from './api'

const browser = registerPlugin('OAuthBrowser')
function pause(signal) {
  return new Promise((resolve,reject)=>{
    const abort=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(new DOMException('Google sign-in cancelled','AbortError'))}
    const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve()},1800)
    signal?.addEventListener('abort',abort,{once:true})
    if (signal?.aborted) abort()
  })
}
export function reserveGoogleWindow() {
  if (Capacitor.isNativePlatform()) return null
  const popup = window.open('about:blank', '_blank', 'popup,width=520,height=700')
  if (!popup) throw new Error('Allow pop-ups for Budgetly to continue with Google.')
  popup.opener = null
  return popup
}

export async function openGoogleFlow(flow, {popup, signal, pollPath, pollBody}) {
  const url = new URL(flow.authorization_url)
  if (url.protocol !== 'https:' || url.hostname !== 'accounts.google.com' || url.username || url.password || url.port) {
    popup?.close(); throw new Error('Google sign-in is unavailable. Please try again later.')
  }
  try {
    if (Capacitor.isNativePlatform()) await browser.open({url:url.href})
    else {
      if (!popup || popup.closed) throw new Error('Google sign-in window was closed.')
      popup.location.replace(url.href)
    }
    const deadline=Date.now()+10*60*1000
    while (Date.now()<deadline) {
      if (signal?.aborted) throw new DOMException('Google sign-in cancelled','AbortError')
      if (Capacitor.isNativePlatform() && document.visibilityState === 'hidden') {
        await pause(signal)
        continue
      }
      let result
      try {
        result=await api(pollPath,{method:'POST',...jsonBody(pollBody),signal})
      } catch (error) {
        // Android can suspend the WebView connection while the external browser is open.
        if (!error.network && ![502,503,504].includes(error.status)) throw error
      }
      if (result && !['pending','processing','exchanging'].includes(result.status)) return result
      if (popup?.closed) throw new Error('Google sign-in was cancelled. You can try again.')
      await pause(signal)
    }
    throw new Error('Google sign-in expired. Please try again.')
  } finally { popup?.close() }
}
