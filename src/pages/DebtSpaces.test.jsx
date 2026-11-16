import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import useDebtSpaces from '../lib/useDebtSpaces'
import { debtApi, debtPath, debtRoute, debtUrl } from '../lib/debtWorkspace'
import DebtWorkspace from './DebtWorkspace'

const mocks = vi.hoisted(() => ({ app:null, api:vi.fn(), notify:vi.fn(), confirm:vi.fn() }))
vi.mock('../App', () => ({ useApp:() => mocks.app }))
vi.mock('../lib/api', () => ({ api:(...args) => mocks.api(...args), hasPendingWrites:() => false,
  jsonBody:value => ({body:JSON.stringify(value)}), money:value => String(value) }))
vi.mock('../components/Modal', () => ({ default:({open,title,onClose,children}) => open
  ? <section role="dialog" aria-label={title}><button onClick={onClose}>Close dialog</button>{children}</section> : null }))

const family = { id:'11111111-1111-1111-1111-111111111111', name:'Family debts', owner_name:'Omar', currency:'KWD', member_count:2, role:'owner' }
const trip = { id:'22222222-2222-2222-2222-222222222222', name:'Trip repayments', owner_name:'Layla', currency:'USD', member_count:3, role:'edit' }
const newSpaceId = '33333333-3333-3333-3333-333333333333'
const person = {email:'viewer@example.test',role:'view'}
const account = {id:1}
const settings = {currency:'KWD'}
let spaces

function Workspace() {
  const {spaces:debtSpaces, loaded:debtSpacesLoaded, error:debtSpacesError, reload:reloadDebtSpaces,
    remember:rememberDebtSpace, forget:forgetDeletedDebtSpace, refresh:refreshDebtSpaces} = useDebtSpaces(account)
  mocks.app = {settings, debtSpaces, debtSpacesLoaded, debtSpacesError, reloadDebtSpaces,
    rememberDebtSpace, forgetDeletedDebtSpace, refreshDebtSpaces, notify:mocks.notify, confirm:mocks.confirm}
  return <><output aria-label="Current path">{useLocation().pathname}</output><DebtWorkspace/></>
}

const renderWorkspace = (path = debtUrl(family.id,'directory')) => render(<MemoryRouter initialEntries={[path]}><Workspace/></MemoryRouter>)
const click = name => fireEvent.click(screen.getByRole('button',{name,exact:true}))
const submitName = (label, value) => fireEvent.change(screen.getByLabelText(label),{target:{value}})

beforeEach(() => {
  spaces = [family,trip]
  mocks.notify.mockReset()
  mocks.confirm.mockResolvedValue(true)
  mocks.api.mockImplementation(async (path, options) => {
    const body = options?.body && JSON.parse(options.body)
    if (path === `${debtPath}/spaces`) {
      if (options?.method !== 'POST') return spaces
      const created = {...family,...body,id:newSpaceId,member_count:1}
      spaces = [...spaces,created]
      return created
    }
    if (options?.method === 'DELETE') {
      spaces = spaces.filter(space => debtApi(space.id) !== path)
      return null
    }
    if (options?.method === 'PATCH') {
      spaces = spaces.map(space => debtApi(space.id) === path ? {...space,name:body.name} : space)
      return spaces.find(space => debtApi(space.id) === path)
    }
    const space = spaces.find(space => `${debtApi(space.id)}/access` === path)
    if (space) return {...space,members:[{name:space.owner_name,email:'owner@example.test',role:'owner'},person]}
    if (spaces.some(space => debtApi(space.id) === path)) return {currency:'KWD',records:[]}
    throw new Error(`Unexpected route: ${path}`)
  })
})
afterEach(() => {cleanup();vi.clearAllMocks()})

it('opens Debt spaces from debt More and preserves old access links', async () => {
  renderWorkspace(debtUrl(family.id,'more'))
  fireEvent.click(await screen.findByRole('link',{name:/Debt spaces/}))
  expect(await screen.findByRole('button',{name:'Manage workspace Family debts'})).toBeInTheDocument()
  expect(screen.getByRole('button',{name:'Switch to Family debts'})).toHaveAttribute('aria-current','true')
  expect(debtRoute(debtUrl(family.id,'access'))).toEqual({id:family.id,view:'directory'})
})

it('shows managers and role previews read-only controls', async () => {
  renderWorkspace()
  const action = await screen.findByRole('button',{name:'View settings & members Trip repayments'})
  fireEvent.click(action)
  expect(await screen.findByLabelText('Space name')).toHaveAttribute('readonly')
  const dialog = screen.getByRole('dialog')
  expect(within(dialog).queryByRole('button',{name:'Delete space'})).not.toBeInTheDocument()
  click('Members')
  expect(within(dialog).getByText('Layla')).toBeInTheDocument()
  expect(within(dialog).queryByRole('button',{name:'Add a person'})).not.toBeInTheDocument()
  cleanup()

  renderWorkspace(debtUrl(family.id,'directory') + '?preview=view')
  fireEvent.click(await screen.findByRole('button',{name:'View settings & members Family debts'}))
  expect(await screen.findByLabelText('Space name')).toHaveAttribute('readonly')
  expect(screen.queryByRole('button',{name:'Delete space'})).not.toBeInTheDocument()
})

it('creates and renames debt spaces without changing the current scope', async () => {
  renderWorkspace()
  await screen.findByRole('button',{name:'Manage workspace Family debts'})
  click('Create debt space')
  submitName('Space name','Household loan')
  click('Create space')
  fireEvent.click(await screen.findByRole('button',{name:'Manage workspace Household loan'}))
  expect(await screen.findByLabelText('Space name')).toHaveValue('Household loan')
  submitName('Space name','Home loan')
  click('Save details')
  expect(await screen.findByRole('button',{name:'Manage workspace Home loan'})).toBeInTheDocument()
  expect(screen.getByRole('button',{name:'Switch to Family debts'})).toHaveAttribute('aria-current','true')
})

it('requires an exact name and confirmation, then returns an active deletion to private debt spaces', async () => {
  renderWorkspace()
  fireEvent.click(await screen.findByRole('button',{name:'Manage workspace Family debts'}))
  fireEvent.click(await screen.findByRole('button',{name:'Delete space',exact:true}))
  submitName('Type “Family debts” to continue','Family debt')
  expect(screen.getByRole('button',{name:'Continue to delete'})).toBeDisabled()
  submitName('Type “Family debts” to continue','Family debts')
  click('Continue to delete')
  click('Cancel')
  expect(mocks.api.mock.calls.some(([,options]) => options?.method === 'DELETE')).toBe(false)
  submitName('Type “Family debts” to continue','Family debts')
  click('Continue to delete')
  click('Delete space permanently')
  await waitFor(() => expect(screen.getByLabelText('Current path')).toHaveTextContent(debtUrl(null,'directory')))
  expect(mocks.api).toHaveBeenCalledWith(debtApi(family.id), {method:'DELETE',body:'{"confirmation_name":"Family debts"}'})
  expect(screen.queryByRole('button',{name:'Manage workspace Family debts'})).not.toBeInTheDocument()
  expect(screen.getByRole('button',{name:'View settings & members Trip repayments'})).toBeInTheDocument()
  expect(screen.getByRole('button',{name:/Debt Management/})).toHaveAttribute('aria-current','true')
})
