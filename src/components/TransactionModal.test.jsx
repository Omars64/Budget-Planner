import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import TransactionModal from './TransactionModal'
import { api } from '../lib/api'

vi.mock('../App', () => ({useApp:() => ({user:{id:9},settings:{currency:'KWD'}})}))
vi.mock('../lib/api', () => ({api:vi.fn(),jsonBody:data=>({body:JSON.stringify(data)}),money:n=>'KWD '+Number(n||0).toFixed(3)}))
afterEach(cleanup)
beforeEach(() => {
  sessionStorage.clear(); vi.clearAllMocks()
  api.mockImplementation(path => Promise.resolve(path==='/api/wallets' ? [{id:1,name:'Main Wallet',balance:50}] : path==='/api/categories' ? [{id:2,name:'Food',kind:'expense'}] : {}))
})
async function mount() {
  render(<TransactionModal open onClose={vi.fn()} onSaved={vi.fn()}/> )
  await waitFor(() => expect(screen.getByRole('button',{name:'Add transaction'})).toBeEnabled())
}
it('removes template controls and explains invalid amounts', async () => {
  await mount()
  expect(screen.queryByText('Saved template')).not.toBeInTheDocument()
  expect(screen.queryByText('Save template')).not.toBeInTheDocument()
  expect(screen.getByLabelText('Description').closest('details')).toBeNull()
  expect(api).not.toHaveBeenCalledWith('/api/transaction-templates')
  fireEvent.click(screen.getByRole('button',{name:'Add transaction'}))
  expect(screen.getByRole('alert')).toHaveTextContent('amount greater than zero')
})
it.each(['daily','weekly','monthly','yearly'])('requires a valid end date for %s schedules', async frequency => {
  await mount()
  fireEvent.change(screen.getByLabelText('Amount (KWD)'),{target:{value:'1'}})
  fireEvent.change(screen.getByLabelText('Date & time'),{target:{value:'2026-09-12T12:00'}})
  fireEvent.click(screen.getByText('More options'))
  fireEvent.change(screen.getByLabelText('Repeat'),{target:{value:frequency}})
  fireEvent.click(screen.getByRole('button',{name:'Add transaction'}))
  expect(screen.getByRole('alert')).toHaveTextContent('repeat-until date')
  fireEvent.change(screen.getByLabelText('Repeat until'),{target:{value:'2026-09-11'}})
  fireEvent.click(screen.getByRole('button',{name:'Add transaction'}))
  expect(screen.getByRole('alert')).toHaveTextContent('on or after')
  fireEvent.change(screen.getByLabelText('Repeat until'),{target:{value:'2026-10-12'}})
  fireEvent.click(screen.getByRole('button',{name:'Add transaction'}))
  await waitFor(() => expect(api).toHaveBeenCalledWith('/api/transactions',expect.objectContaining({method:'POST'})))
  const payload=JSON.parse(api.mock.calls.find(([path])=>path==='/api/transactions')[1].body)
  expect(payload.recurring_until).toBe('2026-10-12')
  expect(payload.recurring_frequency).toBe(frequency)
})
it('submits only once while saving, even after repeated clicks', async () => {
  await mount()
  api.mockImplementation(() => new Promise(() => {}))
  fireEvent.change(screen.getByLabelText('Amount (KWD)'),{target:{value:'1'}})
  const save=screen.getByRole('button',{name:'Add transaction'})
  fireEvent.click(save);fireEvent.click(save);fireEvent.click(save)
  expect(api.mock.calls.filter(([path])=>path==='/api/transactions')).toHaveLength(1)
  expect(screen.getByRole('button',{name:'Saving…'})).toBeDisabled()
})
