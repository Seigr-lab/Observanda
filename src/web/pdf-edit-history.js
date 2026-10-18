// Saved document undo stores immutable revision identities, never document bodies.
export function pdfEditHistory({getDocument,flush,restore,reopen,changed=()=>{},uuid=()=>crypto.randomUUID(),limit=50}){
 if(!Number.isInteger(limit)||limit<1||limit>100)throw new RangeError('Invalid history limit');
 let id=null,current=null,undo=[],redo=[],pending=null,busy=false,epoch=0;
 const push=(rows,value)=>{rows.push(value);if(rows.length>limit)rows.shift();};
 function observe(value){
  const nextId=value?.header.id??null,nextRevision=value?.revision??null;
  if(nextId!==id||nextRevision!==current){id=nextId;current=nextRevision;undo=[];redo=[];pending=null;epoch++;}
  changed();
 }
 function record(command,result){
  if(command.id!==id||!result?.revision)return;
  const before=command.expectedRevision,after=result.revision;
  if(after===current)return; // Exact response replay, including a no-op change.
  if(before!==current){observe({header:{id},revision:after});return;}
  push(undo,before);current=after;redo=[];pending=null;changed();
 }
 function state(){return {undo:undo.length,redo:redo.length,busy,canUndo:!!id&&(pending?pending.direction==='undo':undo.length>0),canRedo:!!id&&(pending?pending.direction==='redo':redo.length>0)};}
 async function run(direction){
  if(!['undo','redo'].includes(direction))throw new TypeError('Invalid history direction');
  if(busy||!id||pending&&pending.direction!==direction)return false;
  const token=epoch;busy=true;changed();
  try{
   // A failed reload retries the already committed revision without another undo.
   if(!pending?.revision){
    await flush();if(token!==epoch)return false;const selected=getDocument();
    if(!selected||selected.header.id!==id||selected.revision!==current)return false;
    if(!pending){const rows=direction==='undo'?undo:redo;if(!rows.length)return false;pending={direction,before:current,command:{id,commandId:uuid(),expectedRevision:current,operation:{type:'restore',revision:rows.at(-1)}},revision:null};}
    const task=pending,result=await restore(task.command);
    if(token!==epoch||pending!==task)return false;
    if(!result?.revision)throw new Error('Invalid restored revision');
    const rows=direction==='undo'?undo:redo,inverse=direction==='undo'?redo:undo;
    rows.pop();push(inverse,pending.before);current=result.revision;pending.revision=result.revision;
   }
   await reopen({id,revision:pending.revision});if(token!==epoch)return false;pending=null;changed();return true;
  }finally{busy=false;changed();}
 }
 return {observe,record,state,run,clear(){observe(null);}};
}

export function pdfEditHistoryShortcut(event){
 if(event.defaultPrevented||event.isComposing||event.repeat||event.altKey||!(event.ctrlKey||event.metaKey))return null;
 const path=event.composedPath?.()??[event.target];
 if(path.some(node=>node?.isContentEditable||node?.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]')))return null;
 const key=event.key.toLowerCase();return key==='z'?(event.shiftKey?'redo':'undo'):key==='y'&&!event.shiftKey?'redo':null;
}
