import ExcelJS from 'exceljs'
import { unzipSync, strFromU8 } from 'fflate'
import { fileLimit } from './workbookCells'

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
