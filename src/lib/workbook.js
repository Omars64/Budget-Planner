import ExcelJS from 'exceljs'
import Parser from 'fast-formula-parser'
import { unzipSync, strFromU8 } from 'fflate'
import { format } from 'ssf'

export const fileLimit = 2 * 1024 * 1024
export function encode(bytes) {
  const pieces = []
  for (let i=0;i<bytes.length;i+=8192) pieces.push(String.fromCharCode(...bytes.subarray(i,i+8192)))
  return btoa(pieces.join(''))
}
export const decode = data => Uint8Array.from(atob(data), ch=>ch.charCodeAt(0))

export async function loadWorkbook(bytes) {
  if (bytes.byteLength>fileLimit) throw Error('Choose an XLSX workbook up to 2 MB.')
  let size=0, count=0, cells=0
  const parts=unzipSync(new Uint8Array(bytes),{filter:part=>{
    size+=part.originalSize
    if (++count>800 || size>16*1024*1024) throw Error('This workbook is too large to open.')
    if (/^xl\/(charts|pivotTables|vbaProject|drawings)\b/i.test(part.name)) throw Error('This workbook contains charts, images, macros or pivots. Import a worksheet-only copy to preserve the original.')
    return /^xl\/worksheets\/[^/]+\.xml$/.test(part.name)
  }})
  for(const part of Object.values(parts)){
    const xml=strFromU8(part)
    cells+=(xml.match(/<c\b/g)||[]).length
    if(cells>40000) throw Error('Import up to 40,000 populated cells at a time.')
    for (const match of xml.matchAll(/<(?:c|mergeCell)\b[^>]*?\b(?:r|ref)="([^"]+)"/g)) {
      for (const ref of match[1].split(':')) {
        if (!/^(?:[A-Z]|A[A-X])(?:[1-9]\d{0,2}|1000)$/.test(ref)) throw Error('Import up to 1,000 rows and 50 columns per sheet.')
      }
    }
  }
  const wb=new ExcelJS.Workbook()
  await wb.xlsx.load(bytes)
  if(!wb.worksheets.length || wb.worksheets.length>16 || wb.worksheets.some(s=>s.rowCount>1000 || s.columnCount>50)) throw Error('Choose a workbook with 1–16 sheets, up to 1,000 rows and 50 columns each.')
  // Materialize shared formulas before an edit can replace their master cell.
  for (const ws of wb.worksheets) {
    const shared = []
    ws.eachRow(row => row.eachCell(cell => {
      if (cell.value?.sharedFormula || cell.value?.shareType === 'shared') {
        shared.push([cell, {formula: cell.formula, result: cell.result}])
      }
    }))
    for (const [cell, value] of shared) cell.value = value
  }
  return wb
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

const allowed=new Set('SUM SUMIF SUMIFS COUNT COUNTA COUNTIF COUNTIFS AVERAGE MIN MAX ROUND ROUNDUP ROUNDDOWN ABS INT MOD IF IFERROR AND OR NOT LEN LEFT RIGHT TRIM UPPER LOWER CONCATENATE DATE DAY MONTH YEAR ROW COLUMN'.split(' '))
export function calculate(wb) {
  const results=new Map(),issues=new Map(),visiting=new Set(),parsers=[]
  const sheets=new Map(wb.worksheets.map(ws=>[ws.name.toLowerCase(),ws]))
  let budget=500000, total=0
  function read(ws,row,col){
    if(--budget<0)throw Error('Calculation exceeds the workbook limit.')
    if(!ws)throw Error('Worksheet reference unavailable.')
    if(row>1000 || col>50)return null
    const c=ws.findRow(row)?.findCell(col)
    if(!c)return null
    if(!c.formula){
      const v=cellValue(c)
      if(v instanceof Date)return v.getTime()/86400000+(wb.properties.date1904?24107:25569)
      return v?.error ? new Parser.FormulaError(v.error) : c.value==null ? null : v
    }
    if(issues.has(c))throw Error('Depends on a cell that needs review.')
    if(results.has(c))return results.get(c)
    if(visiting.has(c) || visiting.size>=48)throw Error('Circular or deeply nested reference.')
    const depth=visiting.size
    visiting.add(c)
    try {
      const formula=c.formula
      const syntax=formula.replace(/"(?:[^"]|"")*"|'(?:[^']|'')*'/g,'')
      if(formula.length>2000 || /[\[\]{}]/.test(syntax) || c.value?.shareType==='array')throw Error('External, table or array formula.')
      for(const m of syntax.matchAll(/([\w.]+)\s*\(/g))if(!allowed.has(m[1].toUpperCase()))throw Error(m[1]+' requires the source spreadsheet.')
      if (!parsers[depth]) {
        const parser = new Parser({
          onVariable:()=>{throw Error('Named range needs review.')},
          onCell:ref=>read(sheets.get(ref.sheet?.toLowerCase()),ref.row,ref.col),
          onRange:ref=>{
            const sheet=sheets.get(ref.sheet?.toLowerCase())
            if(!sheet)throw Error('Missing worksheet.')
            const rows=Math.max(1,Math.min(ref.to.row,sheet.rowCount)-ref.from.row+1)
            const cols=Math.max(1,Math.min(ref.to.col,sheet.columnCount)-ref.from.col+1)
            if(rows*cols>50000)throw Error('Range exceeds the workbook limit.')
            return Array.from({length:rows},(_,r)=>Array.from({length:cols},(_,i)=>read(sheet,r+ref.from.row,i+ref.from.col)))
          }
        })
        parser.functions = Object.assign(Object.create(null),
          Object.fromEntries(Object.entries(parser.functions).filter(([name]) => allowed.has(name))))
        parsers[depth] = parser
      }
      const value=parsers[depth].parse(formula,{row,col,sheet:ws.name})
      if(value instanceof Error && !['#DIV/0!','#N/A','#NUM!','#VALUE!'].includes(value.error))throw Error('Unsupported formula or reference.')
      results.set(c,value)
      return value
    }catch(error){issues.set(c,error.message || 'This formula needs review.');throw error}
    finally{visiting.delete(c)}
  }
  for(const ws of wb.worksheets)ws.eachRow(row=>row.eachCell(c=>{
    if(!c.formula || c.master!==c)return
    total++
    try{read(ws,c.row,c.col)}catch{/* Listed for import and editing review. */}
  }))
  for(const [c,value] of results)c.value={...c.value,result:value instanceof Error?{error:value.error}:value}
  return {total,issues}
}
