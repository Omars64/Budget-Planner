import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api'
import { debtChanged, debtPath } from './debtWorkspace'

const empty = []

export default function useDebtSpaces(user) {
  const userId = user?.role === 'guest' ? null : user?.id
  const [snapshot, setSnapshot] = useState(null)
  const request = useRef(null)
  const reload = useCallback(async () => {
    if (!userId) return
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    try {
      const spaces = await api(`${debtPath}/spaces`, {signal:controller.signal})
      if (!controller.signal.aborted) setSnapshot({userId,spaces:Array.isArray(spaces) ? spaces : []})
    } catch (error) {
      if (!controller.signal.aborted) throw error
    }
  }, [userId])
  const remember = useCallback(space => {
    request.current?.abort()
    setSnapshot(current => ({userId, spaces:[
      ...(current?.userId === userId ? current.spaces.filter(item => item.id !== space.id) : []), space,
    ]}))
  }, [userId])
  useEffect(() => {
    if (!userId) return
    const sync = () => { void reload().catch(() => {}) }
    sync()
    window.addEventListener('focus', sync)
    return () => { request.current?.abort(); window.removeEventListener('focus',sync) }
  }, [userId,reload])
  const refresh = useCallback(() => {
    window.dispatchEvent(new Event(debtChanged))
    return reload()
  }, [reload])
  return {spaces:snapshot && snapshot.userId === userId ? snapshot.spaces : empty, reload, remember, refresh}
}
