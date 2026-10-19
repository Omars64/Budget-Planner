import {render,screen,cleanup} from '@testing-library/react'
import {afterEach,expect,test,vi} from 'vitest'
import OperationsPanel from './OperationsPanel'
vi.mock('../App',()=>({useApp:()=>({notify:vi.fn()})}))
vi.mock('../lib/api',()=>({api:vi.fn(async()=>({database_engine:'postgresql',persistent_storage:true,
  jobs:{external_backup:{configured:true,healthy:false}},events:[]}))}))
afterEach(cleanup)
test('external backup has its own explicit health label',async()=>{
  render(<OperationsPanel/> )
  expect(await screen.findByText('Independent backup')).toBeInTheDocument()
  expect(screen.getByText('Needs attention')).toBeInTheDocument()
})
