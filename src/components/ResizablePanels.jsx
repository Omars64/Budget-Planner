import { useEffect } from 'react'

export default function ResizablePanels() {
  useEffect(() => {
    const selector = '.page-wrap .panel, .page-wrap .wallet-card, .page-wrap .metric-card, .page-wrap .goal-card, .page-wrap .debt-card, .page-wrap .budget-card'
    const handles = new Map()
    const attach = () => {
      for (const [panel, handle] of handles) if (!panel.isConnected) { handle.remove(); handles.delete(panel) }
      document.querySelectorAll(selector).forEach(panel => {
        if (handles.has(panel)) return
        const handle = document.createElement('button')
        handle.type = 'button'
        handle.className = 'panel-resize-handle'
        handle.setAttribute('aria-label', 'Resize panel')
        const size = (width, height) => {
          const limit = panel.parentElement.getBoundingClientRect().width
          panel.style.width = `${Math.min(limit, Math.max(Math.min(240, limit), width))}px`
          panel.style.height = `${Math.max(160, height)}px`
          panel.style.justifySelf = 'start'
        }
        handle.onpointerdown = e => {
          e.preventDefault(); e.stopPropagation()
          const rect = panel.getBoundingClientRect()
          handle.setPointerCapture(e.pointerId)
          handle.onpointermove = move => {
            const width = rect.width + move.clientX - e.clientX
            if (width > rect.width + 16 && getComputedStyle(panel.parentElement).display === 'grid') panel.style.gridColumn = '1 / -1'
            size(width, rect.height + move.clientY - e.clientY)
          }
          handle.onpointerup = handle.onpointercancel = () => { handle.onpointermove = null }
        }
        handle.onkeydown = e => {
          if (!['ArrowRight','ArrowLeft','ArrowUp','ArrowDown','Escape'].includes(e.key)) return
          e.preventDefault()
          if (e.key === 'Escape') { ['width','height','grid-column','justify-self'].forEach(p => panel.style.removeProperty(p)); return }
          const rect = panel.getBoundingClientRect()
          if (e.key === 'ArrowRight') panel.style.gridColumn = '1 / -1'
          size(rect.width + (e.key === 'ArrowRight' ? 24 : e.key === 'ArrowLeft' ? -24 : 0), rect.height + (e.key === 'ArrowDown' ? 24 : e.key === 'ArrowUp' ? -24 : 0))
        }
        handle.onclick = e => e.stopPropagation()
        handle.ondblclick = e => e.stopPropagation()
        panel.classList.add('resizable-panel')
        panel.append(handle); handles.set(panel, handle)
      })
    }
    attach()
    const observer = new MutationObserver(attach)
    observer.observe(document.body, { childList:true, subtree:true })
    return () => { observer.disconnect(); handles.forEach((handle,panel) => { handle.remove(); panel.classList.remove('resizable-panel') }) }
  }, [])
  return null
}
