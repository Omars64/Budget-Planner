const ALLOWED_MIMES = new Set([
  'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp', 'image/avif',
  'application/pdf', 'text/plain', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
])
const MAX_BYTES = 4 * 1024 * 1024

export function safeNoteAttachment(note) {
  const data = note?.attachment_data
  const mime = typeof note?.attachment_type === 'string' ? note.attachment_type.toLowerCase() : null
  if (typeof data !== 'string' || data.length > 6000000 || !ALLOWED_MIMES.has(mime)) return null
  const match = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(data)
  if (!match || match[1].toLowerCase() !== mime || (note.note_type === 'drawing' && mime !== 'image/png')) return null
  const encoded = match[2]
  if (encoded.length % 4 !== 0) return null
  try {
    const decoded = atob(encoded)
    return decoded.length > 0 && decoded.length <= MAX_BYTES ? data : null
  } catch {
    return null
  }
}
