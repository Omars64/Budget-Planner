import { format } from 'ssf'
import limits from '../../workbook-limits.json'

export const fileLimit = limits.fileBytes
export function encode(bytes) {
  const pieces = []
  for (let i=0;i<bytes.length;i+=8192) pieces.push(String.fromCharCode(...bytes.subarray(i,i+8192)))
  return btoa(pieces.join(''))
}
export function decode(data) {
  const text = atob(data)
  const bytes = new Uint8Array(text.length)
  for (let i=0;i<bytes.length;i++) bytes[i]=text.charCodeAt(i)
  return bytes
}

export function cellValue(cell) {
  if(cell.formula)return cell.result ?? ''
  if(cell.value?.richText || cell.value?.hyperlink)return cell.text
  return cell.value ?? ''
}
export function formatted(cell) {
  const value=cellValue(cell)
  if(value instanceof Date || typeof value==='number') {
    try {if(cell.numFmt)return format(cell.numFmt,value)} catch { /* Display the underlying value. */ }
  }
  if(value instanceof Date)return value.toISOString().slice(0,10)
  return String(value?.error ?? value)
}
export const inputValue = cell => cell.formula ? '='+cell.formula : cell.value instanceof Date ? cell.value.toISOString().slice(0,10) : String(cellValue(cell)?.error ?? cellValue(cell))
export function editedValue(cell,raw){
  if(raw.length>32767)throw Error('Enter up to 32,767 characters in a cell.')
  if(raw.startsWith('='))return {formula:raw.slice(1)}
  if(!raw)return null
  if(cell.value instanceof Date){
    const date=new Date(raw+'T00:00:00Z')
    if(!Number.isFinite(date.valueOf()) || date.toISOString().slice(0,10)!==raw)throw Error('Enter a date as YYYY-MM-DD.')
    return date
  }
  if(cell.numFmt!=='@' && /^-?(0|[1-9]\d*)(\.\d+)?$/.test(raw) && Number.isFinite(Number(raw)))return Number(raw)
  if(typeof cell.value==='boolean' && /^(true|false)$/i.test(raw))return raw.toLowerCase()==='true'
  return raw
}
