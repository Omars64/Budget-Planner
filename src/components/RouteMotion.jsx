import { useLayoutEffect, useRef, useState } from 'react'
import { Route, Routes, useLocation, useNavigationType } from 'react-router-dom'
import { deliberateTransition, useAppMotion } from '../lib/appMotion'

// Freeze the router context through exit, then switch the single live shell.
// Clip/opacity leave sticky and fixed descendants free of transform containers.
export default function RouteMotion({ children }) {
  const location = useLocation()
  const navigation = useNavigationType()
  const mode = useAppMotion()
  const [shown, setShown] = useState(location)
  const root = useRef(null)
  const entering = useRef(false)
  const direction = useRef(1)
  const pending = shown.pathname !== location.pathname

  useLayoutEffect(() => {
    if (!pending) return
    const page = root.current?.querySelector('.page-wrap')
    direction.current = navigation === 'POP' ? -1 : 1
    if (mode !== 'full' || !page?.animate || document.querySelector('[aria-modal="true"], dialog[open]')) {
      entering.current = false
      setShown(location)
      return
    }
    const animation = page.animate([
      { '--budgetly-route-opacity': 1, clipPath: 'inset(0 0 0 0)' },
      { '--budgetly-route-opacity': 0, clipPath: direction.current > 0 ? 'inset(0 1% 0 0)' : 'inset(0 0 0 1%)' },
    ], { duration: 140, easing: 'ease-in', fill: 'both' })
    let cancelled = false
    animation.finished.then(() => {
      if (cancelled) return
      entering.current = true
      setShown(location)
    }).catch(() => {})
    return () => { cancelled = true; animation.cancel() }
  }, [location, mode, navigation, pending])

  useLayoutEffect(() => {
    if (pending || !entering.current) return
    entering.current = false
    const page = root.current?.querySelector('.page-wrap')
    if (mode !== 'full' || !page?.animate) return
    const animation = page.animate([
      { '--budgetly-route-opacity': 0, clipPath: direction.current > 0 ? 'inset(0 0 0 1%)' : 'inset(0 1% 0 0)' },
      { '--budgetly-route-opacity': 1, clipPath: 'inset(0 0 0 0)' },
    ], { duration: deliberateTransition(mode).duration * 1000, easing: 'cubic-bezier(.22,.75,.25,1)' })
    animation.finished.then(() => animation.cancel()).catch(() => {})
    return () => animation.cancel()
  }, [shown, mode, pending])

  const displayed = pending ? shown : location
  return <div ref={root} className="route-motion-root" data-route-exiting={pending && mode === 'full' ? '' : undefined}>
    <Routes location={displayed}><Route path="*" element={children(displayed)}/></Routes>
  </div>
}
