import ExcelJS from 'exceljs'
import { unzipSync, zipSync, strFromU8 } from 'fflate'
import { fileLimit } from './workbookCells'
import limits from '../../workbook-limits.json'

const worksheetPart = /^xl\/worksheets\/[^/]+\.xml$/i
const unsupportedParts = [
  [/^xl\/(charts|chartsheets)\//i, 'charts'],
  [/^xl\/media\//i, 'images'],
  [/^xl\/drawings\//i, 'drawings'],
  [/^xl\/(pivotTables|pivotCache)\//i, 'pivot tables'],
  [/^(?:xl\/(?:vbaProject[^/]*\.bin|vbaData\.xml|activeX\/)|customUI\/)/i, 'macros and controls'],
  [/^xl\/embeddings\//i, 'embedded objects'],
]

function coordinates(ref) {
  const match = /^([A-Z]{1,3})([1-9]\d{0,5})$/i.exec(ref)
  if (!match) throw Error('This workbook contains an invalid cell reference.')
  const col = [...match[1].toUpperCase()].reduce((value,char)=>value*26+char.charCodeAt(0)-64,0)
  const row = Number(match[2])
  if (row>limits.rows || col>limits.columns) throw Error('Choose up to 50,000 rows and 512 columns per sheet.')
  return {row,col}
}

export async function loadWorkbook(bytes, { reportOmissions } = {}) {
  if (bytes.byteLength>fileLimit) throw Error('Choose an XLSX workbook up to 24 MB.')
  let size=0, count=0, cells=0
  const omitted = new Set()
  const excluded = new Set()
  const input = new Uint8Array(bytes)
  const parts=unzipSync(input,{filter:part=>{
    size+=part.originalSize
    if (++count>limits.entries || size>limits.expandedBytes) throw Error('This workbook expands to more data than Budgetly can open. Try splitting it into smaller workbooks.')
    const feature = unsupportedParts.find(([pattern]) => pattern.test(part.name))
    if (feature) {
      excluded.add(part.name)
      omitted.add(feature[1])
    }
    return worksheetPart.test(part.name)
  }})
  let mergedCells=0
  if (Object.keys(parts).length>limits.sheets) throw Error('Choose a workbook with up to 32 sheets.')
  for(const part of Object.values(parts)){
    const xml=strFromU8(part)
    for (const [,kind,ref] of xml.matchAll(/<(c|mergeCell|row)\b[^>]*?\s(?:r|ref)=["']([^"']+)["']/g)) {
      if (kind==='row') {
        if (Number(ref)>limits.rows) throw Error('Choose up to 50,000 rows and 512 columns per sheet.')
      } else if (kind==='c') {
        coordinates(ref)
        if (++cells>limits.cells) throw Error('Choose a workbook with up to 250,000 cells.')
      } else {
        const [start,end=start] = ref.split(':').map(coordinates)
        mergedCells+=(Math.abs(end.row-start.row)+1)*(Math.abs(end.col-start.col)+1)
        if(mergedCells>limits.cells) throw Error('This workbook has too many merged cells to open. Reduce the merged ranges and try again.')
      }
    }
  }
  const wb=new ExcelJS.Workbook()
  const worksheetCopy = omitted.size
    ? zipSync(unzipSync(input, { filter: part => !excluded.has(part.name) }))
    : bytes
  await wb.xlsx.load(worksheetCopy, omitted.size ? {
    ignoreNodes: ['drawing', 'picture', 'pivotTableParts', 'oleObjects', 'controls'],
  } : undefined)
  if(!wb.worksheets.length || wb.worksheets.length>limits.sheets) throw Error('Choose a workbook with 1–32 sheets.')
  if(wb.worksheets.some(s=>s.rowCount>limits.rows || s.columnCount>limits.columns)) throw Error('Choose up to 50,000 rows and 512 columns per sheet.')
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
  reportOmissions?.(Array.from(omitted).sort())
  return wb
}
