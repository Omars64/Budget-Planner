import { useRef, useState } from 'react'
import { LoaderCircle, Mic, MicOff } from 'lucide-react'
import { listenForVoice, stopVoiceInput } from '../lib/voiceInput'

export default function VoiceInputButton({ onTranscript, onError, disabled = false }) {
  const [listening, setListening] = useState(false)
  const listeningRef = useRef(false)

  const toggle = async () => {
    if (disabled && !listeningRef.current) return
    if (listeningRef.current) {
      await stopVoiceInput()
      return
    }
    listeningRef.current = true
    setListening(true)
    try {
      const transcript = await listenForVoice()
      if (transcript) onTranscript(transcript)
    } catch (error) {
      onError?.(error.message)
    } finally {
      listeningRef.current = false
      setListening(false)
    }
  }

  return <button type="button" className={`voice-entry${listening ? ' listening' : ''}`} disabled={disabled && !listening} onClick={toggle} title={listening ? 'Stop voice input' : 'Use voice input'} aria-label={listening ? 'Stop voice input' : 'Use voice input'} aria-pressed={listening}>
    <span className="voice-entry-icon" aria-hidden="true">{listening ? <MicOff size={20}/> : <Mic size={20}/>}</span>
    <span className="voice-entry-copy"><strong>{listening ? 'Listening...' : 'Use voice input'}</strong><small>{listening ? 'Tap again to stop and apply what you said.' : 'Describe it naturally with the amount and wallet.'}</small></span>
    {listening && <LoaderCircle size={16} className="voice-spinner" aria-hidden="true"/>}
  </button>
}
