import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import SpendingMap from './SpendingMap'

const mocks = vi.hoisted(() => ({ api: vi.fn(), app: { settings:{currency:'KWD'}, refreshKey:0 } }))
vi.mock('../App',()=>({ useApp:()=>mocks.app }))
vi.mock('../lib/api',()=>({api:mocks.api,money:n=>'KWD '+Number(n).toFixed(3)}))
beforeEach(()=>{mocks.api.mockReset();mocks.app.refreshKey=0;delete mocks.app.activeSpace})
afterEach(cleanup)
const entry={id:1,type:'expense',amount:1,category_name:'Groceries',description:'Market',wallet_name:'Main',date:'2026-11-14T10:00:00'}

it('loads beyond one ledger page and groups repeated category use by day',async()=>{
  mocks.api.mockResolvedValueOnce(Array.from({length:500},(_,i)=>({...entry,id:i+1})))
    .mockResolvedValueOnce([{...entry,id:501,category_name:'Fuel',description:'Petrol'}])
  render(<SpendingMap/>)
  fireEvent.click(await screen.findByRole('button',{name:'Fuel'}))
  expect(screen.getByText('Petrol')).toBeInTheDocument()
  const url=new URL(mocks.api.mock.calls[1][0],'https://local.test')
  expect(url.searchParams.get('offset')).toBe('500')
  expect(url.searchParams.get('date_from')).toMatch(/-01T00:00:00$/)
  expect(url.searchParams.get('scope')).toBe('personal')
})
it('keeps the last successful read on a temporary error and clears it after permission loss',async()=>{
  mocks.api.mockResolvedValueOnce([entry]).mockRejectedValueOnce(new Error('Offline'))
    .mockRejectedValueOnce(Object.assign(new Error('Access changed'),{status:403}))
  const view=render(<SpendingMap/>)
  await screen.findByRole('button',{name:'Groceries'})
  mocks.app.refreshKey++;view.rerender(<SpendingMap/>)
  const alert=await screen.findByRole('alert')
  expect(alert).toHaveTextContent('Showing the last loaded activity')
  expect(screen.getByRole('button',{name:'Groceries'})).toBeInTheDocument()
  fireEvent.click(within(alert).getByRole('button',{name:'Retry'}))
  await screen.findByText(/Access changed/)
  expect(screen.queryByRole('button',{name:'Groceries'})).toBeNull()
})

it('uses the shared Space ledger and renders date groups in a category popup',async()=>{
  mocks.app.activeSpace = { id: 17, name: 'Home Expense' }
  mocks.api.mockResolvedValue([
    {...entry, category_name: 'Lending money', description: 'Loan to a friend'},
    {...entry, id: 2, date:'2026-11-13T14:00:00', category_name:'Lending money'}
  ])
  render(<SpendingMap/>)
  const marker = await screen.findByRole('button', {name:'Lending money'})
  expect(marker.querySelector('rect')).toBeInTheDocument()
  fireEvent.click(marker)
  const popup = screen.getByRole('article', {name:'Lending money transactions'})
  expect(within(popup).getByText('Loan to a friend')).toBeInTheDocument()
  expect(within(popup).getByText('14 Nov 2026')).toBeInTheDocument()
  expect(within(popup).getByText('13 Nov 2026')).toBeInTheDocument()
  expect(mocks.api.mock.calls[0][0]).toContain('scope=all&space_id=17')
  fireEvent.keyDown(within(popup).getByRole('button', {name:'Close category'}), {key:'Escape'})
  expect(screen.queryByRole('article', {name:'Lending money transactions'})).not.toBeInTheDocument()
  expect(marker).toHaveFocus()
})
