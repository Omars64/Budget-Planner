import {render,screen,cleanup,fireEvent,waitFor} from '@testing-library/react'
import {afterEach,beforeEach,expect,test,vi} from 'vitest'
import OperationsPanel from './OperationsPanel'
import {api} from '../lib/api'
const {notify}=vi.hoisted(()=>({notify:vi.fn()}))
vi.mock('../App',()=>({useApp:()=>({notify})}))
vi.mock('../lib/api',()=>({api:vi.fn(async()=>({database_engine:'postgresql',persistent_storage:true,
  jobs:{external_backup:{configured:true,healthy:false}},events:[]}))}))
afterEach(cleanup)
const health={database_engine:'postgresql',persistent_storage:true,
  jobs:{external_backup:{configured:true,healthy:false}},events:[]}
beforeEach(()=>{vi.clearAllMocks();api.mockResolvedValue(health)})
test('external backup has its own explicit health label',async()=>{
  render(<OperationsPanel/> )
  expect(await screen.findByText('Independent backup')).toBeInTheDocument()
  expect(screen.getByText('Needs attention')).toBeInTheDocument()
})

test('missing independent backup cannot be mistaken for successful external protection',async()=>{
  api.mockResolvedValue({...health,external_backup_missing:['BACKUP_ENCRYPTION_KEY']})
  render(<OperationsPanel/> )
  expect(await screen.findByText('Independent protection is not active.')).toBeInTheDocument()
  expect(screen.getByText('BACKUP_ENCRYPTION_KEY')).toBeInTheDocument()
  api.mockResolvedValueOnce({ok:true,external_backup_configured:false}).mockResolvedValue(health)
  fireEvent.click(screen.getByRole('button',{name:'Create database recovery copy'}))
  await waitFor(()=>expect(notify).toHaveBeenCalledWith('Recovery copy completed in the database. Independent backup is not configured.'))
})

test('failed refresh explicitly marks previous health as unconfirmed',async()=>{
  render(<OperationsPanel/> )
  await screen.findByText('Independent backup')
  api.mockRejectedValueOnce(new Error('Service temporarily unavailable'))
  fireEvent.click(screen.getByRole('button',{name:'Refresh service health'}))
  expect(await screen.findByRole('alert')).toHaveTextContent('Service temporarily unavailable')
  expect(screen.getByText(/Current status is unconfirmed/)).toBeInTheDocument()
})

test('backup confirmation reports actual uploaded account count',async()=>{
  api.mockResolvedValue({...health,external_backup_configured:true})
  render(<OperationsPanel/> )
  await screen.findByText('Independent backup')
  api.mockResolvedValueOnce({ok:true,external_backup_configured:true,external_backups_created:3}).mockResolvedValue(health)
  fireEvent.click(screen.getByRole('button',{name:'Run recovery and backup'}))
  await waitFor(()=>expect(notify).toHaveBeenCalledWith('Recovery completed; 3 encrypted account backups uploaded.'))
})
