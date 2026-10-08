import { describe, expect, it } from 'vitest'
import { normalizeBankText, normalizeMerchant, parseBankNotification } from './parser'
import fixtures from '../../../tests/fixtures/bank_notifications/synthetic.json'

const parse = text => parseBankNotification({ text, postedAt: Date.UTC(2026, 9, 8, 12), packageName: 'test.bank' })
describe('bank alert parser', () => {
  it.each(fixtures)('fixture: $name', fixture => expect(parse(fixture.text).transaction_type || null).toBe(fixture.kind))
  it.each(['KWD 12.500', '12.500 KWD', 'KD 12.500', 'K.D. 12.500', 'د.ك 12.500', '12.500 د.ك'])('parses %s without floating point', amount => {
    expect(parse(`Purchase ${amount} at TALABAT.`)).toMatchObject({ recognized: true, amount: '12.500', currency: 'KWD', merchant: 'Talabat', transaction_type: 'expense' })
  })
  it('normalizes Arabic and Persian digits, separators and comma groups', () => {
    expect(normalizeBankText('١۲٣')).toBe('123')
    expect(parse('Purchase KWD ١٬٢٣٤٫٥٠٠ at Shop')).toMatchObject({ amount: '1234.500' })
  })
  it.each([['Salary credited KWD 500.000', 'income'], ['KWD 25.000 credited after reversal', 'refund'], ['ATM withdrawal KWD 50.000', 'withdrawal'], ['KWD 100.000 transferred to beneficiary', 'transfer']])('classifies %s', (text, type) => expect(parse(text).transaction_type).toBe(type))
  it.each(['Your OTP is 492183. Do not share this code.', 'Purchase KWD 5.000 verification code 12345', 'New offer: payment KWD 5.000', 'Your statement is ready KWD 5.000', 'Your balance is KWD 50.000', 'Random words', '', 'Purchase KWD 0.000', 'Purchase USD 1.001'])('rejects %s', text => expect(parse(text).recognized).toBe(false))
  it('keeps missing merchant honest and parses card endings', () => {
    expect(parse('Purchase of KWD 12.500')).toMatchObject({ recognized: true, merchant: 'Unknown merchant' })
    for (const ending of ['ending 1234', 'ending in 1234', 'card xx1234', 'account xxxx1234', '****1234']) expect(parse(`Purchase KWD 5.000 ${ending}`).account_last4).toBe('1234')
  })
  it('distinguishes transaction amounts from available balances and flags ambiguity', () => {
    expect(parse('Purchase KWD 5.000 at Shop; Balance KWD 100.000').amount).toBe('5.000')
    expect(parse('Purchase KWD 5.000 or KWD 6.000').confidence).toBe(0.55)
  })
  it('normalizes only known merchant aliases', () => {
    for (const name of ['TALABAT.COM', 'TALABAT*12345', 'TALABAT KW']) expect(normalizeMerchant(name)).toBe('Talabat')
    expect(normalizeMerchant('Talabat Grocery Store')).toBe('Talabat Grocery Store')
  })
  it('never keeps a full card number in merchant details', () => expect(parse('Purchase KWD 5.000 at Merchant 4111111111111111').merchant).not.toContain('4111111111111111'))
  it.each(['Purchase KWD 1.2345', 'Purchase 1.2345 KWD', 'Purchase XXKWD 5.000', 'Purchase KWD 5.000USD'])('never accepts a partial amount or currency: %s', text => expect(parse(text).recognized).toBe(false))
})
