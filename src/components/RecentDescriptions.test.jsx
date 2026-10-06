import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import RecentDescriptions from './RecentDescriptions'
import { rememberEntry, saveWorkspacePreferences } from '../lib/workspacePreferences'

afterEach(cleanup)
beforeEach(() => { localStorage.clear(); rememberEntry(9,'personal',{type:'expense',description:'Coffee',wallet_id:1}) })
function Harness({submit}) {
  const [value,setValue]=useState('')
  return <form onSubmit={submit}><RecentDescriptions userId={9} scope="personal" type="expense" value={value} onChange={setValue}/><button type="button">Other field</button></form>
}
it('keeps suggestions inline, selectable without submitting, and typing available', () => {
  const submit=vi.fn(); render(<Harness submit={submit}/>)
  const input=screen.getByLabelText('Description')
  fireEvent.focus(input)
  expect(document.querySelector('datalist')).toBeNull()
  expect(screen.getByRole('group',{name:'Recent descriptions'}).closest('.description-field')).toContainElement(input)
  fireEvent.click(screen.getByRole('button',{name:'Use description Coffee'}))
  expect(input).toHaveValue('Coffee'); expect(submit).not.toHaveBeenCalled()
  fireEvent.change(input,{target:{value:'Coffee tomorrow'}})
  expect(input).toHaveValue('Coffee tomorrow')
})
it('dismisses without closing the form or capturing other controls', () => {
  render(<Harness/>)
  const input=screen.getByLabelText('Description'); fireEvent.focus(input)
  fireEvent.keyDown(input,{key:'Escape'})
  expect(screen.queryByRole('group',{name:'Recent descriptions'})).not.toBeInTheDocument()
  fireEvent.focus(input)
  fireEvent.click(screen.getByRole('button',{name:'Hide description suggestions'}))
  expect(screen.queryByRole('group',{name:'Recent descriptions'})).not.toBeInTheDocument()
  expect(screen.getByRole('button',{name:'Other field'})).toBeEnabled()
})
it('honors persisted suggestion preferences without deleting history', () => {
  saveWorkspacePreferences(9,{descriptionSuggestions:false})
  render(<Harness/>); fireEvent.focus(screen.getByLabelText('Description'))
  expect(screen.queryByRole('group',{name:'Recent descriptions'})).not.toBeInTheDocument()
  cleanup(); saveWorkspacePreferences(9,{descriptionSuggestions:true})
  render(<Harness/>); fireEvent.focus(screen.getByLabelText('Description'))
  expect(screen.getByRole('button',{name:'Use description Coffee'})).toBeVisible()
})
it('provides the remembered draft only after the user selects a suggestion',()=>{
  const select=vi.fn()
  render(<RecentDescriptions userId={9} scope="personal" type="expense" value="" onChange={vi.fn()} onSelect={select}/>)
  fireEvent.focus(screen.getByLabelText('Description'))
  expect(select).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button',{name:'Use description Coffee'}))
  expect(select).toHaveBeenCalledWith(expect.objectContaining({description:'Coffee',wallet_id:1}))
})
