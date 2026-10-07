import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react'
import {afterEach,expect,test,vi} from 'vitest'
import CurrencyConfiguration from './CurrencyConfiguration'
const mocks=vi.hoisted(()=>({api:vi.fn(),setSettings:vi.fn(),refresh:vi.fn(),notify:vi.fn()}))
vi.mock('../App',()=>({useApp:()=>({settings:{currency:'KWD',theme:'dark'},...mocks})}))
vi.mock('../lib/api',()=>({api:mocks.api,jsonBody:value=>({body:JSON.stringify(value)})}))
afterEach(()=>{cleanup();vi.clearAllMocks()})
test('currency has a collapsed section and saves only currency',async()=>{
  mocks.api.mockResolvedValue({currency:'USD'})
  const {container}=render(<CurrencyConfiguration/>)
  expect(container.querySelector('details').open).toBe(false)
  expect(screen.getByText('Currency configuration')).toBeInTheDocument()
  fireEvent.change(screen.getByRole('combobox',{name:'Currency'}),{target:{value:'USD'}})
  fireEvent.submit(container.querySelector('form'))
  await waitFor(()=>expect(mocks.setSettings).toHaveBeenCalled())
  expect(JSON.parse(mocks.api.mock.calls[0][1].body)).toEqual({currency:'USD'})
  expect(mocks.setSettings.mock.calls[0][0]({currency:'KWD',theme:'dark'})).toEqual({currency:'USD',theme:'dark'})
})
