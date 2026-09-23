import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Overview from './Overview'
vi.mock('../App',()=>({useApp:()=>({user:{id:1},settings:{currency:'KWD'},refreshKey:0})}))
vi.mock('../lib/api',()=>({api:vi.fn(async()=>({month:'2026-09',total_balance:30,income:100,earned_income:70,opening_funds:30,expense:70,net:30,wallets:[],budgets:[],category_spending:[],recent_transactions:[],shared:{balance:50,wallet_count:1}})),money:v=>`KWD ${v}`}))
afterEach(cleanup)
it('keeps Overview read-focused with separate current balances and opening funds',async()=>{
  render(<MemoryRouter><Overview/></MemoryRouter>)
  expect(await screen.findByText('Personal balance now')).toBeInTheDocument()
  expect(screen.getByText('KWD 70 income + KWD 30 starting funds')).toBeInTheDocument()
  expect(screen.getByLabelText('Shared wallets summary')).toHaveTextContent('KWD 50')
  expect(screen.queryByRole('button',{name:/add transaction/i})).toBeNull()
  expect(screen.queryByRole('link',{name:/add transaction/i})).toBeNull()
})
