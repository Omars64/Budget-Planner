import { useCallback, useLayoutEffect, useRef, useState } from 'react'

const minZoom = .55
const maxZoom = 5
const aspect = 1172 / 1342
const verticalOffset = 17
export const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)

export default function useMapCamera(viewport, onBackgroundClick) {
  const [{ width, height }, setSize] = useState({ width: 0, height: 0 })
  const [{ zoom, x, y }, setCamera] = useState({ zoom: 1, x: 0, y: 0 })
  const drag = useRef({ pointers: new Map(), moved: false })
  const baseWidth = Math.min(width * .91, height * .8 * aspect)
  const mapWidth = baseWidth * zoom
  const mapHeight = mapWidth / aspect
  const left = (width - mapWidth) / 2 + clamp(x, -mapWidth * .85, mapWidth * .85)
  const top = (height - mapHeight) / 2 + clamp(y, -mapHeight * .85, mapHeight * .85) + verticalOffset

  useLayoutEffect(() => {
    const element = viewport.current
    if (!element) return
    function measure() {
      const { clientWidth: width, clientHeight: height } = element
      setSize(current => current.width === width && current.height === height ? current : { width, height })
    }
    measure()
    if (!window.ResizeObserver) return
    const observer = new window.ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [viewport])

  const zoomBy = useCallback((factor, anchor, previous = anchor) => {
    const center = { x: width / 2, y: height / 2 + verticalOffset }
    const from = previous || center
    const to = anchor || center
    setCamera(current => {
      const zoom = clamp(current.zoom * factor, minZoom, maxZoom)
      const ratio = zoom / current.zoom
      const limitX = baseWidth * zoom * .85
      const limitY = limitX / aspect
      return {
        zoom,
        x: clamp(to.x - center.x - (from.x - center.x - current.x) * ratio, -limitX, limitX),
        y: clamp(to.y - center.y - (from.y - center.y - current.y) * ratio, -limitY, limitY)
      }
    })
  }, [width, height, baseWidth])

  function panBy(dx, dy) {
    setCamera(current => {
      const limitX = baseWidth * current.zoom * .85
      const limitY = limitX / aspect
      return { ...current, x: clamp(current.x + dx, -limitX, limitX), y: clamp(current.y + dy, -limitY, limitY) }
    })
  }
  function fit() {
    setCamera({ zoom: 1, x: 0, y: 0 })
  }

  const point = useCallback(event => {
    const rect = viewport.current.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }, [viewport])

  useLayoutEffect(() => {
    const element = viewport.current
    if (!element) return
    const wheel = event => {
      event.preventDefault()
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1
      zoomBy(Math.exp(clamp(-event.deltaY * unit * .0025, -.6, .6)), point(event))
    }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => element.removeEventListener('wheel', wheel)
  }, [viewport, zoomBy, point])

  function onPointerDown(event) {
    const { pointers } = drag.current
    if (event.button !== 0 || pointers.size >= 2) return
    if (!pointers.size) drag.current.moved = false
    pointers.set(event.pointerId, point(event))
    const target = event.target.closest('button') || event.currentTarget
    target.setPointerCapture?.(event.pointerId)
  }
  function onPointerMove(event) {
    const state = drag.current
    const before = state.pointers.get(event.pointerId)
    if (!before) return
    const after = point(event)
    if (!state.moved && state.pointers.size === 1 && distance(before, after) < 5) return
    state.moved = true
    event.currentTarget.dataset.dragging = ''
    state.pointers.set(event.pointerId, after)
    const secondId = [...state.pointers.keys()].find(id => id !== event.pointerId)
    const second = state.pointers.get(secondId)
    if (second) {
      zoomBy(distance(after, second) / Math.max(1, distance(before, second)), midpoint(after, second), midpoint(before, second))
    } else {
      panBy(after.x - before.x, after.y - before.y)
    }
  }
  function endPointer(event) {
    const { pointers } = drag.current
    if (pointers.delete(event.pointerId) && !pointers.size) delete event.currentTarget.dataset.dragging
  }
  const controls = {
    onPointerDown, onPointerMove, onPointerUp: endPointer, onPointerCancel: endPointer, onLostPointerCapture: endPointer,
    onClick: event => {
      if (!drag.current.moved && !event.target.closest('button')) onBackgroundClick()
    },
    onDoubleClick: event => {
      if (!event.target.closest('button')) zoomBy(1.5, point(event))
    },
    onKeyDown: event => {
      const movement = { ArrowLeft: [-40, 0], ArrowRight: [40, 0], ArrowUp: [0, -40], ArrowDown: [0, 40] }[event.key]
      if (movement) panBy(...movement)
      else if (event.key === '+' || event.key === '=') zoomBy(1.35)
      else if (event.key === '-') zoomBy(1 / 1.35)
      else if (event.key === '0') fit()
      else return
      event.preventDefault()
    }
  }
  return {
    width, height, mapWidth, left, top, controls, zoomBy, panBy, fit,
    atMinimum: zoom <= minZoom, atMaximum: zoom >= maxZoom,
    shouldOpenPin: event => event.detail === 0 || !drag.current.moved,
    project: (fractionX, fractionY) => [left + fractionX * mapWidth, top + fractionY * mapHeight]
  }
}
