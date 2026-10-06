import {cleanup,fireEvent,render,screen} from '@testing-library/react'
import {afterEach,expect,test,vi} from 'vitest'
import ReceiptDraft from './ReceiptDraft'
vi.mock('../lib/receiptImage',()=>({receiptImage:vi.fn(async()=>({name:'photo.jpg',image:'data:image/jpeg;base64,AA=='}))}))
afterEach(cleanup)
test('prepares a reference image without making a separate upload request',async()=>{
  const onChange=vi.fn(),onBusy=vi.fn()
  render(<ReceiptDraft shared onChange={onChange} onBusy={onBusy}/>)
  fireEvent.change(screen.getByLabelText('Choose reference image'),{target:{files:[new globalThis.File(['photo'],'photo.jpg',{type:'image/jpeg'})]}})
  await screen.findByText('Visible to members of this shared wallet.')
  await vi.waitFor(()=>expect(onChange).toHaveBeenCalledWith(expect.objectContaining({name:'photo.jpg'})))
  expect(onBusy).toHaveBeenCalledWith(true)
  expect(onBusy).toHaveBeenLastCalledWith(false)
})
