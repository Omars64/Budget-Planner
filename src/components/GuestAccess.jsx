import { LockKeyhole } from 'lucide-react'
import { useApp } from '../App'
import Modal from './Modal'

export function GuestGate() {
  const { requestSignIn } = useApp()
  return <section className="guest-gate"><LockKeyhole size={28}/><h3>Available with an account</h3><button className="button primary" onClick={() => requestSignIn('this section')}>Sign in or create an account</button></section>
}

export default function GuestAccess({ feature, onClose, onContinue }) {
  return <Modal open={Boolean(feature)} onClose={onClose} title="Continue with an account" size="small">
    <p>Sign in or create an account to use {feature}. Your guest records and draft will stay on this device.</p>
    <div className="modal-actions"><button className="button ghost" onClick={onClose}>Not now</button><button className="button primary" onClick={onContinue}>Continue</button></div>
  </Modal>
}
