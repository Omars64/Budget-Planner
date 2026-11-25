import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import SpendingMap from './SpendingMap'

const mocks = vi.hoisted(() => ({ api: vi.fn(), app: { settings:{currency:'KWD'}, refreshKey:0 } }))
vi.mock('../App',()=>({ useApp:()=>mocks.app }))
vi.mock('../lib/api',()=>({api:mocks.api,money:n=>'KWD '+Number(n).toFixed(3)}))
beforeEach(()=>{mocks.api.mockReset();mocks.app.refreshKey=0})
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
