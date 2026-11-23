const color = value => /^[\da-f]{8}$/i.test(value?.argb) ? '#'+value.argb.slice(2) : undefined

export function workbookMerges(sheet) {
  if (!sheet.hasMerges) return new Map()
  return new Map(sheet.model.merges.map(range => {
    const [start,end] = range.split(':').map(ref => sheet.getCell(ref))
    return [start.address, {first:start.row-1, last:end.row, left:start.col-1, right:end.col}]
  }))
}

export function workbookCellStyle(cell) {
  return {
    backgroundColor:color(cell?.fill?.fgColor), color:color(cell?.font?.color),
    fontSize:cell?.font?.size ? cell.font.size+'pt' : undefined,
    fontWeight:cell?.font?.bold ? 'bold' : undefined, fontStyle:cell?.font?.italic ? 'italic' : undefined,
    textAlign:cell?.alignment?.horizontal || (typeof cell?.value==='number' || typeof cell?.result==='number' ? 'right' : 'left'),
  }
}
