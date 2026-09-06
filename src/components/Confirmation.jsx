import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle } from 'lucide-react'

export function useConfirmation() {
  const [message, setMessage] = useState('')
  const resolve = useRef(null)
  const dialog = useRef(null)
  const confirm = useCallback(message => new Promise(done => {
    resolve.current?.(false)
    resolve.current = done
    setMessage(message)
  }), [])
  const settle = useCallback(answer => {
    dialog.current?.close()
    resolve.current?.(answer)
    resolve.current = null
    setMessage('')
  }, [])
  useEffect(() => {
    if (message && !dialog.current.open) dialog.current.showModal()
  }, [message])
  useEffect(() => () => resolve.current?.(false), [])

  const confirmation = <dialog ref={dialog} className="confirmation-dialog" aria-labelledby="confirmation-title" aria-describedby="confirmation-message" onCancel={event => { event.preventDefault(); settle(false) }}>
    <AlertTriangle size={24} className="confirmation-icon" aria-hidden="true" />
    <h3 id="confirmation-title">Confirm action</h3>
    <p id="confirmation-message">{message}</p>
    <div className="button-row">
      <button autoFocus className="button ghost" onClick={() => settle(false)}>Cancel</button>
      <button className="button danger" onClick={() => settle(true)}>Confirm</button>
    </div>
  </dialog>
  return { confirm, confirmation }
}
