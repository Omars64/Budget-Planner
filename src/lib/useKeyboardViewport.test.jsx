import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import useKeyboardViewport from './useKeyboardViewport'
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
test('keyboard mode activates only for text entry with a reduced visual viewport', () => {
  const viewport=new window.EventTarget()
  viewport.height=window.innerHeight
  vi.stubGlobal('visualViewport',viewport)
  function Demo(){const open=useKeyboardViewport();return <><input aria-label="Text"/><output>{open?'Keyboard open':'Keyboard closed'}</output></>}
  render(<Demo/>)
  screen.getByLabelText('Text').focus()
  expect(screen.getByText('Keyboard closed')).toBeInTheDocument()
  viewport.height=window.innerHeight-300
  act(()=>viewport.dispatchEvent(new Event('resize')))
  expect(screen.getByText('Keyboard open')).toBeInTheDocument()
  viewport.height=window.innerHeight
  act(()=>viewport.dispatchEvent(new Event('resize')))
  expect(screen.getByText('Keyboard closed')).toBeInTheDocument()
  fireEvent.blur(screen.getByLabelText('Text'))
})
