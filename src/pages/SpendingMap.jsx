import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { MapPin, Maximize, Minus, Plus, X } from 'lucide-react'
import { useApp } from '../App'
import { api, money } from '../lib/api'
import { categoryAppearance } from '../lib/categoryIcons'
import { clockTime, dateKey } from '../lib/time'
import useMapCamera, { clamp } from '../lib/useMapCamera'
import SettingsHelp from '../components/SettingsHelp'
import './SpendingMap.css'

const sites = [[.56,.13],[.43,.23],[.64,.25],[.38,.37],[.56,.34],[.58,.45],[.73,.49],[.32,.51],
  [.46,.54],[.69,.63],[.36,.66],[.50,.69],[.61,.75],[.54,.85],[.28,.85],[.48,.94]]
const monthFormat = new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })
const dayFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const kinds = { expense: 'Expense', income: 'Income', transfer: 'Transfer' }
function pinPosition(index) {
  const [x, y] = sites[index % sites.length]
  const layer = Math.floor(index / sites.length)
  if (!layer) return [x, y]
  const angle = layer * 2.39996
  const radius = Math.min(.12, .053 * Math.sqrt(layer))
  return [x + Math.cos(angle) * radius, y + Math.sin(angle) * radius]
}

function groupTransactions(rows) {
  const buckets = new Map()
  for (const tx of rows) {
    const name = tx.is_opening_balance ? 'Opening balances' : tx.type === 'transfer' ? 'Wallet transfers' : tx.category_name || 'Uncategorized'
    if (!buckets.has(name)) {
      buckets.set(name, { name, count: 0, days: new Map(), ...categoryAppearance(name, {
        type: tx.type, openingBalance: tx.is_opening_balance
      }) })
    }
    const group = buckets.get(name)
    const day = dateKey(tx.date)
    if (!group.days.has(day)) group.days.set(day, [])
    group.days.get(day).push(tx)
    group.count++
  }
  return [...buckets.values()].sort((a, b) => a.name.localeCompare(b.name))
}

const MapTransactions = memo(function MapTransactions({ group, currency }) {
  return [...group.days].map(([day, txs]) => <section key={day}>
    <h3><time dateTime={day}>{dayFormat.format(new Date(day + 'T00:00:00Z'))}</time></h3>
    {txs.map(tx => {
      const description = tx.description || group.name
      const wallet = [tx.wallet_name || 'Wallet', tx.transfer_wallet_name].filter(Boolean).join(' → ')
      const amount = money(tx.amount, currency)
      return <div className="atlas-tx" key={tx.id}>
        <b title={description}>{description}</b>
        <span className="atlas-tx-amount" data-type={tx.type} aria-label={(kinds[tx.type] || 'Transaction') + ' ' + amount}>{tx.type === 'expense' ? '−' : tx.type === 'income' ? '+' : ''}{amount}</span>
        <span className="atlas-tx-wallet" title={wallet}>{wallet}</span>
        <time dateTime={tx.date}>{clockTime(tx.date)}</time>
      </div>
    })}
  </section>)
})

export default function SpendingMap() {
  const { settings, activeSpace, refreshKey } = useApp()
  const [month, setMonth] = useState(() => dateKey().slice(0, 7))
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [selected, setSelected] = useState('')
  const viewport = useRef(null)
  const popupClose = useRef(null)
  const popupBody = useRef(null)
  const trigger = useRef(null)
  const camera = useMapCamera(viewport, () => closePin(false))

  useEffect(() => {
    const tick = () => setMonth(dateKey().slice(0, 7))
    const timer = setInterval(tick, 60000)
    window.addEventListener('focus', tick)
    return () => { clearInterval(timer); window.removeEventListener('focus', tick) }
  }, [])

  useEffect(() => { setRows(null); setSelected(''); setError('') }, [month])

  const spaceId = activeSpace?.id || 'personal'
  useEffect(() => {
    const controller = new AbortController()
    const batch = 500
    async function load() {
      const [year, monthNumber] = month.split('-').map(Number)
      const last = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()
      const collected = new Map()
      for (let offset = 0; ; offset += batch) {
        const query = new URLSearchParams({
          scope: spaceId === 'personal' ? 'personal' : 'all', space_id: spaceId, date_from: month + '-01T00:00:00',
          date_to: month + '-' + last + 'T23:59:59.999999', sort: 'newest', limit: batch, offset
        })
        const page = await api('/api/transactions?' + query, { signal: controller.signal })
        if (controller.signal.aborted) return
        for (const tx of page) collected.set(tx.id, tx)
        if (page.length < batch) break
      }
      setRows([...collected.values()])
      setError('')
    }
    load().catch(failure => {
      if (controller.signal.aborted) return
      if ([401, 403].includes(failure.status)) setRows(null)
      setError(failure.message)
    })
    return () => controller.abort()
  }, [month, retry, refreshKey, spaceId])

  const groups = useMemo(() => groupTransactions(rows || []), [rows])
  const activeIndex = groups.findIndex(group => group.name === selected)
  const active = groups[activeIndex]
  const [pinX, pinY] = active ? camera.project(...pinPosition(activeIndex)) : [0, 0]
  const popupWidth = Math.min(520, camera.width - 24)
  const popupLeft = clamp(pinX - popupWidth / 2, 12, camera.width - popupWidth - 12)
  const above = pinY - 26 - 64
  const below = camera.height - pinY - 26 - 12
  const placeBelow = above < 275 && below > above
  const popupStyle = {
    '--popup-anchor': clamp(pinX - popupLeft, 12, popupWidth - 12) + 'px',
    '--popup-room': Math.max(74, (placeBelow ? below : above) - 63) + 'px',
    '--pin': active?.color,
    left: popupLeft,
    top: pinY + (placeBelow ? 26 : -26),
    visibility: camera.width && (pinX < 0 || pinX > camera.width || pinY < 25 || pinY > camera.height - 25) ? 'hidden' : undefined
  }

  const activeName = active?.name
  useEffect(() => {
    if (!activeName) return
    popupClose.current?.focus({ preventScroll: true })
    if (popupBody.current) popupBody.current.scrollTop = 0
  }, [activeName])

  function closePin(restore = true) {
    if (!active) return
    setSelected('')
    if (restore) (trigger.current?.isConnected ? trigger.current : viewport.current)?.focus({ preventScroll: true })
  }
  function openPin(index, from) {
    const group = groups[index]
    if (!group) return closePin()
    trigger.current = from
    const [x, y] = camera.project(...pinPosition(index))
    const dx = x < 30 || x > camera.width - 30 ? camera.width / 2 - x : 0
    const dy = y < 115 || y > camera.height - 55 ? camera.height / 2 - y : 0
    if (camera.width && (dx || dy)) camera.panBy(dx, dy)
    setSelected(group.name)
  }

  return <section className="spending-atlas">
    <div className="atlas-stage" onKeyDown={event => {
      if (event.key === 'Escape' && active) { event.stopPropagation(); closePin() }
    }}>
      <div className="atlas-viewport" ref={viewport} tabIndex={0}
        aria-label="Spending map. Use plus and minus to zoom and arrow keys to pan."
        {...camera.controls}>
        <img className="atlas-island" src="/after-hours/region.webp" alt="" draggable="false"
          style={{ width: camera.mapWidth, transform: `translate(${camera.left}px,${camera.top}px)` }}/>
        {groups.map(({ name, Icon, color }, index) => {
          const [x, y] = camera.project(...pinPosition(index))
          const onScreen = !camera.width || (x >= 0 && x <= camera.width && y >= 0 && y <= camera.height)
          return <button type="button" key={name} className="atlas-pin" style={{ left: x, top: y, '--pin': color }}
            tabIndex={onScreen ? 0 : -1} aria-expanded={activeIndex === index} aria-label={name} title={name}
            onClick={event => {
              if (!camera.shouldOpenPin(event)) return
              if (activeIndex === index) closePin()
              else openPin(index, event.currentTarget)
            }}><Icon size={19} aria-hidden="true"/></button>
        })}
      </div>
      <div className="atlas-toolbar">
        <span className="atlas-scope"><strong title={activeSpace?.name}>{activeSpace?.name || 'Personal'}</strong><span aria-hidden="true">&middot;</span><time dateTime={month}>{monthFormat.format(new Date(month + '-01T00:00:00Z'))}</time></span>
        <div className="atlas-zoom">
          <button type="button" aria-label="Zoom out" disabled={camera.atMinimum} onClick={() => camera.zoomBy(1 / 1.35)}><Minus size={19}/></button>
          <button type="button" aria-label="Fit whole map" title="Fit whole map" onClick={camera.fit}><Maximize size={18}/></button>
          <button type="button" aria-label="Zoom in" disabled={camera.atMaximum} onClick={() => camera.zoomBy(1.35)}><Plus size={19}/></button>
        </div>
        <SettingsHelp title="About Spending Map"><p>Drag to pan. Pinch or scroll to zoom. Each pin groups this month’s transactions by category and recorded date. Pin locations are illustrative.</p></SettingsHelp>
      </div>
      {!!groups.length && <label className="atlas-category-picker"><MapPin size={16} aria-hidden="true"/>
        <select aria-label="Find a category" value={active?.name || ''} onChange={event => openPin(groups.findIndex(group => group.name === event.target.value), event.currentTarget)}>
          <option value="">Find a category</option>{groups.map(group => <option key={group.name}>{group.name}</option>)}
        </select>
      </label>}
      {error && <div className="atlas-message" role="alert">{rows ? 'Showing the last loaded activity. ' : ''}{error} <button type="button" className="button ghost small" onClick={() => setRetry(value => value + 1)}>Retry</button></div>}
      {!rows && !error && <p className="atlas-message" role="status">Loading this month’s transactions…</p>}
      {rows?.length === 0 && <p className="atlas-message">No transactions this month.</p>}
      {active && <article className="atlas-popup" aria-label={active.name + ' transactions'} data-below={placeBelow} style={popupStyle}>
        <header>
          <span className="atlas-popup-icon"><active.Icon size={19} aria-hidden="true"/></span>
          <div><h2>{active.name}</h2><small>{active.count} {active.count === 1 ? 'transaction' : 'transactions'}</small></div>
          <button type="button" ref={popupClose} aria-label="Close category" onClick={() => closePin()}><X size={17}/></button>
        </header>
        <div className="atlas-popup-body" ref={popupBody} tabIndex={0} aria-label="Transactions by date">
          <MapTransactions group={active} currency={settings.currency}/>
        </div>
      </article>}
    </div>
  </section>
}
