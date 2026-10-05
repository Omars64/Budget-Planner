import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import Planner, {editableConfig} from './Planner'
import { api } from '../lib/api'

const hooks=vi.hoisted(()=>({notify:vi.fn(),refresh:vi.fn(),confirm:vi.fn(async()=>true)}))
vi.mock('../App',()=>({useApp:()=>({settings:{currency:'KWD'},refreshKey:0,...hooks})}))
vi.mock('../lib/api',()=>({api:vi.fn(),jsonBody:data=>({body:JSON.stringify(data)}),money:value=>`KWD ${Number(value).toFixed(3)}`}))
vi.mock('recharts',()=>({ResponsiveContainer:({children})=><div>{children}</div>,AreaChart:()=> <div aria-label="Forecast visualization"/>,Area:()=>null,CartesianGrid:()=>null,ReferenceLine:()=>null,Tooltip:()=>null,XAxis:()=>null,YAxis:()=>null}))
const bill={id:'05d5f773-a1e7-4f88-a6cd-82d14b5f63e2',name:'Internet',amount:'10.000',wallet_id:1,due_at:'2026-10-07T09:00:00',frequency:'monthly',kind:'subscription',active:true,reminder_enabled:true,planned_id:null,price_history:[],payments:[]}
const config={revision:1,goal_reserve:'5.000',buffer:'0.000',bills:[bill]}
const data={as_of:'2026-10-05T10:00:00+03:00',days:30,available_to_spend:'85.000',opening_balance:'100.000',projected_balance:'90.000',lowest_balance:'90.000',lowest_date:'2026-10-07',reserved:'5.000',bills_before_payday:'10.000',next_payday:null,shortfall_date:null,warnings:[],wallets:[{id:1,name:'Main'}],points:[{date:'2026-10-05',balance:'100.000'},{date:'2026-11-04',balance:'90.000'}],events:[{id:`bill:${bill.id}:2026-10-07T09:00:00`,name:'Internet',amount:'-10.000',date:'2026-10-07T09:00:00+03:00',due_at:'2026-10-07T09:00:00+03:00',wallet_name:'Main',certainty:'Assumed',source:'/planner'}]}
beforeEach(()=>{
  vi.clearAllMocks()
  api.mockImplementation(async(path,options)=>{
    if(path==='/api/planner/config')return options?.method?{...JSON.parse(options.body),revision:2}:globalThis.structuredClone(config)
    if(path.startsWith('/api/planner/forecast'))return globalThis.structuredClone(data)
    if(path.startsWith('/api/planner/preview'))return {...data,projected_balance:'65.000',lowest_balance:'65.000',available_to_spend:'60.000'}
    return []
  })
})
afterEach(cleanup)
const renderPage=()=>render(<MemoryRouter><Planner/></MemoryRouter>)

it('keeps bills and calculation details behind focused views',async()=>{
  renderPage()
  expect(await screen.findByText('KWD 85.000',{selector:'strong'})).toBeInTheDocument()
  expect(screen.queryByRole('button',{name:'Add bill'})).toBeNull()
  expect(screen.getByText('How this is calculated').closest('details')).not.toHaveAttribute('open')
  fireEvent.click(screen.getByRole('button',{name:'Bills',exact:true}))
  expect(screen.getByRole('heading',{name:'Internet'})).toBeInTheDocument()
  expect(screen.getByRole('button',{name:'Add bill'})).toBeInTheDocument()
})

it('uses existing date/time controls for bills and saves without creating transactions',async()=>{
  renderPage();await screen.findByText('KWD 85.000',{selector:'strong'})
  fireEvent.click(screen.getByRole('button',{name:'Bills',exact:true}))
  fireEvent.click(screen.getByRole('button',{name:'Add bill'}))
  expect(screen.getByRole('button',{name:'Date',exact:true})).toBeInTheDocument()
  expect(screen.getByRole('button',{name:'Time',exact:true})).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('Name'),{target:{value:'Electricity'}})
  fireEvent.change(screen.getByLabelText('Amount (KWD)'),{target:{value:'12.345'}})
  fireEvent.click(screen.getByRole('button',{name:'Save bill'}))
  await waitFor(()=>expect(hooks.notify).toHaveBeenCalledWith('Planner saved'))
  const call=api.mock.calls.find(([path,options])=>path==='/api/planner/config'&&options?.method==='PUT')
  expect(JSON.parse(call[1].body).bills.at(-1)).toMatchObject({name:'Electricity',amount:'12.345',wallet_id:1})
  expect(api.mock.calls.some(([path])=>path.includes('/api/transactions'))).toBe(false)
})

it('previews purchases and resets without mutating saved bills or records',async()=>{
  renderPage();await screen.findByText('KWD 85.000',{selector:'strong'})
  fireEvent.click(screen.getByRole('button',{name:'What if',exact:true}))
  fireEvent.change(screen.getByLabelText('Purchase (KWD)'),{target:{value:'25'}})
  fireEvent.submit(screen.getByRole('button',{name:'Try purchase'}).closest('form'))
  expect(await screen.findByText('Without purchase: KWD 90.000')).toBeInTheDocument()
  expect(screen.getAllByText('KWD 65.000').length).toBe(2)
  fireEvent.click(screen.getByRole('button',{name:'Reset'}))
  expect(screen.queryByText('Without purchase: KWD 90.000')).toBeNull()
  expect(api.mock.calls.filter(([,options])=>options?.method).map(([path])=>path)).toEqual(['/api/planner/preview?days=30&assumptions=true'])
})

it('requests each horizon and can exclude assumed items',async()=>{
  renderPage();await screen.findByText('KWD 85.000',{selector:'strong'})
  fireEvent.click(screen.getByRole('button',{name:'90 days'}))
  await waitFor(()=>expect(api).toHaveBeenCalledWith('/api/planner/forecast?days=90&assumptions=true',expect.any(Object)))
  await screen.findByText('KWD 85.000',{selector:'strong'})
  fireEvent.click(screen.getByRole('checkbox',{name:'Include estimates'}))
  await waitFor(()=>expect(api).toHaveBeenCalledWith('/api/planner/forecast?days=90&assumptions=false',expect.any(Object)))
})

it('retains a bill draft after a save conflict',async()=>{
  renderPage();await screen.findByText('KWD 85.000',{selector:'strong'})
  fireEvent.click(screen.getByRole('button',{name:'Bills',exact:true}))
  fireEvent.click(screen.getByRole('button',{name:'Edit Internet'}))
  api.mockImplementation(async(path,options)=>{if(options?.method==='PUT')throw new Error('Planner changed on another device');return []})
  fireEvent.change(screen.getByLabelText('Name'),{target:{value:'Internet revised'}})
  fireEvent.submit(screen.getByLabelText('Name').closest('form'))
  expect(await screen.findByRole('alert')).toHaveTextContent('Planner changed on another device')
  expect(screen.getByLabelText('Name')).toHaveValue('Internet revised')
})

it('shows load errors instead of presenting fabricated cash estimates',async()=>{
  api.mockRejectedValue(new Error('Connection unavailable'))
  renderPage()
  expect(await screen.findByRole('alert')).toHaveTextContent('Connection unavailable')
  expect(screen.queryByText('Available to spend · estimate')).toBeNull()
})

it('strips server-owned history and payments before configuration saves',()=>{
  const value=editableConfig(config)
  expect(value.bills[0]).not.toHaveProperty('payments')
  expect(value.bills[0]).not.toHaveProperty('price_history')
  expect(value.revision).toBe(1)
})

it('uses the shared confirmation contract before removing a bill',async()=>{
  renderPage();await screen.findByText('KWD 85.000',{selector:'strong'})
  fireEvent.click(screen.getByRole('button',{name:'Bills',exact:true}))
  fireEvent.click(screen.getByRole('button',{name:'Remove Internet'}))
  await waitFor(()=>expect(hooks.confirm).toHaveBeenCalledWith('Remove Internet from Planner? Recorded payments stay in Transactions.'))
  await waitFor(()=>expect(hooks.notify).toHaveBeenCalledWith('Planner saved'))
})

it('preserves an Upcoming link when editing only the bill name',async()=>{
  api.mockImplementation(async(path,options)=>{
    if(path==='/api/planner/config')return options?.method?{...JSON.parse(options.body),revision:2}:{...config,bills:[{...bill,planned_id:7}]}
    if(path.startsWith('/api/planner/forecast'))return data
    return [{id:7,date:bill.due_at,amount:bill.amount,wallet_id:1,description:'Internet'}]
  })
  renderPage();await screen.findByText('KWD 85.000',{selector:'strong'})
  fireEvent.click(screen.getByRole('button',{name:'Bills',exact:true}))
  fireEvent.click(screen.getByRole('button',{name:'Edit Internet'}))
  fireEvent.change(screen.getByLabelText('Name'),{target:{value:'Home internet'}})
  fireEvent.submit(screen.getByLabelText('Name').closest('form'))
  await waitFor(()=>expect(hooks.notify).toHaveBeenCalled())
  const call=api.mock.calls.find(([,options])=>options?.method==='PUT')
  expect(JSON.parse(call[1].body).bills[0].planned_id).toBe(7)
})
