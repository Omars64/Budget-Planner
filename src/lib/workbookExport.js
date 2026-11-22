import { zipSync, strToU8 } from 'fflate'
import { cellValue, formatted } from './workbookCells'
import { saveDownload } from './download'
import { workbookCellStyle, workbookMerges } from './workbookSheet'

const escape = v=>String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;')
function rows(ws,fn){
  const columns=ws.columnCount
  return Array.from({length:ws.rowCount},(_,r)=>{
    const row=ws.findRow(r+1)
    return Array.from({length:columns},(_,c)=>{
      const cell=row?.findCell(c+1)
      return cell && cell.master===cell ? fn(cell) : ''
    })
  })
}
function values(c){const v=cellValue(c);return v?.error ?? v}
function ods(wb){
  const mime='application/vnd.oasis.opendocument.spreadsheet'
  const sheets=wb.worksheets.map(ws=>{
    const body=rows(ws,values).map(row=>'<table:table-row>'+row.map(value=>{
      let type='office:value-type="string"'
      if(typeof value==='number')type='office:value-type="float" office:value="'+value+'"'
      if(typeof value==='boolean')type='office:value-type="boolean" office:boolean-value="'+value+'"'
      if(value instanceof Date)type='office:value-type="date" office:date-value="'+value.toISOString()+'"'
      return '<table:table-cell '+type+'><text:p>'+escape(value)+'</text:p></table:table-cell>'
    }).join('')+'</table:table-row>').join('')
    return '<table:table table:name="'+escape(ws.name)+'">'+body+'</table:table>'
  }).join('')
  return zipSync({mimetype:[strToU8(mime),{level:0}],
    'META-INF/manifest.xml':strToU8('<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2"><manifest:file-entry manifest:full-path="/" manifest:media-type="'+mime+'"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/></manifest:manifest>'),
    'content.xml':strToU8('<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.2"><office:body><office:spreadsheet>'+sheets+'</office:spreadsheet></office:body></office:document-content>')
  })
}
function exportTable(sheet) {
  const table=document.createElement('table')
  const columns=sheet.columnCount
  const merges=workbookMerges(sheet)
  const widths=table.appendChild(document.createElement('colgroup'))
  for(let column=1;column<=columns;column++)
    widths.appendChild(document.createElement('col')).style.width=(sheet.getColumn(column).width||14)*8+'px'
  const body=table.createTBody()
  for(let index=1;index<=sheet.rowCount;index++){
    const row=sheet.findRow(index)
    const output=body.insertRow()
    output.style.height=(row?.height||24)*4/3+'px'
    for(let column=1;column<=columns;column++){
      const cell=row?.findCell(column)
      if(cell && cell.master!==cell)continue
      const target=output.insertCell()
      if(!cell)continue
      target.textContent=formatted(cell)
      for(const [key,value] of Object.entries(workbookCellStyle(cell)))
        if(value)target.style[key]=value
      const merge=merges.get(cell.address)
      if(merge){
        target.rowSpan=merge.rowSpan
        target.colSpan=merge.colSpan
      }
    }
  }
  return table
}

export async function exportBook(type,wb,ws,name){
  let data,mime
  if(type==='xlsx'){data=await wb.xlsx.writeBuffer();mime='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}
  if(type==='ods'){data=ods(wb);mime='application/vnd.oasis.opendocument.spreadsheet'}
  if(type==='json'){data=JSON.stringify(wb.worksheets.map(s=>({name:s.name,rows:rows(s,values)})),null,2);mime='application/json'}
  if(type==='csv'||type==='tsv'){
    const sep=type==='csv'?',':'\t'
    data='\uFEFF'+rows(ws,c=>{
      const v=formatted(c)
      return typeof values(c)==='string' && /^[\s]*[=+@-]/.test(v)?"'"+v:v
    }).map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(sep)).join('\r\n')
    mime=type==='csv'?'text/csv':'text/tab-separated-values'
  }
  if(type==='html'||type==='pdf'){
    const clean=exportTable(ws)
    if(type==='html'){data='<!doctype html><meta charset="utf-8"><title>'+escape(ws.name)+'</title><style>table{border-collapse:collapse}td{padding:6px;border:1px solid #ddd}</style>'+clean.outerHTML;mime='text/html'}
    else{
      const [{jsPDF},{autoTable}]=await Promise.all([import('jspdf'),import('jspdf-autotable')])
      const doc=new jsPDF({orientation:ws.columnCount>4?'landscape':'portrait'})
      autoTable(doc,{html:clean,useCss:true,horizontalPageBreak:true,styles:{fontSize:9}})
      data=doc.output('arraybuffer');mime='application/pdf'
    }
  }
  const base=['xlsx','ods','json'].includes(type)?name:ws.name
  await saveDownload(new Blob([data],{type:mime}),base.replace(/[\\/:*?"<>|\u0000-\u001f]/g,'_')+'.'+type)
}
