import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Bell, CalendarClock, SlidersHorizontal } from 'lucide-react'
import AppMonthField from '../components/AppMonthField'
import AnimatedMoney from '../components/AnimatedMoney'
import EmptyState from '../components/EmptyState'
import LedgerRow, { TransactionDetails } from '../components/LedgerRow'
import WalletCardArt from '../components/WalletCardArt'
import OverviewCardManager from '../components/OverviewCardManager'
import { api, money } from '../lib/api'
import { dateInput } from '../lib/time'
import { useViewState } from '../lib/viewState'
import { readWorkspacePreferences, useWorkspacePreferences } from '../lib/workspacePreferences'
import { useApp } from '../App'
import '../overview-focus.css'

export default function Overview() {
  const { user, settings, refreshKey, isGuest, activeSpace, spaceKey = 'personal', notify } = useApp()
  const [preferences, savePreferences] = useWorkspacePreferences(user?.id)
  const [managedCards, setManagedCards] = useState(null)
  const [data, setData] = useState(null)
  const [attention, setAttention] = useState(null)
  const [month, setMonth] = useViewState(`overview:${user?.id}:month`, dateInput().slice(0, 7))
  const [error, setError] = useState('')
  const [selected, setSelected] = useState(null)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    const controller = new window.AbortController()
    setError('')
    if (!isGuest) api('/api/attention', { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) setAttention(Number.isInteger(value.count) ? value.count : null) })
      .catch(() => { if (!controller.signal.aborted) setAttention(null) })
    api(`/api/dashboard?month=${month}`, { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) setData(value) })
      .catch(e => { if (!controller.signal.aborted) setError(e.message) })
    return () => controller.abort()
  }, [month, refreshKey, retry, isGuest])

  const fmt = value => money(value, settings.currency, settings.compact_numbers)
  const displayedMonth = data?.month || month
  const [reportYear, reportMonth] = displayedMonth.split('-').map(Number)
  const displayedMonthLabel = new Date(reportYear, reportMonth - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  const otherBalanceActivity = data ? Math.round((Number(data.total_balance) - Number(data.net)) * 1000) / 1000 : 0
  const nextUpcoming = data?.weekly?.upcoming?.next
  const action = !isGuest && (attention > 0
    ? { to: '/attention', title: 'Needs your attention', detail: `${attention} ${attention === 1 ? 'item' : 'items'} to review`, icon: Bell }
    : nextUpcoming ? { to: '/upcoming', title: 'Upcoming payment', detail: nextUpcoming.description, icon: CalendarClock } : null)
  const ActionIcon = action?.icon
  const wallets = data?.wallets || []
  const arrangement = preferences.overviewCards[spaceKey]
  const visibleWallets = arrangement ? arrangement.map(id => wallets.find(wallet => wallet.id === id)).filter(Boolean) : wallets.slice(0,3)
  const lead = visibleWallets[0]
  const saveCards = ids => {
    const next = { ...readWorkspacePreferences(user.id).overviewCards }
    if (ids === null) delete next[spaceKey]
    else next[spaceKey] = ids
    if (savePreferences({ overviewCards:next })) setManagedCards(null)
    else notify('Could not save the card layout on this device.', 'error')
  }

  if (!data && !error) return <div className="skeleton-page"><div/><div/><div/></div>

  return <div className="overview-page overview-focus">
    <div className="overview-top palette-dark-section">
    <section className="overview-balance palette-hero" aria-label="Available wallet balance">
      <div><p className="muted">Available now · {activeSpace ? 'Space wallets' : 'Personal wallets'}</p><h1>{data ? <AnimatedMoney value={data.total_balance} currency={settings.currency} compact={settings.compact_numbers}/> : '-'}</h1></div>
      {lead && <Link to={`/wallets?wallet=${lead.id}`} aria-label={`Open ${lead.name} wallet from balance`}><WalletCardArt wallet={lead} variant="mini"/></Link>}
    </section>
    {wallets.length > 0 && <div className="overview-wallet-shortcuts">
      {visibleWallets.length > 0 && <div className={`overview-wallet-grid${arrangement ? ' custom' : ''}`}>{visibleWallets.map(wallet => <Link to={`/wallets?wallet=${wallet.id}`} key={wallet.id} aria-label={`Open ${wallet.name} wallet`}>
        <WalletCardArt wallet={wallet} variant="mini"/><strong>{wallet.name}</strong><small>{fmt(wallet.balance)}</small>
      </Link>)}</div>}
      <div className="overview-card-actions">
        <Link to="/wallets" className="overview-all-wallets">All wallets <ArrowRight size={16} aria-hidden="true"/></Link>
        <button type="button" className="overview-all-wallets" onClick={() => setManagedCards((arrangement ? visibleWallets : visibleWallets.slice(0, window.matchMedia?.('(max-width: 820px)').matches ? 2 : 3)).map(wallet => wallet.id))}><SlidersHorizontal size={16} aria-hidden="true"/> Manage cards</button>
      </div>
    </div>}
    </div>
    {error && <div className="form-error" role="alert">{error}<button className="button ghost small" onClick={() => setRetry(value => value + 1)}>Retry</button>{data && <small>Showing the last loaded summary for {data.month}.</small>}</div>}
    {data && <div className={`palette-sheet overview-activity-sheet ${data.month !== month ? 'overview-loading' : ''}`} aria-busy={data.month !== month}>
      <section className="overview-focus-month" aria-label="Selected month summary">
        <div className="overview-focus-month-head"><h2>Monthly activity</h2><label className="field"><span className="sr-only">Month</span><AppMonthField min="1000-01" max="9999-12" value={month} onChange={event => event.target.value && setMonth(event.target.value)}/></label></div>
        <div className="overview-focus-metrics">
          <Link to="/transactions" state={{ aiFilters: { month: displayedMonth, type: 'income' } }}><span>Money in</span><strong className="tx-amount income">{fmt(data.income)}</strong></Link>
          <Link to="/transactions" state={{ aiFilters: { month: displayedMonth, type: 'expense', exclude_opening: true } }}><span>Spent</span><strong className="tx-amount expense">{fmt(data.expense)}</strong></Link>
        </div>
      </section>
      {action && <Link to={action.to} className="overview-focus-action"><ActionIcon size={20} aria-hidden="true"/><span><strong>{action.title}</strong><small>{action.detail}</small></span><ArrowRight size={17} aria-hidden="true"/></Link>}
      <section className="overview-section overview-recent">
        <div className="panel-head"><h2>Recent activity</h2><Link to="/transactions" state={{ aiFilters: { month: displayedMonth } }} className="overview-link">View all <ArrowRight size={16} aria-hidden="true"/></Link></div>
        {data.recent_transactions.length ? data.recent_transactions.slice(0, 3).map(tx => <LedgerRow key={tx.id} tx={tx} fmt={fmt} showDate onOpen={() => setSelected(tx)}/>) : <EmptyState title="No transactions this month" text="Add a transaction to start recording your activity."/>}
      </section>
      <details className="overview-balance-details"><summary>Balance &amp; month details</summary><div className="overview-balance-details-content"><p><strong>Wallet balances</strong></p><ul>{(data.wallets || []).map(wallet => <li key={wallet.id}><span>{wallet.name}</span><strong>{fmt(wallet.balance)}</strong></li>)}</ul>{data.opening_funds > 0 && <p>Money in includes {fmt(data.earned_income)} income and {fmt(data.opening_funds)} starting funds.</p>}{data.opening_debt > 0 && <p>Month change includes {fmt(data.opening_debt)} starting debt.</p>}<p>Monthly totals use the month each transaction belongs to. An entry recorded earlier can count toward {displayedMonthLabel}. Changing the month does not change your available balance.</p><p><strong>Why are the figures different?</strong></p><dl><div><dt>Other balance activity</dt><dd>{fmt(otherBalanceActivity)}</dd></div><div><dt>Assigned to {displayedMonthLabel}</dt><dd>{data.net > 0 ? '+' : ''}{fmt(data.net)}</dd></div><div><dt>Available now</dt><dd>{fmt(data.total_balance)}</dd></div></dl><small>This compares reporting allocations with today's wallet balances; it is not your balance on the first day of the month. Transfers between these wallets cancel out.</small></div></details>
    </div>}
    <TransactionDetails tx={selected} fmt={fmt} onClose={() => setSelected(null)}/>
    {managedCards && <OverviewCardManager wallets={wallets} initialIds={managedCards} onSave={saveCards} onClose={() => setManagedCards(null)}/>}
  </div>
}
