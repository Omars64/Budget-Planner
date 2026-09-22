import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Compass } from 'lucide-react'
import { useApp } from '../App'
import { api, jsonBody } from '../lib/api'
import { tutorialSteps } from '../lib/tutorialSteps'
import { useScrollLock } from '../lib/scrollLock'
import Modal from './Modal'
import { effectiveMotion } from '../lib/comfort'

function targetFor(step) {
  if (step.section) {
    const exact = [...document.querySelectorAll('.page-wrap .settings-section summary[data-tour-section]')].find(el => el.dataset.tourSection === step.section)
    if (exact) return exact
    const normalize = value => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase()
    return [...document.querySelectorAll('.page-wrap .settings-section summary')].find(el => normalize(el.textContent) === normalize(step.section))
  }
  return [...document.querySelectorAll(step.selector)].find(el => el.getClientRects().length && window.getComputedStyle(el).visibility !== 'hidden')
}

// Routes are lazy-loaded. Wait for the actual target rather than spotlighting a stale page.
function waitForTarget(step, signal) {
  return new Promise(resolve => {
    const deadline = window.performance.now() + 5000
    let frame
    const finish = value => { window.cancelAnimationFrame(frame); signal.removeEventListener('abort', abort); resolve(value) }
    const abort = () => finish(false)
    const tick = () => {
      if (signal.aborted) return finish(false)
      const page = document.querySelector('.page-wrap')
      if (page?.dataset.tourPage === step.route && targetFor(step)) return finish(true)
      if (window.performance.now() > deadline) return finish(false)
      frame = window.requestAnimationFrame(tick)
    }
    signal.addEventListener('abort', abort, { once: true })
    frame = window.requestAnimationFrame(tick)
  })
}

export default function AppTutorial({ request }) {
  const { user, notify } = useApp()
  const navigate = useNavigate()
  const [welcome, setWelcome] = useState(false)
  const [running, setRunning] = useState(false)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')
  const [mode, setMode] = useState('quick')
  const tour = useRef(null)
  const opened = useRef(false)
  const busy = useRef(false)
  const controller = useRef(null)
  const mounted = useRef(true)
  const cacheKey = `budgetly:tutorial:v1:${user.id}`
  useScrollLock(running)

  const save = async status => {
    try { window.localStorage.setItem(cacheKey, status) } catch { /* Private browsing may disable storage. */ }
    try { await api('/api/tutorial', { method: 'PUT', ...jsonBody({ status }) }) }
    catch { notify('Tutorial finished. Progress could not sync to other devices.', 'error') }
  }

  useEffect(() => {
    let cancelled = false
    api('/api/tutorial').then(({ status }) => {
      let local
      try { local = window.localStorage.getItem(cacheKey) } catch { /* Server state still works. */ }
      if (!cancelled && !opened.current && status === 'not_started' && !local) {
        opened.current = true
        setWelcome(true)
      }
    }).catch(() => {})
    return () => { cancelled = true }
  }, [cacheKey])

  useEffect(() => {
    if (!request) return
    opened.current = true
    setWelcome(true)
    setError('')
  }, [request])

  useEffect(() => {
    mounted.current = true
    const back = event => { if (tour.current) { event.preventDefault(); tour.current.destroy() } }
    window.addEventListener('budgetly:back', back)
    return () => {
      window.removeEventListener('budgetly:back', back)
      mounted.current = false
      controller.current?.abort()
      tour.current?.destroy()
    }
  }, [])

  const skip = () => { if (busy.current) return; setWelcome(false); void save('skipped') }
  const start = async () => {
    if (busy.current || tour.current) return
    busy.current = true
    setStarting(true)
    setError('')
    const aborter = new window.AbortController()
    controller.current = aborter
    try {
      const { driver } = await import('driver.js')
      if (aborter.signal.aborted) return
      const steps = tutorialSteps(user.role === 'admin', mode)
      let outcome = 'skipped'
      let moving = false
      let refreshTimer
      const move = async index => {
        if (moving || aborter.signal.aborted) return
        if (index >= steps.length) { outcome = 'completed'; instance.destroy(); return }
        moving = true
        navigate(steps[index].route)
        const ready = await waitForTarget(steps[index], aborter.signal)
        if (ready) {
          instance.drive(index)
          window.clearTimeout(refreshTimer)
          refreshTimer = window.setTimeout(() => instance.refresh(), 350)
        } else if (!aborter.signal.aborted) {
          notify(`Skipped unavailable tutorial step: ${steps[index].title}`, 'error')
          moving = false
          return move(index + 1)
        }
        moving = false
      }
      const instance = driver({
        animate: effectiveMotion() === 'full',
        allowScroll: true, disableActiveInteraction: true, overlayClickBehavior: () => {},
        showProgress: true, progressText: '{{current}} of {{total}}', popoverClass: 'budgetly-tour',
        nextBtnText: 'Next', prevBtnText: 'Back', doneBtnText: 'Finish',
        steps: steps.map(step => ({ element: () => targetFor(step), onHighlighted: element => {
          const details = step.section && element?.parentElement
          if (details instanceof window.HTMLDetailsElement && !details.open) details.open = true
        }, popover: { title: step.title, description: step.description } })),
        onNextClick: (_, __, { index }) => { void move(index + 1) },
        onPrevClick: (_, __, { index }) => { void move(Math.max(0, index - 1)) },
        onDoneClick: () => { outcome = 'completed'; instance.destroy() },
        onCloseClick: () => instance.destroy(),
        onPopoverRender: popover => {
          popover.closeButton.textContent = 'Skip'
          popover.closeButton.setAttribute('aria-label', 'Skip tutorial')
        },
        onDestroyed: () => {
          aborter.abort()
          window.clearTimeout(refreshTimer)
          tour.current = null
          if (!mounted.current) return
          setRunning(false)
          setStarting(false)
          void save(outcome)
          navigate('/')
        },
      })
      tour.current = instance
      setWelcome(false)
      setRunning(true)
      await move(0)
    } catch {
      if (!aborter.signal.aborted) { setError('The tutorial could not load. Please try again.'); setWelcome(true); setRunning(false) }
    } finally { busy.current = false; if (!aborter.signal.aborted) setStarting(false) }
  }

  return <Modal open={welcome} onClose={skip} title="Welcome to Budgetly">
    <div className="tutorial-welcome stack gap-16">
      <Compass size={40} aria-hidden="true"/>
      <p>Start with a wallet, a transaction and your balance. You can return to the full walkthrough anytime.</p>
      <div className="segment-control" role="group" aria-label="Tutorial length"><button type="button" aria-pressed={mode === 'quick'} className={mode === 'quick' ? 'active' : ''} onClick={() => setMode('quick')}>Quick start</button><button type="button" aria-pressed={mode === 'full'} className={mode === 'full' ? 'active' : ''} onClick={() => setMode('full')}>Full walkthrough</button></div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="modal-actions"><button className="button ghost" disabled={starting} onClick={skip}>Skip for now</button><button className="button primary" disabled={starting} onClick={start}>{starting ? 'Opening...' : 'Start tutorial'}</button></div>
    </div>
  </Modal>
}
