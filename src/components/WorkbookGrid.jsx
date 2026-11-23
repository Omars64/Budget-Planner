import { memo, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { formatted } from '../lib/workbookCells'
import { workbookCellStyle, workbookMerges } from '../lib/workbookSheet'
import limits from '../../workbook-limits.json'

const gutter = 48

function offsetsFor(count, size) {
  const offsets = new Float64Array(count+1)
  for (let index=0;index<count;index++) offsets[index+1]=offsets[index]+size(index)
  return offsets
}

function windowFor(offsets, start, extent, overscan) {
  const count = offsets.length-1
  const boundary = value => {
    let first=0, last=count
    while (first<last) {
      const mid=(first+last)>>>1
      if(offsets[mid+1]<=value) first=mid+1
      else last=mid
    }
    return first
  }
  return [Math.max(0,boundary(start)-overscan),Math.min(count,boundary(start+extent)+overscan+1)]
}

export default memo(function WorkbookGrid({sheet,address,issues,revision}) {
  const viewport=useRef(null), body=useRef(null), frame=useRef(0)
  const measured=useRef(new Map())
  const [view,setView]=useState({top:0,left:0,height:480,width:700,measurements:0})
  const merges=useMemo(()=>workbookMerges(sheet),[sheet])
  const {height,width}=useMemo(()=>({
    height:Math.min(sheet.rowCount+1,limits.rows),
    width:Math.min(sheet.columnCount+1,limits.columns),
  }),[sheet,revision])
  const columns=useMemo(()=>Array.from({length:width},(_,index)=>sheet.getColumn(index+1)),[sheet,width])
  const cols=useMemo(()=>offsetsFor(width,index=>Math.max(44,(columns[index].width||14)*8)),[columns,width])
  const rows=useMemo(()=>offsetsFor(height,index=>measured.current.get(index) || Math.max(36,(sheet.findRow(index+1)?.height||24)*4/3)),
    [sheet,height,view.measurements])
  const [first,last]=windowFor(rows,Math.max(0,view.top-36),view.height,5)
  const [left,right]=windowFor(cols,Math.max(0,view.left-gutter),view.width,3)
  const visible=columns.slice(left,right)
  const before=cols[left], after=cols[width]-cols[right]
  const span=visible.length+Number(before>0)+Number(after>0)+1

  useLayoutEffect(()=>{
    const node=viewport.current
    const update=(entries=[])=>{
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
      const {clientHeight:height,clientWidth:width,scrollLeft:left,scrollTop:top}=node
      setView(previous=>changed || previous.top!==top || previous.left!==left || previous.height!==height || previous.width!==width
        ? {top,left,height,width,measurements:previous.measurements+Number(changed)} : previous)
    }
    update()
    if(!window.ResizeObserver) return
    const observer=new window.ResizeObserver(update)
    observer.observe(node)
    for(const row of body.current.querySelectorAll('[data-sheet-row]')) observer.observe(row)
    return ()=>observer.disconnect()
  },[first,last,left,right])

  useLayoutEffect(()=>()=>window.cancelAnimationFrame(frame.current),[])
  function onScroll() {
    window.cancelAnimationFrame(frame.current)
    frame.current=window.requestAnimationFrame(()=>{
      const node=viewport.current
      if(node) setView(previous=>({...previous,top:node.scrollTop,left:node.scrollLeft}))
    })
  }
  const spacer = size => size>0 && <tr aria-hidden="true"><td colSpan={span} style={{height:size,padding:0,border:0}}/></tr>
  const gap = size => size>0 && <td aria-hidden="true" className="workbook-gap"/>
  return <div className="workbook-scroll" ref={viewport} onScroll={onScroll} tabIndex={0}>
    <table aria-label={sheet.name} aria-rowcount={height+1} aria-colcount={width+1} style={{width:cols[width]+gutter}}>
      <colgroup><col style={{width:gutter}}/>{before>0&&<col style={{width:before}}/>}
        {visible.map((column,index)=><col key={column.number} style={{width:cols[left+index+1]-cols[left+index]}}/>)}
        {after>0&&<col style={{width:after}}/>}</colgroup>
      <thead><tr><th></th>{gap(before)}{visible.map(column=><th key={column.number} scope="col" aria-colindex={column.number+1}>{column.letter}</th>)}{gap(after)}</tr></thead>
      <tbody ref={body}>
        {spacer(rows[first])}
        {Array.from({length:last-first},(_,index)=>{
          const rowIndex=first+index, row=sheet.findRow(rowIndex+1)
          return <tr key={rowIndex} data-sheet-row={rowIndex} aria-rowindex={rowIndex+2} style={{height:(row?.height||24)*4/3}}>
            <th scope="row">{rowIndex+1}</th>
            {gap(before)}
            {visible.map(column=>{
              const cell=row?.findCell(column.number)?.master
              const ref=cell?.address ?? column.letter+(rowIndex+1)
              const merge=merges.get(ref)
              if(merge && (rowIndex!==Math.max(first,merge.first) || column.number-1!==Math.max(left,merge.left))) return null
              const value=cell ? formatted(cell) : ''
              const warning=issues.get(cell)
              return <td key={column.number} rowSpan={merge ? Math.min(last,merge.last)-rowIndex : undefined}
                colSpan={merge ? Math.min(right,merge.right)-column.number+1 : undefined} tabIndex={0}
                aria-colindex={column.number+1} aria-label={value ? ref+' '+value : ref} data-cell={ref} data-selected={ref===address}
                aria-description={warning} title={warning} style={workbookCellStyle(cell)}>
                {value}{warning&&<sup aria-label="Needs review"> ⚠</sup>}
              </td>
            })}
            {gap(after)}
          </tr>
        })}
        {spacer(rows[height]-rows[last])}
      </tbody>
    </table>
  </div>
})
