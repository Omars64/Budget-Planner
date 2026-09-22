import { useLayoutEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { readView, writeView } from '../lib/viewState'

export default function ScrollMemory({ userId }) {
  const location = useLocation()
  useLayoutEffect(() => {
    const key = `scroll:${userId}:${location.pathname}`
    const target = location.state?.aiFilters ? 0 : Number(readView(key, 0))
    let restoring = true
    let position = target
    const restore = () => {
      if (!restoring) return
      window.scrollTo({top:target, behavior:'instant'})
      if (Math.abs(window.scrollY - target) < 2) restoring = false
    }
    const save = () => { if (!restoring && document.body.style.overflow !== 'hidden') position = window.scrollY }
    const interrupt = () => { restoring = false; position = window.scrollY }
    const observer = new window.ResizeObserver(restore)
    observer.observe(document.body)
    restore()
    window.addEventListener('scroll', save, {passive:true})
    window.addEventListener('wheel', interrupt, {passive:true})
    window.addEventListener('touchstart', interrupt, {passive:true})
    return () => {
      observer.disconnect()
      window.removeEventListener('scroll', save)
      window.removeEventListener('wheel', interrupt)
      window.removeEventListener('touchstart', interrupt)
      writeView(key, position)
    }
  }, [userId, location.pathname, location.key])
  return null
}
