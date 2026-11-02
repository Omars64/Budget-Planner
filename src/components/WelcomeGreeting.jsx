import { useAppMotion } from '../lib/appMotion'
import './WelcomeScreen.css'

export default function WelcomeGreeting({ duration = 3.5, replay = 0 }) {
  const motion = useAppMotion()
  return <div key={replay} className="welcome-greeting" data-motion={motion} style={{ '--welcome-duration': `${duration}s` }} aria-label="Budgetly">Budgetly</div>
}
