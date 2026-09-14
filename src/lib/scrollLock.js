import { useEffect } from 'react'

const locks = new Set()
let restore

// A nested prompt must not unlock the page while its parent dialog is still open.
export function lockPageScroll() {
  const token = Symbol('scroll-lock')
  if (!locks.size) {
    const body = document.body
    const root = document.documentElement
    const overflow = body.style.overflow
    const padding = body.style.paddingRight
    const rootOverflow = root.style.overflow
    const gap = Math.max(0, window.innerWidth - root.clientWidth)
    if (gap) body.style.paddingRight = `${(parseFloat(window.getComputedStyle(body).paddingRight) || 0) + gap}px`
    body.style.overflow = 'hidden'
    root.style.overflow = 'hidden'
    restore = () => {
      body.style.overflow = overflow
      body.style.paddingRight = padding
      root.style.overflow = rootOverflow
    }
  }
  locks.add(token)
  return () => {
    if (!locks.delete(token)) return
    if (!locks.size) { restore?.(); restore = undefined }
  }
}

export function useScrollLock(active) {
  useEffect(() => active ? lockPageScroll() : undefined, [active])
}

export function useContainedScroll(ref) {
  useEffect(() => {
    const root = ref.current
    if (!root) return
    const wheel = event => {
      if (event.ctrlKey || !event.deltaY) return
      let element = event.target instanceof window.Element ? event.target : root
      while (element && root.contains(element)) {
        const style = window.getComputedStyle(element)
        const canScroll = /(auto|scroll)/.test(style.overflowY)
        if (canScroll && (event.deltaY < 0 ? element.scrollTop > 0 : element.scrollTop + element.clientHeight < element.scrollHeight - 1)) return
        element = element.parentElement
      }
      event.preventDefault()
    }
    root.addEventListener('wheel', wheel, { passive: false })
    return () => root.removeEventListener('wheel', wheel)
  }, [ref])
}
