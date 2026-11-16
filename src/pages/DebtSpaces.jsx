import { useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Check, Landmark, Plus, Settings2, Users } from 'lucide-react'
import { useApp } from '../App'
import InfoButton from '../components/InfoButton'
import Modal from '../components/Modal'
import { hasPendingWrites } from '../lib/api'
import { debtRoles, debtUrl } from '../lib/debtWorkspace'
import DebtSpaceManagement from './DebtSpaceManagement'

const currentMarker = <><span className="space-current-label">Current workspace</span><Check size={18} aria-hidden="true"/></>

export default function DebtSpaces({ spaceId, requestedPreview }) {
  const { accountSettings, settings, debtSpaces, debtSpacesLoaded, debtSpacesError, reloadDebtSpaces, notify } = useApp()
  const navigate = useNavigate()
  const [selection, setSelection] = useState(null)
  const [help, setHelp] = useState(false)
  const [checked, setChecked] = useState(false)
  const current = debtSpaces.find(space => space.id === spaceId)
  const preview = current?.role === 'owner' && ['view','edit'].includes(requestedPreview) ? requestedPreview : null
  const selected = debtSpaces.find(space => space.id === selection)
  const currency = accountSettings?.currency || settings.currency || 'KWD'
  const reload = () => { void reloadDebtSpaces().then(() => setChecked(true)).catch(() => {}) }
  useEffect(() => {
    let active = true
    void reloadDebtSpaces().then(() => { if (active) setChecked(true) }).catch(() => {})
    return () => { active = false }
  }, [reloadDebtSpaces])

  if (spaceId && checked && debtSpacesLoaded && !current) return <Navigate to={debtUrl(null,'directory')} replace/>
  const switchTo = id => {
    if (hasPendingWrites()) { notify('Finish saving before switching spaces.', 'error'); return }
    navigate(debtUrl(id) + (id === spaceId && preview ? `?preview=${preview}` : ''))
  }

  return <section className="debt-spaces space-library-options stack gap-16" aria-labelledby="debt-spaces-title">
    <div className="debt-heading"><h2 id="debt-spaces-title">Your debt spaces</h2>
      <InfoButton label="About debt spaces" onClick={() => setHelp(true)}/></div>
    {debtSpacesError ? <p className="form-error" role="alert">{debtSpacesError} <button type="button" className="button ghost" onClick={reload}>Retry</button></p>
      : !debtSpacesLoaded && <p className="muted" role="status">Loading debt spaces…</p>}
    <div className="space-options">
      <button type="button" className={`space-library-personal${spaceId ? '' : ' selected'}`} aria-current={!spaceId || undefined} onClick={() => switchTo(null)}>
        <Landmark aria-hidden="true"/><span><strong>Debt Management</strong><small>Your private loans, repayments and money lent</small><small>Only you</small></span>
        {!spaceId && currentMarker}
      </button>
      {debtSpaces.map(space => {
        const active = space.id === spaceId
        const action = space.role === 'owner' && !preview ? 'Manage workspace' : 'View settings & members'
        return <div className={`space-option-row debt-space-row${active ? ' selected' : ''}`} key={space.id}>
          <button type="button" className="space-option-choose" aria-current={active || undefined} aria-label={`Switch to ${space.name}`} onClick={() => switchTo(space.id)}>
            <Users aria-hidden="true"/><span><strong>{space.name}</strong>
              {space.owner_name && <small>Created by {space.role === 'owner' ? 'you' : space.owner_name}</small>}
              <span className="space-library-meta"><span>{space.member_count} {space.member_count === 1 ? 'member' : 'members'}</span>
                <span>{debtRoles[(active && preview) || space.role]}</span>{space.currency && <span>{space.currency}</span>}</span>
            </span>{active && currentMarker}
          </button>
          <button type="button" className="space-option-manage" aria-label={`${action} ${space.name}`} onClick={() => setSelection(space.id)}>
            <Settings2 size={16} aria-hidden="true"/><span>{action}</span>
          </button>
        </div>
      })}
      {!preview && <button type="button" className="button primary space-library-create" onClick={() => setSelection('create')}><Plus size={18}/>Create debt space</button>}
    </div>
    <Modal open={help} onClose={() => setHelp(false)} title="About debt spaces" size="small">
      <p>Owners manage access and can delete a space. Managers can add and change debt records. Viewers can read records and payment history.</p>
    </Modal>
    {(selection === 'create' || selected) && <DebtSpaceManagement key={selection} space={selected} currency={currency}
      readOnly={Boolean(preview)} onClose={() => setSelection(null)} onDeleted={id => {
        if (id === spaceId) setChecked(true)
        setSelection(null)
      }}/>}
  </section>
}
