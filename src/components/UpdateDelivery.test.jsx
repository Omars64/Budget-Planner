import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import UpdateDelivery from './UpdateDelivery'
import { api } from '../lib/api'
import { syncUpdatePush } from '../lib/updatePush'
vi.mock('../lib/api',()=>({api:vi.fn()}))
vi.mock('../lib/updatePush',()=>({syncUpdatePush:vi.fn()}))
beforeEach(()=>{localStorage.clear();vi.clearAllMocks();api.mockResolvedValue({devices:[{id:'phone',platform:'android',installed_version:'5.12.5'}]});syncUpdatePush.mockResolvedValue({enabled:true})})
afterEach(cleanup)
async function open(){render(<UpdateDelivery/>);const details=screen.getByText('Update delivery').closest('details');details.open=true;fireEvent(details,new Event('toggle'));await screen.findByRole('option',{name:/Android 1/})}
test('registration diagnostics remain collapsed until requested',()=>{render(<UpdateDelivery/>);expect(api).not.toHaveBeenCalled()})
test('sends a test to the selected owned device and reports acceptance, not receipt',async()=>{
  await open();api.mockResolvedValue({accepted:true,message:'Accepted by provider; check your phone.'})
  fireEvent.click(screen.getByRole('button',{name:'Test notification'}))
  await screen.findByText('Accepted by provider; check your phone.')
  expect(api).toHaveBeenCalledWith('/api/app-updates/push-device/phone/test',{method:'POST'})
})
test('disabled update preference prevents sending a test',async()=>{localStorage.setItem('budgetly-update-notifications-v1','false');await open();expect(screen.getByRole('button',{name:'Test notification'})).toBeDisabled()})
test('reconnect surfaces permission errors instead of claiming registration succeeded',async()=>{
  await open();syncUpdatePush.mockResolvedValue({enabled:false});fireEvent.click(screen.getByRole('button',{name:'Reconnect this device'}))
  await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('Allow device notifications'))
})
