import { useState } from 'react'
import { LoaderCircle, Mic, MicOff } from 'lucide-react'
import { listenForVoice, stopVoiceInput } from '../lib/voiceInput'

export default function VoiceInputButton({ onTranscript, onError, disabled = false }) {
  const [listening, setListening] = useState(false)

  const toggle = async () => {
    if (disabled) return
    if (listening) {
      await stopVoiceInput()
      return
    }
    setListening(true)
    try {
      const transcript = await listenForVoice()
      onTranscript(transcript)
    } catch (error) {
      onError?.(error.message)
    } finally {
      setListening(false)
    }
  }

  return <div className="voice-entry">
    <button type="button" className={`icon-button voice-button${listening ? ' listening' : ''}`} disabled={disabled} onClick={toggle} title={listening ? 'Stop voice input' : 'Use voice input'} aria-label={listening ? 'Stop voice input' : 'Use voice input'}>
      {listening ? <><MicOff size={17}/><span className="sr-only">Stop voice input</span></> : <><Mic size={17}/><span className="sr-only">Use voice input</span></>}
      {listening && <LoaderCircle size={13} className="voice-spinner"/>}
    </button>
    <span className="voice-entry-copy"><strong>{listening ? 'Listening...' : 'Use voice input'}</strong><small>Describe it naturally with the amount and wallet.</small></span>
  </div>
}
