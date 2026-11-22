import {expect,test} from 'vitest'
import ExcelJS from 'exceljs'
import {calculate,formatted,loadWorkbook} from './workbook'

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
