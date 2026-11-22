import { useLayoutEffect, useRef } from 'react'
import { Route, Routes, useLocation, useNavigationType } from 'react-router-dom'
import { deliberateTransition, useAppMotion } from '../lib/appMotion'

// Commit the new route first so its data and lazy modules can start loading.
// Clip and opacity leave the floating controls free of transform containers.
export default function RouteMotion({ children }) {
  const location = useLocation()
  const navigation = useNavigationType()
  const mode = useAppMotion()
  const root = useRef(null)
  const previousPath = useRef(location.pathname)

  useLayoutEffect(() => {
    if (previousPath.current === location.pathname) return
    previousPath.current = location.pathname
    const page = root.current?.querySelector('.page-wrap')
    if (mode !== 'full' || !page?.animate || document.querySelector('[aria-modal="true"], dialog[open]')) return
    const animation = page.animate([
      { '--budgetly-route-opacity': 0.7, clipPath: navigation === 'POP' ? 'inset(0 1% 0 0)' : 'inset(0 0 0 1%)' },
      { '--budgetly-route-opacity': 1, clipPath: 'inset(0 0 0 0)' },
    ], { duration: deliberateTransition(mode).duration * 500, easing: 'cubic-bezier(.22,.75,.25,1)' })
    animation.finished.then(() => animation.cancel()).catch(() => {})
    return () => animation.cancel()
  }, [location.pathname, mode, navigation])

  return <div ref={root} className="route-motion-root">
    <Routes location={location}><Route path="*" element={children(location)}/></Routes>
  </div>
}
