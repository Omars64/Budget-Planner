import { memo, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { formatted } from '../lib/workbookCells'
import { workbookCellStyle, workbookMerges } from '../lib/workbookSheet'

export default memo(function WorkbookGrid({sheet,address,issues}) {
  const viewport=useRef(null), body=useRef(null), frame=useRef(0)
  const measured=useRef(new Map())
  const [view,setView]=useState({top:0,height:480})
  const merges=useMemo(()=>workbookMerges(sheet),[sheet])
  const columnCount=sheet.columnCount, rowCount=sheet.rowCount
  const width=Math.min(columnCount+1,50), height=Math.min(rowCount+1,1000)
  const columns=useMemo(()=>Array.from({length:width},(_,i)=>sheet.getColumn(i+1)),[sheet,width])
  const virtual=height>=80
  const offsets=[0]
  for(let i=0;i<height;i++) {
    const row=sheet.findRow(i+1)
    offsets.push(offsets[i]+(measured.current.get(i) || Math.max(36,(row?.height||24)*4/3)))
  }
  let first=0, last=height
  if(virtual) {
    while(first<height-1 && offsets[first+1]<view.top) first++
    last=first+1
    while(last<height && offsets[last]<view.top+view.height) last++
    first=Math.max(0,first-5)
    last=Math.min(height,last+5)
    // Render any merged region that crosses the edge of the visible window.
    let expanded
    do {
      expanded=false
      for(const {first:start,last:end} of merges.values()) {
        if(start>=last || end<=first) continue
        if(start<first) { first=start;expanded=true }
        if(end>last) { last=end;expanded=true }
      }
    } while(expanded)
  }

  useLayoutEffect(()=>{
    if(!virtual || !viewport.current) return
    const node=viewport.current
    const observer=new window.ResizeObserver(entries=>{
      let changed=false
      for(const entry of entries) {
        const index=Number(entry.target.dataset.sheetRow)
        if(!Number.isInteger(index)) continue
        const size=entry.target.getBoundingClientRect().height
        if(size>0 && Math.abs((measured.current.get(index)||0)-size)>0.5) {
          measured.current.set(index,size)
          changed=true
        }
      }
      const top=node.scrollTop, height=node.clientHeight
      setView(previous=>changed || previous.top!==top || previous.height!==height ? {top,height} : previous)
    })
    observer.observe(node)
    for(const row of body.current.querySelectorAll('[data-sheet-row]')) observer.observe(row)
    return ()=>observer.disconnect()
  },[virtual,first,last])

  useLayoutEffect(()=>()=>window.cancelAnimationFrame(frame.current),[])

  function onScroll() {
    if(!virtual) return
    window.cancelAnimationFrame(frame.current)
    frame.current=window.requestAnimationFrame(()=>{
      if(viewport.current) setView({top:viewport.current.scrollTop,height:viewport.current.clientHeight})
    })
  }
  const spacer = size => size>0 && <tr aria-hidden="true"><td colSpan={width+1} style={{height:size,padding:0,border:0}}/></tr>
  return <div className="workbook-scroll" ref={viewport} onScroll={onScroll} tabIndex={virtual?0:undefined}>
    <table aria-label={sheet.name} aria-rowcount={height+1}>
      <colgroup><col style={{width:40}}/>{columns.map(column=><col key={column.number} style={{width:(column.width||14)*8}}/>)}</colgroup>
      <thead><tr><th></th>{columns.map(column=><th key={column.number} scope="col">{column.letter}</th>)}</tr></thead>
      <tbody ref={body}>
        {spacer(offsets[first])}
        {Array.from({length:last-first},(_,index)=>{
          const rowIndex=first+index, row=sheet.findRow(rowIndex+1)
          return <tr key={rowIndex} data-sheet-row={rowIndex} aria-rowindex={rowIndex+2} style={{height:(row?.height||24)*4/3}}>
            <th scope="row">{rowIndex+1}</th>
            {columns.map(column=>{
              const cell=row?.findCell(column.number)
              if(cell && cell.master!==cell) return null
              const ref=column.letter+(rowIndex+1), value=cell ? formatted(cell) : ''
              const merge=merges.get(ref), warning=issues.get(cell)
              return <td key={ref} rowSpan={merge?.rowSpan} colSpan={merge?.colSpan} tabIndex={0}
                aria-label={value ? ref+' '+value : ref} data-cell={ref} data-selected={ref===address}
                aria-description={warning} title={warning} style={workbookCellStyle(cell)}>
                {value}{warning&&<sup aria-label="Needs review"> ⚠</sup>}
              </td>
            })}
          </tr>
        })}
        {spacer(offsets[height]-offsets[last])}
      </tbody>
    </table>
  </div>
})
