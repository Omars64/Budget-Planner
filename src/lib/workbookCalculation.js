import { cellValue } from './workbookCells'
import WorkbookWorker from './workbook.worker.js?worker'

export function workbookSnapshot(workbook, edit) {
  return {
    date1904: workbook.properties.date1904,
    sheets: workbook.worksheets.map(sheet => {
      const change = sheet.id === edit?.sheetId ? edit : null
      const cells = []
      sheet.eachRow(row => row.eachCell(cell => {
        if (cell.address === change?.address) return
        cells.push({
          address: cell.address, row: cell.row, col: cell.col,
          value: cell.formula ? cell.value : cellValue(cell),
          merged: cell.master !== cell,
        })
      }))
      if (change) cells.push(change)
      return {
        id: sheet.id, name: sheet.name, cells,
        rowCount: Math.max(sheet.rowCount, change?.row ?? 0),
        columnCount: Math.max(sheet.columnCount, change?.col ?? 0),
      }
    }),
  }
}

export function createWorkbookCalculator() {
  let worker
  let pending
  let closed = false
  return {
    async run(snapshot) {
      if (closed) throw new DOMException('Workbook closed', 'AbortError')
      if (typeof window.Worker === 'undefined') {
        const { calculateSnapshot } = await import('./workbookCalc')
        return calculateSnapshot(snapshot)
      }
      worker ??= new WorkbookWorker()
      return new Promise((resolve, reject) => {
        pending = reject
        worker.onmessage = ({data}) => {
          pending = null
          if (data.error) reject(new Error(data.error))
          else resolve(data)
        }
        worker.onerror = () => {
          pending = null
          worker.terminate()
          worker = null
          reject(new Error('Could not calculate this workbook. Try again.'))
        }
        worker.postMessage(snapshot)
      })
    },
    close() {
      closed = true
      worker?.terminate()
      pending?.(new DOMException('Workbook closed', 'AbortError'))
      pending = null
    },
  }
}

export function applyWorkbookResult(workbook, { total, issues, values }, edit) {
  const apply = entry => {
    const cell = workbook.getWorksheet(entry.sheetId).getCell(entry.address)
    const before = cell.value
    cell.value = entry.withResult ? { ...before, result:entry.result } : entry.value
    return () => { cell.value = before }
  }
  const undo = edit ? [apply(edit)] : []
  for (const value of values) undo.push(apply({ ...value, withResult:true }))
  return {
    report: {
      total,
      issues: new Map(issues.map(issue => [workbook.getWorksheet(issue.sheetId).getCell(issue.address), issue.reason])),
    },
    rollback: () => { undo.reverse().forEach(restore => restore()) },
  }
}
