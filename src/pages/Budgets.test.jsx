import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import Budgets from './Budgets'
import { api } from '../lib/api'

vi.mock('../App', () => ({ useApp: () => ({settings:{currency:'KWD'}, refresh:vi.fn(), notify:vi.fn(), confirm:vi.fn()}) }))
vi.mock('../lib/api', () => ({api:vi.fn(), jsonBody:value=>({body:JSON.stringify(value)}), money:value=>String(value)}))
vi.mock('../components/BudgetRecords', () => ({default:({children})=><div>{children}</div>}))
vi.mock('../components/Modal', () => ({default:({open,children})=>open ? <div>{children}</div> : null}))
const budget = {id:1,name:'Transport',category_id:null,limit_amount:8,spent:6,remaining:2,progress:75,period:'monthly',reporting_month:'2026-10',records_month:'2026-10',start_date:'2026-10-01',notify_threshold:80}
beforeEach(() => {vi.clearAllMocks(); api.mockImplementation((path, options)=>Promise.resolve(options?.method ? {id:1} : path==='/api/budgets' ? [budget] : []))})
afterEach(cleanup)

it('defaults new monthly budgets to repeating and only offers a month when switched off', async () => {
  render(<Budgets/> )
  await screen.findByRole('button',{name:'Edit Transport'})
  fireEvent.click(screen.getByRole('button',{name:'New budget'}))
  const repeat = screen.getByRole('switch',{name:'Repeat every month'})
  expect(repeat).toBeChecked()
  expect(screen.queryByLabelText('For month')).not.toBeInTheDocument()
  fireEvent.click(repeat)
  expect(screen.getByLabelText('For month')).toBeRequired()
  fireEvent.change(screen.getByLabelText('Period'),{target:{value:'weekly'}})
  expect(screen.queryByRole('switch')).not.toBeInTheDocument()
})

it('keeps an existing fixed month until the user explicitly enables repetition', async () => {
  render(<Budgets/> )
  fireEvent.click(await screen.findByRole('button',{name:'Edit Transport'}))
  expect(screen.getByRole('switch',{name:'Repeat every month'})).not.toBeChecked()
  expect(screen.getByLabelText('For month')).toHaveValue('2026-10')
  fireEvent.click(screen.getByRole('switch',{name:'Repeat every month'}))
  fireEvent.click(screen.getByRole('button',{name:'Save changes'}))
  await waitFor(()=>expect(api).toHaveBeenCalledWith('/api/budgets/1', expect.objectContaining({method:'PUT'})))
  const options = api.mock.calls.find(([,value])=>value?.method==='PUT')[1]
  expect(JSON.parse(options.body)).toMatchObject({reporting_month:null,period:'monthly',limit_amount:8,start_date:'2026-10-01'})
})
