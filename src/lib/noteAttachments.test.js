import {expect, test} from 'vitest'
import {safeNoteAttachment} from './noteAttachments'

test('only matching base64 attachments can become links', () => {
  const valid = {attachment_type:'application/pdf',attachment_data:'data:application/pdf;base64,JVBERg=='}
  expect(safeNoteAttachment(valid)).toBe(valid.attachment_data)
  for (const data of ['javascript:alert(1)', 'https://example.com/file', 'data:text/html;base64,PHNjcmlwdD4=', 'data:application/pdf;base64,!', 'data:application/pdf;base64,YQ']) {
    expect(safeNoteAttachment({...valid,attachment_data:data})).toBeNull()
  }
  expect(safeNoteAttachment({...valid,attachment_type:'image/png'})).toBeNull()
  expect(safeNoteAttachment({...valid,note_type:'drawing'})).toBeNull()
  expect(safeNoteAttachment({...valid,attachment_data:'data:application/pdf;base64,'+btoa('a'.repeat(4*1024*1024+1))})).toBeNull()
})
