const stagePadding = 5
const gap = 16
const margin = 10
const arrowInset = 14

export const tutorialStage = { stagePadding, stageRadius: 10 }

function viewportBounds() {
  const viewport = window.visualViewport
  const x = viewport?.offsetLeft ?? 0
  const y = viewport?.offsetTop ?? 0
  return {
    left: x + margin,
    top: y + margin,
    right: x + (viewport?.width ?? document.documentElement.clientWidth) - margin,
    bottom: y + (viewport?.height ?? document.documentElement.clientHeight) - margin,
  }
}

const clamp = (value, min, max) => Math.max(min, Math.min(value, max))

function positionNote(note, target, bounds) {
  const centerX = (target.left + target.right) / 2
  const centerY = (target.top + target.bottom) / 2
  const width = note.offsetWidth
  const height = note.offsetHeight
  const left = clamp(centerX - width / 2, bounds.left, bounds.right - width)
  const top = clamp(centerY - height / 2, bounds.top, bounds.bottom - height)
  const above = target.top - gap - bounds.top
  const below = bounds.bottom - target.bottom - gap

  if (below >= height && (above < height || centerY <= (bounds.top + bounds.bottom) / 2)) {
    return { side: 'below', left, top: target.bottom + gap, pointer: centerX - left }
  }
  if (above >= height) return { side: 'above', left, top: target.top - gap - height, pointer: centerX - left }
  if (target.left - gap - bounds.left >= width) {
    return { side: 'left', left: target.left - gap - width, top, pointer: centerY - top }
  }
  if (bounds.right - target.right - gap >= width) {
    return { side: 'right', left: target.right + gap, top, pointer: centerY - top }
  }

  // A short viewport can use a scrollable note in the larger free region.
  const useAbove = above > below
  const maxHeight = Math.max(0, useAbove ? above : below)
  return {
    side: useAbove ? 'above' : 'below', left,
    top: useAbove ? bounds.top : target.bottom + gap,
    pointer: centerX - left, maxHeight,
  }
}

function revealTarget(target) {
  const bounds = viewportBounds()
  const rect = target.getBoundingClientRect()
  const header = document.querySelector('.topbar')
  if (header && !header.contains(target)) bounds.top = Math.max(bounds.top, header.getBoundingClientRect().bottom + stagePadding)
  for (const bar of document.querySelectorAll('.mobile-nav, .app-footer')) {
    if (!bar.contains(target) && window.getComputedStyle(bar).position === 'fixed' && bar.getClientRects().length) {
      bounds.bottom = Math.min(bounds.bottom, bar.getBoundingClientRect().top - stagePadding)
    }
  }
  if (rect.top < bounds.top || rect.bottom > bounds.bottom) {
    target.scrollIntoView?.({ block: 'center', inline: 'nearest', behavior: 'instant' })
  }
}

export function trackTutorialTarget(note, target, refreshSpotlight) {
  const outline = document.createElement('div')
  outline.className = 'budgetly-tour-outline'
  outline.setAttribute('aria-hidden', 'true')
  document.body.append(outline)
  let frame = 0
  const viewport = window.visualViewport
  const listeners = new AbortController()
  const { signal } = listeners
  // Follow the route and Settings entrance animations as well as scroll and resize.
  const settleAt = window.performance.now() + 520

  function place() {
    if (!note.isConnected) return
    const bounds = viewportBounds()
    const rect = target.getBoundingClientRect()
    note.style.setProperty('--tour-width', `${Math.max(0, bounds.right - bounds.left)}px`)
    note.style.removeProperty('--tour-max-height')
    const visible = target.isConnected && rect.width > 0 && rect.height > 0 &&
      rect.bottom > bounds.top && rect.top < bounds.bottom && rect.right > bounds.left && rect.left < bounds.right
    outline.hidden = !visible

    const placement = visible ? positionNote(note, rect, bounds) : {
      side: 'detached',
      left: bounds.left + Math.max(0, (bounds.right - bounds.left - note.offsetWidth) / 2),
      top: bounds.top,
      maxHeight: bounds.bottom - bounds.top,
    }
    note.dataset.tourSide = placement.side
    note.style.setProperty('--tour-left', `${placement.left}px`)
    note.style.setProperty('--tour-top', `${placement.top}px`)
    note.classList.toggle('budgetly-tour-scroll', placement.maxHeight !== undefined)
    if (placement.maxHeight !== undefined) note.style.setProperty('--tour-max-height', `${placement.maxHeight}px`)
    if (!visible) return

    const axisSize = ['above', 'below'].includes(placement.side) ? note.offsetWidth : note.offsetHeight
    note.style.setProperty('--tour-pointer', `${clamp(placement.pointer, arrowInset, axisSize - arrowInset)}px`)
    Object.assign(outline.style, {
      left: `${rect.left - stagePadding}px`,
      top: `${rect.top - stagePadding}px`,
      width: `${rect.width + 2 * stagePadding}px`,
      height: `${rect.height + 2 * stagePadding}px`,
    })
  }

  function schedule() {
    if (frame) return
    frame = window.requestAnimationFrame(now => {
      frame = 0
      place()
      if (target.isConnected) refreshSpotlight()
      if (now < settleAt) schedule()
    })
  }

  const resize = () => { revealTarget(target); schedule() }
  const observer = window.ResizeObserver ? new window.ResizeObserver(schedule) : null
  observer?.observe(target)
  const page = document.querySelector('.page-wrap')
  if (page) observer?.observe(page)
  window.addEventListener('scroll', schedule, { capture: true, passive: true, signal })
  window.addEventListener('resize', resize, { signal })
  viewport?.addEventListener('scroll', schedule, { signal })
  viewport?.addEventListener('resize', resize, { signal })
  revealTarget(target)
  place()
  schedule()
  return () => {
    listeners.abort()
    observer?.disconnect()
    window.cancelAnimationFrame(frame)
    outline.remove()
  }
}
