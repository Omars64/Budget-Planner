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
  let returned = false
  let returnCanceled = false
  let returnListener
  const authTabReturn = event => { returned = true; returnCanceled = event.detail?.canceled === true }
  try {
    window.addEventListener('budgetly:oauth-return', authTabReturn)
    if (Capacitor.isNativePlatform() && browser.addListener) returnListener = await browser.addListener('returnToApp', () => { returned = true })
    if (Capacitor.isNativePlatform()) await browser.open({url:url.href})
    else {
      if (!popup || popup.closed) throw new Error('Google sign-in window was closed.')
      popup.location.replace(url.href)
    }
    const deadline=Date.now()+10*60*1000
    let closedAt = null
    while (Date.now()<deadline) {
      if (signal?.aborted) throw new DOMException('Google sign-in cancelled','AbortError')
      if (Capacitor.isNativePlatform() && document.visibilityState === 'hidden' && !returned) {
        await pause(signal)
        continue
      }
      let result
      returned = false
      try {
        result=await api(pollPath,{method:'POST',...jsonBody(pollBody),signal})
      } catch (error) {
        // Android can suspend the WebView connection while the external browser is open.
        if (!error.network && ![502,503,504].includes(error.status)) throw error
      }
      if (result && !['pending','processing','exchanging'].includes(result.status)) {
        // Auth Tab can deliver its activity result just before the WebView
        // becomes visible. Keep the collected result in memory until resume;
        // otherwise a following passkey request is rejected as background work.
        while (Capacitor.isNativePlatform() && document.visibilityState === 'hidden') {
          if (signal?.aborted) throw new DOMException('Google sign-in cancelled','AbortError')
          if (Date.now() >= deadline) throw new Error('Return to Budgetly and start Google confirmation again.')
          await pause(signal)
        }
        return result
      }
      if (returnCanceled) throw new Error('Google confirmation was closed or its return link could not be verified. Please try again.')
      // Completion closes the popup after committing the result. A poll already
      // in flight may still say pending; allow a final bounded poll to collect it.
      if (popup?.closed) {
        closedAt ??= Date.now()
        if (Date.now() - closedAt >= 5000) throw new Error('Google sign-in was cancelled. You can try again.')
      }
      await pause(signal)
    }
    throw new Error('Google sign-in expired. Please try again.')
  } finally { window.removeEventListener('budgetly:oauth-return', authTabReturn); popup?.close(); try { await returnListener?.remove() } catch { /* A closed native activity may already have removed it. */ } }
}
