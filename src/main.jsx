import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import MotionPreferences from './components/MotionPreferences'
import { applyAppearance, readDeviceAppearance } from './lib/appearance'
import App from './App'
import './styles.css'
import './enhancements.css'
import './experience.css'
import './password-input.css'
import './reliability.css'
import './budgetly.css'
import './theme.css'
import './motion.css'
import './notes-workspace.css'
import './ask-ai.css'
import './date-time-picker.css'
import 'driver.js/dist/driver.css'
import './interaction.css'
import './ledger-clarity.css'
import './comfort.css'

applyAppearance(readDeviceAppearance())

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <MotionPreferences><HashRouter>
      <App />
    </HashRouter></MotionPreferences>
  </React.StrictMode>,
)
