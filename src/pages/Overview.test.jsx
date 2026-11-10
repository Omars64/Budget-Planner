import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Overview from './Overview'
vi.mock('../App',()=>({useApp:()=>({user:{id:1},settings:{currency:'KWD'},refreshKey:0})}))
vi.mock('../lib/api',()=>({api:vi.fn(async()=>({month:'2026-09',total_balance:30,income:100,earned_income:70,opening_funds:30,expense:70,net:30,wallets:[],budgets:[],category_spending:[],recent_transactions:[],shared:{balance:50,wallet_count:1}})),money:v=>`KWD ${v}`}))
afterEach(cleanup)
it('shows the essential summary and opens reporting details on demand',async()=>{
  render(<MemoryRouter><Overview/></MemoryRouter>)
  expect(await screen.findByText('Available now · Personal wallets')).toBeInTheDocument()
  expect(screen.getByRole('heading',{name:'KWD 30'})).toBeInTheDocument()
  expect(screen.getByRole('heading',{name:'Monthly activity'})).toBeInTheDocument()
  expect(screen.getByLabelText('Selected month summary')).toHaveTextContent('Money inKWD 100SpentKWD 70')
  expect(screen.queryByText('Needs your attention')).not.toBeInTheDocument()
  expect(screen.queryByText('Money in includes KWD 70 income and KWD 30 starting funds.')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button',{name:'Balance & month details'}))
  const details = within(screen.getByRole('dialog',{name:'Balance & month details'}))
  expect(details.getByText('Money in includes KWD 70 income and KWD 30 starting funds.')).toBeInTheDocument()
  expect(screen.queryByText("Month's net change")).toBeNull()
  expect(screen.queryByLabelText('Shared wallets summary')).toBeNull()
  expect(screen.queryByRole('button',{name:/add transaction/i})).toBeNull()
  expect(screen.queryByRole('link',{name:/add transaction/i})).toBeNull()
})
