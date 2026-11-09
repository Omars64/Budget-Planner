import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Overview from './Overview'
vi.mock('../App',()=>({useApp:()=>({user:{id:1},settings:{currency:'KWD'},refreshKey:0})}))
vi.mock('../lib/api',()=>({api:vi.fn(async()=>({month:'2026-09',total_balance:30,income:100,earned_income:70,opening_funds:30,expense:70,net:30,wallets:[],budgets:[],category_spending:[],recent_transactions:[],shared:{balance:50,wallet_count:1}})),money:v=>`KWD ${v}`}))
afterEach(cleanup)
it('keeps the essential mobile summary visible and reporting details collapsed',async()=>{
  render(<MemoryRouter><Overview/></MemoryRouter>)
  expect(await screen.findByText('Available now · Personal wallets')).toBeInTheDocument()
  expect(screen.getByRole('heading',{name:'KWD 30'})).toBeInTheDocument()
  expect(screen.getByRole('heading',{name:'September 2026 activity'})).toBeInTheDocument()
  expect(screen.getByLabelText('Selected month summary')).toHaveTextContent('Money inKWD 100SpentKWD 70')
  expect(screen.getByText('Balance & month details').closest('details')).not.toHaveAttribute('open')
  expect(screen.getByText('Money in includes KWD 70 income and KWD 30 starting funds.')).toBeInTheDocument()
  expect(screen.queryByText("Month's net change")).toBeNull()
  expect(screen.queryByLabelText('Shared wallets summary')).toBeNull()
  expect(screen.queryByRole('button',{name:/add transaction/i})).toBeNull()
  expect(screen.queryByRole('link',{name:/add transaction/i})).toBeNull()
})
