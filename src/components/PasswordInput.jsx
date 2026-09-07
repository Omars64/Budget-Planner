import { Eye, EyeOff } from 'lucide-react'
import { useState } from 'react'

export default function PasswordInput({ className = '', ...props }) {
  const [visible, setVisible] = useState(false)
  return <span className={`password-input ${className}`}>
    <input {...props} type={visible ? 'text' : 'password'} />
    <button type="button" className="password-toggle" onClick={() => setVisible(value => !value)} aria-label={visible ? 'Hide password' : 'Show password'} aria-pressed={visible}>{visible ? <EyeOff size={16} /> : <Eye size={16} />}</button>
  </span>
}
