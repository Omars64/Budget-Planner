import {expect,test} from 'vitest'
import ExcelJS from 'exceljs'
import { strToU8, unzipSync, zipSync } from 'fflate'
import {loadWorkbook} from './workbook'
import {formatted} from './workbookCells'
import {calculate, calculateSnapshot} from './workbookCalc'
import {applyWorkbookResult, workbookSnapshot} from './workbookCalculation'

test('imports a worksheet copy of a drawn workbook and preserves its formulas and styles', async () => {
  const source = new ExcelJS.Workbook()
  const sheet = source.addWorksheet('Expenses')
  sheet.getCell('A1').value = 6
  sheet.getCell('A1').numFmt = '0.000'
  sheet.getCell('B1').value = { formula:'A1*2', result:12 }
  sheet.mergeCells('C1:D1')
  sheet.addImage(source.addImage({ extension:'png', base64:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jLioAAAAASUVORK5CYII=' }), 'E1:F2')
  const parts = unzipSync(new Uint8Array(await source.xlsx.writeBuffer()))
  parts['xl/charts/chart1.xml'] = strToU8('<chart/>')
  parts['xl/pivotCache/pivotCacheDefinition1.xml'] = strToU8('<pivotCacheDefinition/>')
  let omitted
  const book = await loadWorkbook(zipSync(parts), { reportOmissions: features => { omitted = features } })
  const imported = book.getWorksheet('Expenses')
  expect(omitted).toEqual(['charts', 'drawings', 'images', 'pivot tables'])
  expect(imported.getCell('A1').numFmt).toBe('0.000')
  expect(imported.getCell('B1').value).toEqual({ formula:'A1*2', result:12 })
  expect(imported.getCell('D1').isMerged).toBe(true)
  expect(imported.getImages()).toEqual([])
  expect(Object.keys(unzipSync(new Uint8Array(await book.xlsx.writeBuffer())))).not.toContain('xl/charts/chart1.xml')
})

test('updates cross-sheet totals, arithmetic and conditional formulas, and flags stale dependencies',async()=>{
  const wb=new ExcelJS.Workbook()
  const s=wb.addWorksheet('Personal Expense'),summary=wb.addWorksheet('Summary')
  s.getCell('A1').value=5;s.getCell('B1').value=4
  s.getCell('C1').value={formula:'A1*B1',result:0}
  s.getCell('A2').value={formula:'IMPORTRANGE("source","A1")',result:88}
  s.getCell('B2').value={formula:'A2+1',result:89}
  s.getCell('D2').value={formula:'D2+1'}
  summary.getCell('B1').value={formula:"IF('Personal Expense'!C1>10,SUM('Personal Expense'!A1:C1),0)"}
  expect(calculate(wb).issues.size).toBe(3)
  expect(summary.getCell('B1').result).toBe(29)
  s.getCell('A1').value=7
  calculate(wb)
  expect(summary.getCell('B1').result).toBe(39)
  const copy=await loadWorkbook(await wb.xlsx.writeBuffer())
  expect(formatted(copy.getWorksheet('Summary').getCell('B1'))).toBe('39')
  expect(copy.getWorksheet('Personal Expense').getCell('A2').result).toBe(88)
})

test('keeps Excel shared formulas editable when the original master cell is replaced', async () => {
  const source = new ExcelJS.Workbook()
  const worksheet = source.addWorksheet('Expenses')
  worksheet.getCell('A1').value = 3
  worksheet.getCell('A2').value = 5
  worksheet.fillFormula('B1:B2', 'A1*2', [6, 10])

  const book = await loadWorkbook(await source.xlsx.writeBuffer())
  const sheet = book.getWorksheet('Expenses')
  sheet.getCell('B1').value = 11
  sheet.getCell('A2').value = 8
  expect(calculate(book).issues.size).toBe(0)
  expect(sheet.getCell('B2').formula).toBe('A2*2')
  expect(sheet.getCell('B2').result).toBe(16)
})

test('calculates an isolated edit and can roll back both the value and its cross-sheet result', () => {
  const wb = new ExcelJS.Workbook()
  const expenses = wb.addWorksheet('Expenses')
  const summary = wb.addWorksheet('Summary')
  expenses.getCell('A1').value = 2
  summary.getCell('B1').value = {formula:'Expenses!A1*3',result:6}
  const edit = {sheetId:expenses.id,address:'A1',row:1,col:1,value:5}
  const result = calculateSnapshot(workbookSnapshot(wb, edit))
  expect(expenses.getCell('A1').value).toBe(2)
  const { report, rollback } = applyWorkbookResult(wb, result, edit)
  expect(report.issues.size).toBe(0)
  expect(expenses.getCell('A1').value).toBe(5)
  expect(summary.getCell('B1').result).toBe(15)
  rollback()
  expect(expenses.getCell('A1').value).toBe(2)
  expect(summary.getCell('B1').result).toBe(6)
})
