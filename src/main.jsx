import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { MotionConfig } from 'framer-motion'
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

applyAppearance(readDeviceAppearance())

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <MotionConfig reducedMotion="user"><HashRouter>
      <App />
    </HashRouter></MotionConfig>
  </React.StrictMode>,
)
