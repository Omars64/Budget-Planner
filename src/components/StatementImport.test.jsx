import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import StatementImport from './StatementImport'
import { api } from '../lib/api'
vi.mock('../App',()=>({useApp:()=>({settings:{currency:'KWD'},refresh:vi.fn(),notify:vi.fn()})}))
vi.mock('../lib/api',()=>({api:vi.fn(),jsonBody:value=>({body:JSON.stringify(value)}),money:value=>String(value)}))
afterEach(()=>{cleanup();vi.clearAllMocks()})
test('possible matches need review before importing and are submitted explicitly',async()=>{
  api.mockResolvedValueOnce([{line:2,error:null,duplicate:false,transaction:{description:'BANK COFFEE',amount:10,date:'2026-10-06T12:00',wallet_id:1,type:'expense'},candidates:[{id:5,description:'Coffee',date:'2026-10-05T12:00',amount:10}]}]).mockResolvedValueOnce({imported:0,skipped:0,matched:1})
  render(<StatementImport wallets={[{id:1,name:'Main',balance:50}]}/>)
  fireEvent.click(screen.getByRole('button',{name:'Import statement'}))
  fireEvent.change(screen.getByLabelText('Wallet'),{target:{value:'1'}})
  const file=new globalThis.File(['csv'],'bank.csv',{type:'text/csv'});file.text=async()=>'csv'
  fireEvent.change(screen.getByLabelText('CSV statement'),{target:{files:[file]}})
  await waitFor(()=>expect(screen.getByRole('button',{name:'Preview rows'})).toBeEnabled())
  fireEvent.submit(screen.getByRole('button',{name:'Preview rows'}).closest('form'))
  const checkbox=await screen.findByRole('checkbox')
  expect(checkbox).not.toBeChecked()
  fireEvent.click(checkbox)
  fireEvent.change(screen.getByLabelText('Possible match for row 2'),{target:{value:'5'}})
  fireEvent.click(screen.getByRole('button',{name:'Confirm 1 rows'}))
  await waitFor(()=>expect(api).toHaveBeenCalledTimes(2))
  expect(JSON.parse(api.mock.calls[1][1].body).transactions[0].matched_transaction_id).toBe(5)
})
