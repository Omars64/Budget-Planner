import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Overview from './Overview'
vi.mock('../App',()=>({useApp:()=>({user:{id:1},settings:{currency:'KWD'},refreshKey:0})}))
vi.mock('../lib/api',()=>({api:vi.fn(async()=>({month:'2026-09',total_balance:30,income:100,earned_income:70,opening_funds:30,expense:70,net:30,wallets:[],budgets:[],category_spending:[],recent_transactions:[],shared:{balance:50,wallet_count:1}})),money:v=>`KWD ${v}`}))
afterEach(cleanup)
it('separates live wallet balance from month-assigned activity and keeps explanations collapsed',async()=>{
  render(<MemoryRouter><Overview/></MemoryRouter>)
  expect(await screen.findByText('Available now · Personal wallets')).toBeInTheDocument()
  expect(screen.getByRole('heading',{name:'KWD 30'})).toBeInTheDocument()
  expect(screen.getByRole('heading',{name:'Assigned to September 2026'})).toBeInTheDocument()
  expect(screen.getByText('KWD 70 income + KWD 30 starting funds')).toBeInTheDocument()
  expect(screen.getByText("Month's net change")).toBeInTheDocument()
  expect(screen.getByLabelText('Selected month summary')).toHaveTextContent("Month's net change+KWD 30")
  expect(screen.getByText('Balance and reporting details').closest('details')).not.toHaveAttribute('open')
  expect(screen.getByLabelText('Shared wallets summary')).toHaveTextContent('KWD 50')
  expect(screen.queryByRole('button',{name:/add transaction/i})).toBeNull()
  expect(screen.queryByRole('link',{name:/add transaction/i})).toBeNull()
})
