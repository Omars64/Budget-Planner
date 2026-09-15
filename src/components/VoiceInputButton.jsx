import { useEffect, useRef, useState } from 'react'
import { LoaderCircle, Mic, Square } from 'lucide-react'
import { listenForVoice, stopVoiceInput, VOICE_DURATION_MS } from '../lib/voiceInput'

export default function VoiceInputButton({ onTranscript, onError, onActiveChange, disabled = false }) {
  const [state, setState] = useState('idle')
  const [remaining, setRemaining] = useState(VOICE_DURATION_MS / 1000)
  const [transcript, setTranscript] = useState('')
  const controller = useRef(null)
  const callbacks = useRef({ onTranscript, onError, onActiveChange })
  callbacks.current = { onTranscript, onError, onActiveChange }
  const active = state !== 'idle'
  useEffect(() => {
    callbacks.current.onActiveChange?.(active)
  }, [active])
  useEffect(() => () => {
    controller.current?.abort()
    controller.current = null
    callbacks.current.onActiveChange?.(false)
  }, [])
  useEffect(() => { if (disabled) controller.current?.abort() }, [disabled])
  useEffect(() => {
    if (state !== 'listening') return
    const started = Date.now()
    setRemaining(VOICE_DURATION_MS / 1000)
    const interval = window.setInterval(() => setRemaining(Math.max(0, Math.ceil((VOICE_DURATION_MS - Date.now() + started) / 1000))), 250)
    const hide = () => { if (document.hidden) void stopVoiceInput().catch(error => callbacks.current.onError?.(error.message)) }
    document.addEventListener('visibilitychange', hide)
    return () => { window.clearInterval(interval); document.removeEventListener('visibilitychange', hide) }
  }, [state])

  const toggle = async () => {
    if (controller.current) {
      if (state === 'starting' || state === 'listening') {
        try { await stopVoiceInput() } catch (error) { callbacks.current.onError?.(error.message); controller.current?.abort() }
      }
      return
    }
    if (disabled) return
    const session = new window.AbortController()
    controller.current = session
    setState('starting')
    setTranscript('')
    try {
      const text = await listenForVoice({ signal:session.signal, onPartial:setTranscript, onState:setState })
      if (session.signal.aborted) return
      if (text) {
        setState('applying')
        await callbacks.current.onTranscript(text, { signal:session.signal })
      } else callbacks.current.onError?.('No words captured. Tap the microphone to try again.')
    } catch (error) {
      if (!session.signal.aborted) callbacks.current.onError?.(error.message)
    } finally {
      if (controller.current === session) {
        controller.current = null
        setState('idle')
      }
    }
  }

  const pending = state === 'finishing' || state === 'applying'
  return <div className="voice-input">
    <button type="button" className={`voice-entry${active ? ' listening' : ''}`} disabled={disabled || pending} onClick={toggle} title={active ? 'Stop voice input' : 'Start voice input'} aria-label={active ? 'Stop voice input' : 'Start voice input'} aria-pressed={active}>
      <span className="voice-entry-icon" aria-hidden="true">{pending ? <LoaderCircle size={20} className="voice-spinner"/> : active ? <Square size={18}/> : <Mic size={22}/>}</span>
      <span className="voice-entry-copy">{state === 'listening' ? `Listening: ${remaining}s` : state === 'starting' ? 'Starting microphone...' : pending ? 'Applying voice input...' : 'Describe the amount, description, category, and wallet.'}</span>
    </button>
    {transcript && <p className="voice-transcript">{transcript}</p>}
  </div>
}
