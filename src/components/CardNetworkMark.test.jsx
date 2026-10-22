import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import CardNetworkMark from './CardNetworkMark'
import markCss from './CardNetworkMark.css?raw'
import coherentCss from '../coherent-app.css?raw'
import walletCss from '../wallet-notes-polish.css?raw'

afterEach(() => {
  cleanup()
  document.head.querySelectorAll('[data-network-test]').forEach(style => style.remove())
})

it('exposes one named image per network and preserves the existing mark conventions', () => {
  const { rerender } = render(<CardNetworkMark/>)
  const mark = screen.getByRole('img', { name: 'Visa' })
  expect(mark).toHaveClass('card-network-mark', 'wallet-network-mark', 'visa')
  expect(mark).toHaveTextContent('VISA')

  rerender(<CardNetworkMark network="mastercard"/>)
  expect(screen.getAllByRole('img')).toHaveLength(1)
  expect(screen.getByRole('img', { name: 'Mastercard' })).toBe(mark)
  expect(mark).toHaveClass('mastercard')
  expect(mark).not.toHaveClass('visa')
  expect(mark.querySelectorAll('i[aria-hidden="true"]')).toHaveLength(2)

  rerender(<CardNetworkMark network="unknown"/>)
  expect(screen.getByRole('img', { name: 'Visa' })).toBe(mark)
})

it.each(['visa', 'mastercard'])('keeps %s dimensions fixed with shared CSS and large inherited fonts', network => {
  const style = document.createElement('style')
  style.dataset.networkTest = ''
  style.textContent = [coherentCss, walletCss, markCss].join('\n')
  document.head.append(style)
  render(<div className="budgetly-v2" style={{ fontSize: '32px' }}>
    <div className="wallet-card payment-card">
      <div className="wallet-card-balance"><strong>Wallet name</strong></div>
      <CardNetworkMark network={network}/>
    </div>
    <div className="wallet-card-preview"><footer><CardNetworkMark network={network}/></footer></div>
    <div className="wallet-network-options"><button><CardNetworkMark network={network}/></button></div>
  </div>)

  for (const mark of screen.getAllByRole('img')) {
    const computed = getComputedStyle(mark)
    expect(computed.width).toBe('62.5px')
    expect(computed.height).toBe('37.5px')
    expect(computed.flexShrink).toBe('0')
    if (network === 'visa') expect(computed.fontSize).toBe('25px')
    else for (const circle of mark.children) {
      expect(getComputedStyle(circle).width).toBe('28.75px')
      expect(getComputedStyle(circle).height).toBe('28.75px')
    }
  }
  expect(getComputedStyle(screen.getByText('Wallet name')).minHeight).toBe('40px')
})
