import { useState } from 'react'
import { Reorder, useDragControls } from 'framer-motion'
import { ArrowDown, ArrowUp, GripVertical, Plus, X } from 'lucide-react'
import Modal from './Modal'
import WalletCardArt from './WalletCardArt'

function ArrangedCard({ wallet, index, count, move, remove }) {
  const controls = useDragControls()
  return <Reorder.Item value={wallet.id} dragListener={false} dragControls={controls} className="card-manager-item">
    <span className="card-manager-grip" onPointerDown={event => controls.start(event)} aria-hidden="true"><GripVertical size={19}/></span>
    <WalletCardArt wallet={wallet} variant="mini"/>
    <strong>{wallet.name}</strong>
    <div className="card-manager-move">
      <button type="button" className="icon-button" aria-label={`Move ${wallet.name} up`} disabled={!index} onClick={() => move(index, -1)}><ArrowUp size={16}/></button>
      <button type="button" className="icon-button" aria-label={`Move ${wallet.name} down`} disabled={index === count - 1} onClick={() => move(index, 1)}><ArrowDown size={16}/></button>
      <button type="button" className="icon-button" aria-label={`Hide ${wallet.name}`} onClick={() => remove(wallet.id)}><X size={16}/></button>
    </div>
  </Reorder.Item>
}

export default function OverviewCardManager({ wallets, initialIds, onSave, onClose }) {
  const [ids, setIds] = useState(initialIds)
  const available = new Map(wallets.map(wallet => [wallet.id, wallet]))
  const ordered = ids.filter(id => available.has(id))
  const hidden = wallets.filter(wallet => !ordered.includes(wallet.id))
  const move = (index, offset) => {
    const next = [...ordered]
    const other = index + offset
    next[index] = ordered[other]
    next[other] = ordered[index]
    setIds(next)
  }
  return <Modal open onClose={onClose} title="Manage cards" subtitle="Choose which cards appear on Overview. Drag a handle or use the arrows to reorder them." protectChanges isDirty={JSON.stringify(ids) !== JSON.stringify(initialIds)}
    footer={<div className="modal-actions"><button type="button" className="button ghost" onClick={() => onSave(null)}>Use default</button><button type="button" className="button primary" onClick={() => onSave(ordered)}>Save cards</button></div>}>
    <div className="card-manager stack gap-12">
      <h3>Shown on Overview</h3>
      {ordered.length ? <Reorder.Group axis="y" values={ordered} onReorder={setIds} className="card-manager-list" aria-label="Shown cards">
        {ordered.map((id,index) => <ArrangedCard key={id} wallet={available.get(id)} index={index} count={ordered.length} move={move} remove={id => setIds(ordered.filter(value => value !== id))}/>)}
      </Reorder.Group> : <p className="muted">No cards shown. Your total balance still includes all active wallets.</p>}
      {hidden.length > 0 && <><h3>Available cards</h3><ul className="card-manager-list">
        {hidden.map(wallet => <li key={wallet.id}><button type="button" className="card-manager-add" onClick={() => setIds([...ordered,wallet.id])} aria-label={`Show ${wallet.name}`}><WalletCardArt wallet={wallet} variant="mini"/><strong>{wallet.name}</strong><Plus size={18} aria-hidden="true"/></button></li>)}
      </ul></>}
    </div>
  </Modal>
}
