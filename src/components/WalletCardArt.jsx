import CardNetworkMark from './CardNetworkMark'
import { walletCardStyle } from '../lib/walletCard'

export default function WalletCardArt({ wallet, variant = '' }) {
  const finish = wallet.card_finish
  const bank = ['bank','card'].includes(wallet.type)
  return <span className={`budgetly-card-art ${variant} ${finish || 'fixed'}`} style={finish ? undefined : walletCardStyle(wallet.color)}>
    {bank && <span className="budgetly-card-chip" aria-hidden="true"/>}
    <span className="budgetly-card-wordmark" aria-hidden="true">Budgetly</span>
    {bank && <CardNetworkMark network={wallet.card_network || 'visa'}/>}
  </span>
}
