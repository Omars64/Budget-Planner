import './CardNetworkMark.css'

export default function CardNetworkMark({ network = 'visa' }) {
  return network === 'mastercard'
    ? <span className="card-network-mark wallet-network-mark mastercard" role="img" aria-label="Mastercard"><i aria-hidden="true"/><i aria-hidden="true"/></span>
    : <span className="card-network-mark wallet-network-mark visa" role="img" aria-label="Visa">VISA</span>
}
