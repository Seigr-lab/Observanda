import {researchId} from './research-reference.js';

// One file-backed draft per editing session. The first edit starts the maximum
// wait even when more input keeps arriving. Acknowledgements belong to their
// original snapshot; later keystrokes remain visibly unacknowledged.
export const recoveryIdleMs=650,recoveryMaxWaitMs=2000;
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
function acknowledged(row,expected){
 if(!researchId(expected.workspaceId)||row?.surface!=='website'||row.state!=='ready'||row.capabilities?.recover!==true||row.owner?.workspaceId!==expected.workspaceId||row.owner?.websiteId!==expected.siteId)return false;
 if(row.id!==expected.id||row.documentKey!==expected.path||row.operationId!==expected.operationId||row.baseRevision!==expected.baseRevision||!digest(row.revision))return false;
 const time=Date.parse(row.updatedAt);
 if(!Number.isFinite(time)||new Date(time).toISOString()!==row.updatedAt)return false;
 const distinct=(values,valid)=>Array.isArray(values)&&values.every(valid)&&new Set(values).size===values.length;
 const media=(name,prefix,extensions)=>{
  if(typeof name!=='string'||!name.startsWith(prefix))return false;
  const [id,extension,...tail]=name.slice(prefix.length).split('.');return !tail.length&&researchId(id)&&extensions.includes(extension);
 };
 return distinct(row.pictures,name=>media(name,'pictures/',['png']))&&distinct(row.recordings,name=>media(name,'recordings/',['wav','mp4','vtt']))&&distinct(row.inputs,researchId)&&row.inputs.length===expected.inputs.length&&expected.inputs.every(id=>row.inputs.includes(id));
}
export function websiteFilesRecovery({request,documentState,upload,restore,tr,esc,signal,now=()=>performance.now()}){
 let owner=null,offers=[],next=null,current=null,held=new Set(),heldInputs=new Set(),restored=new Set(),serial=0;
 let first=null,timer=null,flight=null,retry=null,epoch=0,ackSerial=-1,error='',focusId=null;
 const pin=row=>({siteId:row.owner.websiteId,path:row.documentKey,id:row.id,revision:row.revision});
 const ok=job=>job===epoch&&!signal()?.aborted;
 function reset(){
  clearTimeout(timer);epoch++;timer=null;first=null;flight=retry=current=owner=null;held=new Set();heldInputs=new Set();restored=new Set();offers=[];next=null;error='';focusId=null;ackSerial=-1;serial=0;
 }
 function paint(){
  const node=document.querySelector('[data-website-recovery]');if(!node)return;
  const status=error||(current&&serial===ackSerial?tr('recoveryAcknowledged',{time:new Date(current.updatedAt).toLocaleTimeString()}):'');
  node.innerHTML=(status?'<p role="status" title="'+esc(tr('recoveryWindow'))+'">'+esc(status)+'</p>':'')+(error&&owner?'<button type="button" class="button" data-action="website-files-recovery-retry">'+esc(tr('recoveryRetry'))+'</button>':'')+offers.map(row=>{
   const info=tr('recoveryFound',{time:new Date(row.updatedAt).toLocaleString(),revision:row.baseRevision.slice(0,12)});
   const control=(action,label)=>'<button type="button" class="button" data-action="website-files-recovery-'+action+'" data-recovery-id="'+esc(row.id)+'">'+esc(tr(label))+'</button>';
   return '<section data-draft-id="'+esc(row.id)+'" tabindex="-1"><strong>'+esc(info)+'</strong> '+(row.capabilities.recover?control('restore','recoveryRestore'):'')+
    (row.capabilities.compare?control('compare','recoveryCompare'):'')+control('discard','recoveryDiscard')+
    (row.capabilities.recover?'':'<p>'+esc(tr(row.state==='conflict'?'recoveryConflict':'recoveryUnavailable'))+'</p>')+'</section>';
  }).join('')+(next?'<button type="button" class="button" data-action="website-files-recovery-more">'+esc(tr('more'))+'</button>':'');
  if(focusId){const row=node.querySelector('[data-draft-id="'+CSS.escape(focusId)+'"]');if(row){row.focus();focusId=null;}}
 }
 async function select(siteId,path,focus=null){
  if(owner?.siteId!==siteId||owner?.path!==path){reset();owner={siteId,path,id:crypto.randomUUID()};}
  const job=epoch;focusId=focus;
  try{const page=await request('recovery/page',{siteId,path,limit:8},{signal:signal()});if(!ok(job))return;
   offers=page.items.filter(row=>row.id!==current?.id);next=page.next;
   while(focus&&!offers.some(row=>row.id===focus)&&next&&ok(job))await more();
  }catch(reason){if(ok(job))error=reason.message||tr('recoveryFailed');}
  if(ok(job))paint();
 }
 async function more(){
  if(!next||!owner)return;const job=epoch,page=await request('recovery/page',{...owner,limit:8,cursor:next},{signal:signal()});
  if(ok(job)){offers.push(...page.items.filter(row=>row.id!==current?.id));next=page.next;paint();}
 }
 function schedule(){
  if(!owner)return;
  first??=now();if(flight)return;
  clearTimeout(timer);timer=setTimeout(()=>void persist(),Math.max(0,Math.min(recoveryIdleMs,recoveryMaxWaitMs-(now()-first))));
 }
 function edited(){
  if(!owner)return;
  const hadStatus=Boolean(error)||current&&ackSerial===serial;
  serial++;error='';if(hadStatus)paint();schedule();
 }
 async function persist(){
  clearTimeout(timer);timer=null;if(flight||!owner)return;
  const job=epoch;
  const value=documentState();
  if(!value||value.siteId!==owner.siteId||value.path!==owner.path)return;
  if(!retry){
   const {siteId,path,id}=owner,data={siteId,path,id,baseRevision:value.baseRevision,historyKey:value.historyKey,html:value.html,css:value.css,sourceKind:value.sourceKind,recordingForm:value.recording?.form,bookmark:value.bookmark,
    expectedDraftRevision:current?.revision??null,operationId:crypto.randomUUID()};
   const inputs=Object.keys(value.recording?.blobs??{}).filter(slot=>!heldInputs.has(data.recordingForm.files[slot].id));
   if(inputs.length){
    const metadata=new TextEncoder().encode(JSON.stringify({...data,uploadSlots:inputs})),header=new DataView(new ArrayBuffer(4));header.setUint32(0,metadata.length);
    retry={operation:'save-inputs',body:new Blob([header,metadata,...inputs.map(slot=>value.recording.blobs[slot])]),serial};
   }else{
    const body=upload(data,held);retry={operation:body?'save-pictures':'save',body:body??data,serial};
   }
   retry.expected={workspaceId:value.workspaceId,siteId,path,id,baseRevision:data.baseRevision,operationId:data.operationId,inputs:Object.values(data.recordingForm?.files??{}).map(file=>file.id)};
  }
  const task=retry,attemptSerial=serial;first=null;let confirmed=false;
  flight=(async()=>{
   try{
    const row=await request('recovery/'+task.operation,task.body,{signal:signal()});if(!ok(job))return;
    if(!acknowledged(row,task.expected))throw Error(tr('recoveryFailed'));
    current=row;held=new Set([...(row.pictures??[]),...(row.recordings??[])]);heldInputs=new Set(row.inputs);ackSerial=task.serial;retry=null;error='';confirmed=true;
   }catch(reason){
    if(!ok(job))return;
    error=tr('recoveryFailed');
    // An explicit service refusal has no ambiguous receipt. Retry the latest
    // edit when the user changes it. A lost transport response reuses its ID.
    if(reason.code)retry=null;
   }finally{
    if(ok(job)){flight=null;paint();if(serial>(confirmed?task.serial:attemptSerial))schedule();}
   }
  })();await flight;
 }
 function restoreURL(name,base){
  if(!current||!restored.has(name)||!held.has(name))return null;
  const url=new URL('_recovery/'+current.id+'/'+current.revision+'/'+name,base);url.searchParams.set('page',owner.path);return url.href;
 }
 async function settled(){clearTimeout(timer);timer=null;if(flight)await flight;}
 async function forget({saved=false}={}){
  const job=epoch;await settled();if(!ok(job))return;
  const previous=current;let cleanup='';
  if(previous)try{await request('recovery/discard',pin(previous),{signal:signal()});}catch(reason){
   if(!saved)throw reason;
   cleanup=tr('recoveryCleanupPending');
  }
  if(!ok(job))return;
  current=retry=null;held.clear();heldInputs.clear();restored.clear();ackSerial=-1;error=cleanup;if(owner)owner.id=crypto.randomUUID();paint();
 }
 function compare(value){
  const dialog=document.createElement('dialog');dialog.className='website-author-dialog website-recovery-dialog';
  dialog.setAttribute('aria-label',tr('recoveryCompare'));
  dialog.innerHTML='<h2>'+esc(tr('recoveryCompare'))+'</h2><select aria-label="'+esc(tr('recoveryDocument'))+'"><option>HTML</option><option>CSS</option></select> <button type="button" data-prev></button> <output></output> <button type="button" data-next></button><div class="website-recovery-compare"></div><button type="button" data-close>'+esc(tr('recoveryClose'))+'</button>';
  const toolbar=dialog.querySelector('select'),body=dialog.querySelector('.website-recovery-compare'),status=dialog.querySelector('output'),prev=dialog.querySelector('[data-prev]'),next=dialog.querySelector('[data-next]');
  prev.textContent=tr('prevPage');next.textContent=tr('nextPage');
  if(value.recordingForm){toolbar.add(new Option(tr('recordings'),'recording'));toolbar.value='recording';}
  let sides,offset=0;const size=4096;
  function display(){
   body.replaceChildren();
   for(const [i,text] of sides.entries()){
    const section=document.createElement('section'),heading=document.createElement('h3'),code=document.createElement('pre');heading.textContent=tr(i?'recoveryDraft':'recoverySaved');code.textContent=text.slice(offset,offset+size);section.append(heading,code);body.append(section);
   }
   const count=Math.max(1,Math.ceil(Math.max(...sides.map(s=>s.length))/size));
   status.textContent=(offset/size+1)+' / '+count;prev.disabled=offset===0;next.disabled=offset/size+1===count;
  }
  function select(){
   const kind=toolbar.value.toLowerCase();offset=0;
   if(kind==='recording'){
    const form=value.recordingForm;sides=['',[form.fields.title,form.fields.transcript,form.fields.trackLabel,form.fields.language,...Object.values(form.files).map(f=>f.name)].filter(Boolean).join('\n')];
   }else{
    sides=[value.saved[kind],value[kind]];
    if(sides[0]!==sides[1]){
     const sharedLength=Math.min(sides[0].length,sides[1].length);let start=0;
     while(start<sharedLength&&sides[0].charCodeAt(start)===sides[1].charCodeAt(start))start++;
     offset=Math.floor(Math.min(start,Math.max(sides[0].length,sides[1].length)-1)/size)*size;
    }
   }
   display();
  }
  toolbar.onchange=select;prev.onclick=()=>{offset-=size;display();};next.onclick=()=>{offset+=size;display();};
  dialog.querySelector('[data-close]').onclick=()=>dialog.close();dialog.onclose=()=>dialog.remove();
  select();document.body.append(dialog);dialog.showModal();
 }
 async function action(operation,id){
  if(operation==='more'){await more();return;}
  if(operation==='retry'){if(documentState())await persist();else if(owner)await select(owner.siteId,owner.path);return;}
  const row=offers.find(value=>value.id===id);if(!row)return;
  const job=epoch;
  if(operation==='discard'){
   if(!confirm(tr('recoveryDiscardConfirm')))return;
   await request('recovery/discard',pin(row),{signal:signal()});
  }else{
   const comparing=operation==='compare';
   if(!comparing&&documentState()&&!confirm(tr('recoveryReplace')))return;
   const value=await request('recovery/'+(comparing?'compare':'read'),pin(row),{signal:signal()});
   if(!ok(job))return;
   if(typeof value.html!=='string'){offers=offers.map(item=>item.id===row.id?value.summary:item);paint();return;}
   if(comparing){
    compare(value);return;
   }
   await settled();if(!ok(job))return;
   if(current&&current.id!==row.id)offers=[current,...offers];
   owner.id=row.id;current=row;held=new Set([...value.pictures.map(p=>p.name),...value.recordings]);restored=new Set(held);retry=null;
   heldInputs=new Set(Object.values(value.recordingForm?.files??{}).map(file=>file.id));await restore(value);
   ackSerial=serial;clearTimeout(timer);timer=null;first=null;
  }
  if(ok(job)){offers=offers.filter(item=>item.id!==row.id);paint();}
 }
 return {select,reset,paint,edited,settled,forget,action,restoreURL,
  currentRef:()=>current?{id:current.id,revision:current.revision}:undefined,
  ref:()=>current&&restored.size?{id:current.id,revision:current.revision}:undefined,
  held:name=>restored.has(name)&&held.has(name)};
}
