import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import ProgressBar from './ProgressBar'

describe('ProgressBar', () => {
  it('clamps progress to 100%', () => {
    const { container } = render(<ProgressBar value={140} />)
    expect(container.querySelector('.progress span')).toHaveStyle({ width: '100%' })
  })
})
