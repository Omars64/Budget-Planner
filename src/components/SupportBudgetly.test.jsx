import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import SupportBudgetly from './SupportBudgetly'

afterEach(cleanup)

it('keeps optional support collapsed and links only to the verified public page', () => {
  render(<SupportBudgetly/> )
  const section = screen.getByText('Buy me a coffee').closest('details')
  expect(section).not.toHaveAttribute('open')
  fireEvent.click(screen.getByText('Buy me a coffee'))
  const link = screen.getByRole('link', { name: 'Support on Ko-fi' })
  expect(link).toHaveAttribute('href', 'https://ko-fi.com/omarsolanki')
  expect(link).toHaveAttribute('target', '_blank')
  expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  expect(link).toHaveAttribute('referrerpolicy', 'no-referrer')
  expect(section.querySelectorAll('input, iframe, script')).toHaveLength(0)
  expect(screen.getByText(/whether you tip or not/)).toBeInTheDocument()
})
