import Parser from 'fast-formula-parser'
import { cellValue } from './workbookCells'

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

export function calculateSnapshot(snapshot) {
  const worksheets = snapshot.sheets.map(({cells, ...sheet}) => {
    const byRow = new Map()
    for (const item of cells) {
      if (!byRow.has(item.row)) byRow.set(item.row, new Map())
      const cell = {
        ...item, formula:item.value?.formula, result:item.value?.result, worksheet:sheet,
      }
      cell.master = item.merged ? null : cell
      byRow.get(cell.row).set(cell.col, cell)
    }
    return {
      ...sheet,
      findRow: row => ({ findCell: col => byRow.get(row)?.get(col) }),
      eachRow: callback => byRow.forEach(row => callback({ eachCell: fn => row.forEach(fn) })),
    }
  })
  const {total, issues} = calculate({worksheets, properties:{date1904:snapshot.date1904}})
  const values = []
  for (const sheet of worksheets) sheet.eachRow(row => row.eachCell(cell => {
    if (cell.formula && !issues.has(cell)) values.push({sheetId:sheet.id,address:cell.address,result:cell.value.result})
  }))
  return {total, values, issues:Array.from(issues, ([cell, reason]) => ({
    sheetId:cell.worksheet.id, address:cell.address, reason,
  }))}
}
