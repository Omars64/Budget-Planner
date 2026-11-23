import {useEffect,useRef,useState} from 'react'
import {Capacitor} from '@capacitor/core'
import {ArrowLeft, FileSpreadsheet, Upload, Download, Trash2} from 'lucide-react'
import {api,jsonBody} from '../lib/api'
import {openGoogleFlow,reserveGoogleWindow} from '../lib/googleFlow'
import {decode,editedValue,encode,fileLimit,inputValue} from '../lib/workbookCells'
import {applyWorkbookResult, createWorkbookCalculator, workbookSnapshot} from '../lib/workbookCalculation'
import Modal from '../components/Modal'
import InfoButton from '../components/InfoButton'
import WorkbookGrid from '../components/WorkbookGrid'
import './Workbooks.css'

const path='/api/workbooks'
const exportFormats={xlsx:'Excel · all sheets',ods:'OpenDocument · all sheets as values',csv:'CSV · current sheet',tsv:'TSV · current sheet',pdf:'PDF · current sheet',html:'HTML · current sheet',json:'JSON · all sheets as values'}
export default function Workbooks(){
  const [books,setBooks]=useState([]),[doc,setDoc]=useState(null),[review,setReview]=useState(null)
  const [tab,setTab]=useState(0),[address,setAddress]=useState('A1'),[raw,setRaw]=useState('')
  const [modal,setModal]=useState(''),[type,setType]=useState('xlsx'),[error,setError]=useState(''),[busy,setBusy]=useState(false)
  const [pickerOpen,setPickerOpen]=useState(false)
  const [copyHelp,setCopyHelp]=useState(false)
  const [formulasVisible,setFormulasVisible]=useState(false)
  const [formulaLimit,setFormulaLimit]=useState(30)
  const file=useRef(),lock=useRef(false),controller=useRef(),picker=useRef(),calculator=useRef(null)
  const sheet=doc?.wb.worksheets[tab],cell=sheet?.getCell(address)
  const dirty=cell && raw!==inputValue(cell)
  useEffect(()=>{
    const token=new AbortController();controller.current=token
    api(path,{signal:token.signal}).then(setBooks).catch(e=>{if(!token.signal.aborted)setError(e.message)})
    return ()=>{token.abort();picker.current?.abort();calculator.current?.close();calculator.current=null}
  },[])
  useEffect(()=>{
    if(!dirty)return
    const warn=e=>{e.preventDefault();e.returnValue=''}
    window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn)
  },[dirty])
  async function act(fn){
    if(lock.current)return
    lock.current=true;setBusy(true);setError('')
    try{await fn()}catch(e){if(!controller.current.signal.aborted)setError(e.message || 'Workbook operation failed.')}
    finally{lock.current=false;setBusy(false)}
  }
  const choose=c=>{setAddress(c.address);setRaw(inputValue(c))}
  function open(value){
    setDoc(value);setTab(0);choose(value.wb.worksheets[0].getCell('A1'));setModal('');setReview(null)
  }
  async function parse(bytes){
    const {loadWorkbook}=await import('../lib/workbook')
    let omittedFeatures=[]
    const wb=await loadWorkbook(bytes,{reportOmissions:features=>{omittedFeatures=features}})
    const result=await recalculate(wb)
    return {wb,omittedFeatures,report:applyWorkbookResult(wb,result).report}
  }
  async function recalculate(wb,edit){
    const {signal}=controller.current
    signal.throwIfAborted()
    const snapshot=workbookSnapshot(wb,edit)
    if (!snapshot.sheets.some(sheet=>sheet.cells.some(entry=>entry.value?.formula))) return {total:0,issues:[],values:[]}
    calculator.current ??= createWorkbookCalculator()
    const result=await calculator.current.run(snapshot)
    signal.throwIfAborted()
    return result
  }
  async function read(record){
    return {...record,data:undefined,...await parse(decode(record.data))}
  }
  async function prepare(bytes,name){
    setFormulasVisible(false);setFormulaLimit(30)
    setReview({name:name.replace(/\.xlsx$/i,'').slice(0,120)||'Workbook',revision:0,id:crypto.randomUUID(),...await parse(bytes)})
    setModal('review')
  }
  async function persist(d){
    const {signal}=controller.current
    const bytes=new Uint8Array(await d.wb.xlsx.writeBuffer())
    signal.throwIfAborted()
    if(bytes.length>fileLimit)throw Error('The saved workbook exceeds 2 MB.')
    const meta=await api(path+'/'+d.id,{method:'PUT', signal, ...jsonBody({name:d.name,revision:d.revision,data:encode(bytes)})})
    setBooks(list=>[meta,...list.filter(b=>b.id!==meta.id)])
    return {...d,...meta}
  }
  async function commit(){
    if(!dirty)return doc
    const edit={sheetId:sheet.id,address:cell.address,row:cell.row,col:cell.col,value:editedValue(cell,raw)}
    const result=await recalculate(doc.wb,edit)
    const issue=result.issues.find(entry=>entry.sheetId===edit.sheetId && entry.address===edit.address)
    if (issue) throw Error(issue.reason)
    const {report,rollback}=applyWorkbookResult(doc.wb,result,edit)
    try{
      const next=await persist({...doc,report})
      setDoc(next);choose(cell);return next
    }catch(e){rollback();throw e}
  }
  function selectCell(event){
    const ref=event.target.closest('td[data-cell]')?.dataset.cell
    if(!ref || ref===address)return
    void act(async()=>{await commit();choose(sheet.getCell(ref))})
  }
  const google=()=>act(async()=>{
    const external=window.budgetlyDesktop?.openGooglePicker
    const popup=reserveGoogleWindow({external})
    const request=new AbortController()
    picker.current=request
    setPickerOpen(true)
    const {signal}=request
    try{
      const flow=await api(path+'/google/start',{method:'POST',signal,...jsonBody({android:Capacitor.getPlatform()==='android'})})
      if (signal.aborted) return
      const result=await openGoogleFlow(flow,{popup,external,signal,pollPath:path+'/google/poll',pollBody:{flow_id:flow.flow_id,poll_secret:flow.poll_secret}})
      if(result.status!=='ready')throw Error('Google import ended. Choose your sheet again.')
      await prepare(decode(result.data),result.name)
    }catch(error){
      if(!signal.aborted)throw error
    }finally{
      popup?.close()
      setPickerOpen(false)
      picker.current=null
    }
  })
  const report=review?.report || doc?.report
  const message=error && <div role="alert" className="form-error">{error}</div>
  return <section className="workbooks stack gap-16" aria-busy={busy}>
    {!doc?<><div className="button-row"><h2>Your library</h2><button className="button primary" disabled={busy} onClick={()=>{setError('');setModal('import')}}><Upload/> Import workbook</button></div>
      {!books.length && !error && <p className="muted">No saved workbooks.</p>}
      {books.map(b=><button disabled={busy} className="more-tool glass" key={b.id} onClick={()=>act(async()=>open(await read(await api(path+'/'+b.id))))}><FileSpreadsheet/><strong>{b.name}</strong></button>)}</>:
      <><div className="button-row"><button className="button ghost" disabled={busy} onClick={()=>act(async()=>{await commit();setDoc(null);setBooks(await api(path))})}><ArrowLeft/> Library</button>
      <button className="button ghost" disabled={busy} onClick={()=>act(async()=>{await commit();setModal('export')})}><Download/> Export</button><button className="icon-button" aria-label="Delete workbook" disabled={busy} onClick={()=>setModal('delete')}><Trash2/></button></div>
      <div><h2>{doc.name}</h2><small role="status">{busy?'Working…':dirty?'Unsaved cell edit':'Saved in your Personal workspace'}</small></div>
      {doc.report.issues.size>0 && <button className="button ghost" onClick={()=>{setFormulaLimit(30);setModal('issues')}}>Review formulas ({doc.report.issues.size})</button>}
      <div className="workbook-paper"><form className="workbook-bar" onSubmit={e=>{e.preventDefault();void act(commit)}}><label htmlFor="wb-value">{address} · ƒx</label><input id="wb-value" disabled={busy} value={raw} onChange={e=>setRaw(e.target.value)} aria-label="Cell value or formula"/><button className="button primary" disabled={busy||!dirty}>Save</button></form>
      <div onClick={selectCell} onKeyDown={event=>{if(event.key==='Enter')selectCell(event)}}>
        <WorkbookGrid key={doc.id+':'+sheet.id} sheet={sheet} address={address} issues={doc.report.issues}/>
      </div>
      <div className="workbook-tabs">{doc.wb.worksheets.map((s,i)=><button className="button ghost" aria-pressed={tab===i} disabled={busy} key={s.id} onClick={()=>act(async()=>{await commit();setTab(i);choose(s.getCell('A1'))})}>{s.name}</button>)}</div></div>
      {dirty&&error&&<button className="button ghost" onClick={()=>{choose(cell);setError('')}}>Discard cell edit</button>}</>}
    {!modal&&message}
    <input type="file" ref={file} hidden accept=".xlsx" onChange={e=>{const f=e.target.files[0];e.target.value='';if(f)void act(async()=>{if(f.size>fileLimit)throw Error('Choose a workbook up to 2 MB.');await prepare(await f.arrayBuffer(),f.name)})}}/>
    <Modal open={!!modal} title={{import:'Import workbook',review:'Review workbook',issues:'Formula compatibility',export:'Export a copy',delete:'Delete workbook'}[modal]} onClose={()=>{if(!busy){setModal('');setReview(null)}}}>
    <div className="stack gap-16">{modal==='import'&&<><div className="button-row"><button className="button primary" disabled={busy} onClick={google}>Choose a Google Sheet</button><InfoButton label="About workbook copies" onClick={()=>setCopyHelp(true)}/></div><button className="button ghost" disabled={busy} onClick={()=>file.current.click()}>Choose an Excel file (.xlsx)</button>{pickerOpen&&<><p role="status">Choose a sheet in Google, then return to Budgetly.</p><button className="button ghost" onClick={()=>picker.current?.abort()}>Cancel Google import</button></>}</>}
    {modal==='review'&&review&&<>
      <div className="button-row"><h3>{review.name}</h3><InfoButton label="About workbook copies" onClick={()=>setCopyHelp(true)}/></div>
      <p>{review.wb.worksheets.length} {review.wb.worksheets.length===1?'sheet':'sheets'}{report.issues.size>0 && ` · ${report.issues.size} ${report.issues.size===1?'formula needs':'formulas need'} review`}</p>
      {!!review.omittedFeatures.length&&<p role="status">Leaves out {new Intl.ListFormat('en').format(review.omittedFeatures)}.</p>}
      {!!report.issues.size&&<button type="button" className="button ghost" aria-expanded={formulasVisible} onClick={()=>setFormulasVisible(value=>!value)}>Review formulas</button>}
    </>}
    {(modal==='issues'||modal==='review'&&formulasVisible)&&!!report?.issues.size&&<div className="stack gap-12">
      <p>Check these formulas before relying on totals. Imported values may be shown.</p>
      {Array.from(report.issues).slice(0,formulaLimit).map(([c,reason])=><p key={c.worksheet.id+':'+c.address}><strong>{c.worksheet.name} · {c.address}</strong> {reason}</p>)}
      {report.issues.size>formulaLimit&&<button type="button" className="button ghost" onClick={()=>setFormulaLimit(limit=>limit+30)}>Show more formulas</button>}
    </div>}
    {modal==='review'&&review&&<button className="button primary" disabled={busy} onClick={()=>act(async()=>open(await persist(review)))}>Import copy</button>}
    {modal==='export'&&<><label className="field">Format<select value={type} onChange={e=>setType(e.target.value)}>{Object.entries(exportFormats).map(([k,label])=><option key={k} value={k}>{label}</option>)}</select></label><button className="button primary" disabled={busy} onClick={()=>act(async()=>{const {exportBook}=await import('../lib/workbookExport');await exportBook(type,doc.wb,sheet,doc.name);setModal('')})}>Export file</button></>}
    {modal==='delete'&&<><p>Delete “{doc.name}” from your Budgetly account?</p><button className="button danger" disabled={busy} onClick={()=>act(async()=>{await api(path+'/'+doc.id+'?revision='+doc.revision,{method:'DELETE'});setBooks(list=>list.filter(b=>b.id!==doc.id));setDoc(null);setModal('')})}>Delete workbook</button></>}
    {message}</div></Modal>
    <Modal open={copyHelp} title="Workbook copies" size="small" onClose={()=>setCopyHelp(false)}>
      <p>Budgetly imports a copy into your Personal workspace and saves future edits there. Your original Google Sheet or Excel file stays in place.</p>
    </Modal>
  </section>
}
