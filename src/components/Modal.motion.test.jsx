import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import Modal from './Modal'
import MotionPreferences from './MotionPreferences'
import { saveComfort } from '../lib/comfort'

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); delete document.documentElement.dataset.motion })

test('exiting dialog keeps scroll lock and Back ownership until focus is restored', async () => {
  const close = vi.fn()
  const trigger = document.createElement('button')
  document.body.append(trigger)
  trigger.focus()
  const view = render(<MotionPreferences><Modal open title="Edit" onClose={close}><input aria-label="Draft"/></Modal></MotionPreferences>)
  await waitFor(() => expect(screen.getByRole('dialog')).toHaveFocus())
  expect(document.body.style.overflow).toBe('hidden')
  view.rerender(<MotionPreferences><Modal open={false} title="Edit" onClose={close}><input aria-label="Draft"/></Modal></MotionPreferences>)
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  expect(document.body.style.overflow).toBe('hidden')
  const back = new Event('budgetly:back', { cancelable: true })
  act(() => window.dispatchEvent(back))
  expect(back.defaultPrevented).toBe(true)
  expect(close).not.toHaveBeenCalled()
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  await waitFor(() => expect(trigger).toHaveFocus())
  expect(document.body.style.overflow).toBe('')
  trigger.remove()
})

test('off and app reduced popup entrances render at rest and restore focus after close', async () => {
  saveComfort({ motion: 'off' })
  const close = vi.fn()
  const view = render(<MotionPreferences><Modal open slowEntrance title="Sheet" onClose={close}><input aria-label="Draft"/></Modal></MotionPreferences>)
  const dialog = screen.getByRole('dialog')
  expect(dialog.style.transform).toBe('none')
  expect(dialog.style.opacity).toBe('1')
  fireEvent.change(screen.getByLabelText('Draft'), { target: { value: 'Keep me' } })
  act(() => saveComfort({ motion: 'reduced' }))
  expect(screen.getByLabelText('Draft')).toHaveValue('Keep me')
  expect(screen.getByRole('dialog')).toBe(dialog)
  view.rerender(<MotionPreferences><Modal open={false} slowEntrance title="Sheet" onClose={close}/></MotionPreferences>)
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(document.body.style.overflow).toBe('')
})

test('replacing a modal retains the newer dialog focus after the outgoing exit', async () => {
  const trigger = document.createElement('button')
  document.body.append(trigger)
  trigger.focus()
  function Dialogs({ managing }) {
    return <MotionPreferences>
      <Modal open={!managing} title="Spaces" onClose={() => {}}><button>Manage Holiday</button></Modal>
      <Modal open={managing} title="Holiday" onClose={() => {}}><input aria-label="Space name"/></Modal>
    </MotionPreferences>
  }
  const view = render(<Dialogs managing={false}/>)
  await waitFor(() => expect(screen.getByRole('dialog', { name: 'Spaces' })).toHaveFocus())
  view.rerender(<Dialogs managing/>)
  const newer = screen.getByRole('dialog', { name: 'Holiday' })
  await waitFor(() => expect(newer).toHaveFocus())
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Spaces' })).not.toBeInTheDocument())
  expect(newer).toHaveFocus()
  expect(trigger).not.toHaveFocus()
  expect(document.body.style.overflow).toBe('hidden')
  trigger.remove()
})

test('closing a nested prompt restores focus to its control in the parent dialog', async () => {
  function Dialogs({ prompting }) {
    return <MotionPreferences>
      <Modal open title="Parent" onClose={() => {}}><button>Open prompt</button></Modal>
      <Modal open={prompting} title="Prompt" onClose={() => {}}>Confirm changes</Modal>
    </MotionPreferences>
  }
  const view = render(<Dialogs prompting={false}/>)
  await waitFor(() => expect(screen.getByRole('dialog', { name: 'Parent' })).toHaveFocus())
  const control = screen.getByRole('button', { name: 'Open prompt' })
  control.focus()
  view.rerender(<Dialogs prompting/>)
  await waitFor(() => expect(screen.getByRole('dialog', { name: 'Prompt' })).toHaveFocus())
  view.rerender(<Dialogs prompting={false}/>)
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Prompt' })).not.toBeInTheDocument())
  await waitFor(() => expect(control).toHaveFocus())
  expect(document.body.style.overflow).toBe('hidden')
})

test('approved slow popup starts its deliberate float 110 pixels below rest', () => {
  render(<MotionPreferences><Modal open slowEntrance title="Update" onClose={() => {}}/></MotionPreferences>)
  expect(screen.getByRole('dialog').style.transform).toBe('translateY(110px)')
})
