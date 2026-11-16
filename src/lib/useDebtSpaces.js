import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api'
import { debtChanged, debtPath } from './debtWorkspace'

const empty = []

export default function useDebtSpaces(user) {
  const userId = user?.role === 'guest' ? null : user?.id
  const [snapshot, setSnapshot] = useState(null)
  const [failure, setFailure] = useState(null)
  const request = useRef(null)
  const reload = useCallback(async () => {
    if (!userId) return
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    try {
      const spaces = await api(`${debtPath}/spaces`, {signal:controller.signal})
      if (!controller.signal.aborted) {
        setSnapshot({userId,spaces:Array.isArray(spaces) ? spaces : []})
        setFailure(null)
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setFailure({userId,message:error.message})
        throw error
      }
    }
  }, [userId])
  const remember = useCallback(space => {
    request.current?.abort()
    setSnapshot(current => ({userId, spaces:[
      ...(current?.userId === userId ? current.spaces.filter(item => item.id !== space.id) : []), space,
    ].sort((a,b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))}))
  }, [userId])
  const forget = useCallback(id => {
    request.current?.abort()
    setSnapshot(current => current?.userId === userId
      ? {userId,spaces:current.spaces.filter(item => item.id !== id)}
      : current)
    window.dispatchEvent(new CustomEvent(debtChanged,{detail:{deletedSpaceId:id}}))
  }, [userId])
  useEffect(() => {
    if (!userId) return
    const sync = () => { void reload().catch(() => {}) }
    sync()
    window.addEventListener('focus', sync)
    window.addEventListener('online', sync)
    return () => {
      request.current?.abort()
      window.removeEventListener('focus',sync)
      window.removeEventListener('online',sync)
    }
  }, [userId,reload])
  const refresh = useCallback(() => {
    window.dispatchEvent(new Event(debtChanged))
    return reload()
  }, [reload])
  const loaded = Boolean(snapshot && snapshot.userId === userId)
  return {spaces:loaded ? snapshot.spaces : empty, loaded, error:failure && failure.userId === userId ? failure.message : '', reload, remember, forget, refresh}
}
