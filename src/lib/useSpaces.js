import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, hasPendingWrites } from './api'
import { setApiSpace, readSpaceSelection, rememberSpaceSelection } from './spaces'

export default function useSpaces(user, notify, confirm) {
  const [spaces, setSpaces] = useState([])
  const [activeSpace, setActiveSpace] = useState(null)
  const [loadedUser, setLoadedUser] = useState(null)
  const available = useRef([])
  const active = useRef(null)
  const identity = useRef(user?.id)
  identity.current = user?.id
  const navigate = useNavigate()
  const navigation = useRef(navigate)
  navigation.current = navigate
  const apply = useCallback((space, userId) => {
    active.current = space; setApiSpace(space?.id)
    rememberSpaceSelection(userId, space?.id); setActiveSpace(space)
  }, [])
  const reloadSpaces = useCallback(async () => {
    if (!user?.id || user.role === 'guest') return []
    const userId = user.id
    const rows = await api('/api/spaces')
    if (identity.current !== userId) return []
    available.current = rows; setSpaces(rows)
    if (active.current) {
      const current = rows.find(space => space.id === active.current.id)
      apply(current || null, userId)
      if (!current) { navigation.current('/', {replace:true}); notify('Space access changed. You are back in Personal.') }
    }
    return rows
  }, [user?.id, user?.role, apply, notify])
  useEffect(() => {
    setApiSpace(null); setActiveSpace(null); active.current = null
    available.current = []; setSpaces([])
    if (!user?.id || user.role === 'guest') return
    const selected = readSpaceSelection(user.id)
    let alive = true
    reloadSpaces().then(rows => { if (alive && selected) apply(rows.find(space => space.id === selected) || null, user.id) })
      .catch(error => { if (alive) notify(`Spaces could not load: ${error.message}`, 'error') })
      .finally(() => { if (alive) setLoadedUser(user.id) })
    return () => { alive = false }
  }, [user?.id, user?.role, reloadSpaces, apply, notify])
  useEffect(() => {
    if (!user?.id || user.role === 'guest') return
    const refresh = () => { if (navigator.onLine && document.visibilityState !== 'hidden') void reloadSpaces().catch(() => {}) }
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [user?.id, user?.role, reloadSpaces])
  const switchSpace = useCallback(async id => {
    if (hasPendingWrites()) { notify('Finish saving before switching spaces.', 'error'); return false }
    const space = id == null ? null : available.current.find(row => row.id === Number(id))
    if (id != null && !space) { notify('This space is no longer available.', 'error'); return false }
    if ((active.current?.id || null) === (space?.id || null)) return true
    if (document.querySelector('form[data-dirty="true"]') && !await confirm('Switch spaces? Saved drafts stay in their original space.')) return false
    apply(space, user?.id); navigation.current('/', {replace:true}); return true
  }, [apply, user?.id, notify, confirm])
  return { activeSpace, spaces, switchSpace, reloadSpaces, spacesReady: !user || user.role === 'guest' || loadedUser === user.id }
}
