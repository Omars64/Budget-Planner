import {expect,test} from 'vitest'
import {currencyDigits,currencyStep,currencyPlaceholder,validCurrency} from './currency'
import {money} from './api'

test('uses standard currency precision rather than KWD-only formatting',()=>{
  expect(currencyDigits('KWD')).toBe(3)
  expect(currencyDigits('BHD')).toBe(3)
  expect(currencyDigits('USD')).toBe(2)
  expect(currencyDigits('JPY')).toBe(0)
  expect(currencyStep('USD')).toBe('0.01')
  expect(currencyPlaceholder('JPY')).toBe('0')
  expect(money(12.345,'BHD')).toContain('12.345')
  expect(money(12.345,'USD')).toContain('12.35')
  expect(money(12,'JPY')).not.toContain('.00')
  expect(validCurrency('NOT')).toBe(false)
})
