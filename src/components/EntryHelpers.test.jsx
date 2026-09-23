import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import SearchableSelect from './SearchableSelect'
import TransactionTemplates from './TransactionTemplates'

afterEach(()=>{cleanup();localStorage.clear()})
it('narrows a picker without losing the selected option',()=>{
  const change=vi.fn()
  render(<SearchableSelect label="Wallet" value="1" onChange={change} options={Array.from({length:8},(_,i)=>({value:i+1,label:`Wallet ${i+1}`}))}/> )
  fireEvent.change(screen.getByRole('searchbox'),{target:{value:'8'}})
  expect(screen.getByRole('option',{name:'Wallet 1'})).toBeInTheDocument()
  expect(screen.queryByRole('option',{name:'Wallet 2'})).toBeNull()
  fireEvent.change(screen.getByRole('combobox'),{target:{value:'8'}})
  expect(change).toHaveBeenCalledWith('8')
})
it('templates never retain transaction identity, old dates or recurring schedules',()=>{
  const apply=vi.fn()
  render(<TransactionTemplates userId={1} scope="personal" draft={{id:99,date:'2020-01-01',revision:'old',amount:2,wallet_id:1,type:'expense',description:'Bus',recurring_frequency:'daily'}} onApply={apply}/> )
  fireEvent.click(screen.getByText('Templates'))
  fireEvent.click(screen.getByRole('button',{name:'Save current fields'}))
  const option=screen.getByRole('option',{name:'Bus'})
  fireEvent.change(screen.getByRole('combobox'),{target:{value:option.value}})
  expect(apply.mock.calls[0][0]).not.toHaveProperty('date')
  expect(apply.mock.calls[0][0]).not.toHaveProperty('revision')
  expect(apply.mock.calls[0][0]).not.toHaveProperty('recurring_frequency')
  expect(apply.mock.calls[0][0].id).not.toBe(99)
})
