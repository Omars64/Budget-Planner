export default function CardNetworkMark({ network = 'visa' }) {
  return network === 'mastercard'
    ? <span className="card-network-mark mastercard" role="img" aria-label="Mastercard"><i/><i/></span>
    : <span className="card-network-mark visa" role="img" aria-label="Visa">VISA</span>
}
