import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import SharedTransactions from './SharedTransactions'
import { api } from '../lib/api'

const wallet = {wallet_id:11,name:'Household',balance:50,can_add:true,can_edit:true,owner_name:'Owner',owner_email:'owner@example.test',shares:[]}
vi.mock('../App', () => ({useApp:() => ({settings:{currency:'KWD'},refreshKey:0,refresh:vi.fn(),notify:vi.fn(),confirm:vi.fn()})}))
vi.mock('../lib/api', () => ({api:vi.fn(),jsonBody:data=>({body:JSON.stringify(data)}),money:n=>'KWD '+Number(n||0).toFixed(3),readCached:()=>null}))
vi.mock('../lib/useLedger', () => ({default:()=>({rows:[],loading:false,hasMore:false,page:1})}))
beforeAll(() => {
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true }
  window.HTMLDialogElement.prototype.close = function () { this.open = false }
})
afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks()
  api.mockImplementation(path=>Promise.resolve(path==='/api/shared/wallets'?[wallet]:[]))
})
it('uses the same picker in a shared transaction and saves the selected time once', async () => {
  render(<MemoryRouter><SharedTransactions/></MemoryRouter>)
  await screen.findByText('Household')
  fireEvent(window,new window.Event('budgetly:add-shared-transaction'))
  fireEvent.change(screen.getByLabelText('Amount'),{target:{value:'2'}})
  fireEvent.change(screen.getByLabelText('Description'),{target:{value:'Lunch'}})
  fireEvent.click(screen.getByRole('button',{name:'Date',exact:true}))
  fireEvent.change(screen.getByLabelText('Calendar year'),{target:{value:'2026'}})
  // The initial month comes from the common Kuwait clock.
  const month = new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kuwait',month:'numeric'}).format(new Date())
  for(let i=Number(month);i<9;i++) fireEvent.click(screen.getByRole('button',{name:'Next month'}))
  for(let i=Number(month);i>9;i--) fireEvent.click(screen.getByRole('button',{name:'Previous month'}))
  fireEvent.click(screen.getByRole('button',{name:'Monday, 14 September 2026'}))
  fireEvent.click(screen.getByRole('button',{name:'Set date'}))
  fireEvent.click(screen.getByRole('button',{name:'Time',exact:true}))
  fireEvent.click(screen.getByRole('button',{name:'Type time instead'}))
  fireEvent.change(screen.getByLabelText('Hour'),{target:{value:'6'}})
  fireEvent.change(screen.getByLabelText('Minute'),{target:{value:'29'}})
  fireEvent.click(screen.getByRole('button',{name:'AM',exact:true}))
  fireEvent.click(screen.getByRole('button',{name:'Set time'}))
  const save=screen.getByRole('button',{name:'Save',exact:true})
  fireEvent.click(save); fireEvent.click(save)
  await waitFor(()=>expect(api).toHaveBeenCalledWith('/api/shared/transactions',expect.objectContaining({method:'POST'})))
  const calls=api.mock.calls.filter(([path])=>path==='/api/shared/transactions')
  expect(calls).toHaveLength(1)
  expect(JSON.parse(calls[0][1].body)).toMatchObject({date:'2026-09-14T03:29:00.000Z',wallet_id:11,amount:2})
})
