import { Capacitor, registerPlugin } from '@capacitor/core'

export { parseVoiceTransaction, applyVoiceTransaction } from './voiceTransaction'
export const VOICE_DURATION_MS = 15000
const VoiceInput = registerPlugin('VoiceInput')
let activeSession = null
let nextSessionId = 0
const nativeAndroid = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'

export const voiceInputSupported = () => nativeAndroid() || (typeof window !== 'undefined' && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition))

const voiceError = error => {
  const code = String(error?.code || error?.error || '').toLowerCase()
  if (/not-allowed|permission/.test(code)) return 'Microphone permission was denied. Allow it in device or browser settings.'
  if (code === 'network') return 'Voice input lost its connection. Please try again.'
  return error?.message || 'Voice input could not be completed. Please try again.'
}

export async function listenForVoice({ language = 'en-US', signal, onPartial, onState } = {}) {
  if (signal?.aborted) return ''
  if (activeSession) throw new Error('Voice input is already listening.')
  if (nativeAndroid()) {
    const sessionId = String(++nextSessionId)
    const session = { stop: () => VoiceInput.stop({ sessionId }) }
    activeSession = session
    const cancel = () => { void VoiceInput.cancel({ sessionId }).catch(() => {}) }
    signal?.addEventListener('abort', cancel, { once: true })
    let listener
    try {
      listener = await VoiceInput.addListener('voiceProgress', event => {
        if (event.sessionId !== sessionId || signal?.aborted) return
        if (event.state) onState?.(event.state)
        if (typeof event.text === 'string') onPartial?.(event.text)
      })
      if (signal?.aborted) return ''
      const result = await VoiceInput.listen({ language, sessionId })
      return signal?.aborted ? '' : String(result?.text || '').trim()
    } catch (error) {
      if (signal?.aborted) return ''
      throw new Error(voiceError(error))
    } finally {
      signal?.removeEventListener('abort', cancel)
      await listener?.remove()
      if (activeSession === session) activeSession = null
    }
  }

  const Recognition = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition)
  if (!Recognition) throw new Error('Voice input is unavailable in this browser. Try Chrome, Edge, or the Android app.')
  return new Promise((resolve, reject) => {
    const recognition = new Recognition()
    let settled = false
    let stopping = false
    let transcript = ''
    let deadline
    let finishTimer
    let startTimer
    const finish = error => {
      if (settled) return
      settled = true
      window.clearTimeout(deadline)
      window.clearTimeout(finishTimer)
      window.clearTimeout(startTimer)
      signal?.removeEventListener('abort', cancel)
      recognition.onstart = recognition.onresult = recognition.onerror = recognition.onend = null
      try { recognition.abort() } catch { /* The service may already have ended. */ }
      if (activeSession === session) activeSession = null
      if (error && !transcript) reject(new Error(voiceError(error)))
      else resolve(signal?.aborted ? '' : transcript)
    }
    const cancel = () => finish()
    const session = { stop: () => {
      if (settled || stopping) return
      stopping = true
      window.clearTimeout(deadline)
      onState?.('finishing')
      // Allow a final result, then release the microphone even if the service hangs.
      finishTimer = window.setTimeout(() => finish(), 1000)
      try { recognition.stop() } catch { finish() }
    } }
    activeSession = session
    recognition.lang = language
    recognition.continuous = true
    recognition.interimResults = true
    recognition.maxAlternatives = 1
    recognition.onstart = () => {
      window.clearTimeout(startTimer)
      if (stopping) return
      onState?.('listening')
      deadline = window.setTimeout(session.stop, VOICE_DURATION_MS)
    }
    recognition.onresult = event => {
      // Results are cumulative; replace interim revisions instead of appending duplicates.
      transcript = Array.from(event.results, result => result[0]?.transcript || '').join(' ').replace(/\s+/g, ' ').trim()
      onPartial?.(transcript)
    }
    recognition.onerror = error => {
      if (stopping || ['no-speech', 'aborted'].includes(error.error)) finish()
      else finish(error)
    }
    recognition.onend = () => finish()
    signal?.addEventListener('abort', cancel, { once: true })
    startTimer = window.setTimeout(() => finish(new Error('The microphone did not start. Please try again.')), VOICE_DURATION_MS)
    try { recognition.start() } catch (error) { finish(error) }
  })
}

export async function stopVoiceInput() {
  await activeSession?.stop()
}
