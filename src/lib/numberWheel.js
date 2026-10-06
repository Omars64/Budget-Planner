export function installNumberWheelGuard(root=document){
  const guard=event=>{
    const input=event.target?.closest?.('input[type="number"]')
    if(input && root.activeElement===input)input.blur()
  }
  root.addEventListener('wheel',guard,{capture:true,passive:true})
  return ()=>root.removeEventListener('wheel',guard,true)
}
