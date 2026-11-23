import { api, jsonBody } from './api'
import { decode, encode } from './workbookCells'
import limits from '../../workbook-limits.json'

export const workbookPath = '/api/workbooks'

async function retry(read, signal) {
  for (let attempt=0; ; attempt++) {
    signal.throwIfAborted()
    try { return await read() }
    catch (error) {
      if (attempt===2 || !error.network && ![502,503,504].includes(error.status)) throw error
    }
  }
}

export async function downloadWorkbook(record, path, signal, progress) {
  if (typeof record.data === 'string') return decode(record.data)
  if (!Number.isSafeInteger(record.size) || record.size<=0 || record.size>limits.fileBytes) {
    throw Error('Workbook download size is unavailable. Open the workbook again.')
  }
  const bytes = new Uint8Array(record.size)
  for (let offset=0, part=0; offset<bytes.length; offset+=limits.partBytes, part++) {
    const {data} = await retry(() => api(path(part), {signal}), signal)
    const chunk = decode(data)
    if (chunk.length !== Math.min(limits.partBytes, bytes.length-offset)) throw Error('Workbook download was incomplete. Open it again.')
    bytes.set(chunk, offset)
    progress?.(Math.round(100 * (offset+chunk.length)/bytes.length))
  }
  return bytes
}

export async function saveWorkbook(document, bytes, signal, progress) {
  const { id, name, revision } = document
  if (bytes.length <= limits.partBytes) {
    return api(`${workbookPath}/${id}`, {method:'PUT', signal, ...jsonBody({name,revision,data:encode(bytes)})})
  }
  const transfer = `${workbookPath}/uploads/${crypto.randomUUID()}`
  const put = (path, payload) => retry(() => api(path, {method:'PUT', signal, ...jsonBody(payload)}), signal)
  try {
    const {received} = await put(transfer, {book_id:id,name,revision,size:bytes.length})
    for (let offset=received; offset<bytes.length; offset+=limits.partBytes) {
      const part = bytes.subarray(offset,offset+limits.partBytes)
      await put(`${transfer}/parts/${offset/limits.partBytes}`, {data:encode(part)})
      progress?.(Math.round(100 * (offset+part.length)/bytes.length))
    }
    return await retry(() => api(transfer+'/finish', {method:'POST',signal}), signal)
  } finally {
    if (!signal.aborted) void api(transfer, {method:'DELETE'}).catch(() => {})
  }
}
