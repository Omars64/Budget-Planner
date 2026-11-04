import { useState } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, test } from 'vitest'
import AppSelect from './AppSelect'
import AppMonthField from './AppMonthField'

test('the app picker changes a controlled category without opening a native select', async () => {
  function Form() {
    const [category, setCategory] = useState('food')
    return <label className="field"><span>Category</span><AppSelect value={category} onChange={event => setCategory(event.target.value)}><option value="food">Food</option><option value="travel">Travel</option></AppSelect></label>
  }
  const { container } = render(<Form />)
  fireEvent.click(screen.getByRole('combobox', { name: 'Open Category' }))
  fireEvent.click(screen.getByRole('option', { name: 'Travel' }))
  expect(container.querySelector('select')).toHaveValue('travel')
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})

test('the app month picker selects a reporting month', () => {
  function Form() {
    const [month, setMonth] = useState('2026-10')
    return <label className="field"><span>For month</span><AppMonthField value={month} onChange={event => setMonth(event.target.value)}/></label>
  }
  const { container } = render(<Form />)
  fireEvent.click(screen.getByRole('button', { name: 'Open For month' }))
  fireEvent.click(screen.getByRole('button', { name: 'November' }))
  expect(container.querySelector('input[type="month"]')).toHaveValue('2026-11')
})
