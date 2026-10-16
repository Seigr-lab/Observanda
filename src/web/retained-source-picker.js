import {t} from './i18n/index.js';
const tr=(key,values)=>t('retainedSources',key,values);
const locked=error=>['ACCESS_LOCKED','ACCESS_DENIED','DEVICE_UNKNOWN'].includes(error?.code);

// A separate dialog keeps the source form and selected location intact while
// the access owner presents its own unlock dialog above this one.
export function retainedSourcePicker({state,client,esc,field,current}){
 let session=null,timer=null;
 const valid=s=>session===s&&s.dialog.open&&current()===s.draft&&s.context===state.storage?.contextId&&s.workspaceId===state.book?.id;
 function stop(){clearTimeout(timer);if(!session)return;const s=session;session=null;s.request?.abort();s.dialog.remove();s.origin?.isConnected&&s.origin.focus({preventScroll:true});s.resolve();}
 function button(label,command,attrs=''){return '<button type="button" class="button" data-reference-command="'+command+'" '+attrs+'>'+esc(label)+'</button>';}
 function paint(){
  const s=session;if(!s||!valid(s))return;
  const content=s.dialog.querySelector('[data-reference-content]');
  const page=s.page;
  content.setAttribute('aria-busy',String(s.busy));
  const error=s.error?'<p role="alert">'+esc(s.error.message==='RETAINED_SOURCE_RESPONSE'?tr('invalid'):s.error.message??tr('failed'))+'</p>'+button(tr(locked(s.error)?'unlock':'retry'),'retry',s.busy?'disabled':''):'';
  let rows='';
  if(s.mode==='owners')rows=(page?.items??[]).map((item,index)=>'<li><p>'+esc([...item.ancestors,item.label].join(' / '))+'</p><div class="inline-actions">'+button(tr('chooseLocation',{name:item.label}),'owner','data-index="'+index+'" '+(s.busy?'disabled':''))+(item.kind==='project'&&s.projectId===null?button(tr('labBooks'),'books','data-index="'+index+'" '+(s.busy?'disabled':'')):'')+'</div></li>').join('');
  else rows=(page?.items??[]).map((item,index)=>'<li>'+button(item.title,'choose','data-index="'+index+'" '+(s.busy?'disabled':''))+'<small>'+esc(tr('revision',{revision:item.reference.revision.slice(0,12)}))+'</small></li>').join('');
  const previous=s.mode==='owners'?page&&page.offset>0:s.trail.length>0,next=s.mode==='owners'?page&&page.offset+page.items.length<page.total:page?.next;
  content.innerHTML=error+(page?.changed?'<p>'+esc(tr('changed'))+'</p>'+button(tr('first'),'first'):'')+'<p role="status">'+esc(s.busy?tr('loading'):page?.items.length?tr('range',{count:page.items.length}):tr('empty'))+'</p><ul class="research-link-targets">'+rows+'</ul><nav class="inline-actions" aria-label="'+esc(tr('pages'))+'">'+button(tr('previous'),'previous',s.busy||!previous?'disabled':'')+button(tr('next'),'next',s.busy||!next||s.mode==='items'&&s.trail.length>=32?'disabled':'')+'</nav>';
  s.dialog.querySelector('[data-reference-location]').innerHTML=s.mode==='owners'?(s.projectId?button(tr('allLocations'),'all'):''):esc(s.ownerLabel)+' '+button(tr('changeLocation'),'locations');
  s.dialog.querySelector('[data-reference-kind-field]').hidden=s.mode==='owners'||s.fixedKind;
  const search=s.dialog.querySelector('[data-reference-search]');search.setAttribute('aria-label',tr(s.mode==='owners'?'findLocation':'search'));
 }
 async function load({cursor=null,offset=0,unlock=false}={}){
  const s=session;if(!s||!valid(s))return;s.request?.abort();const request=s.request=new AbortController();s.busy=true;s.error=null;s.attempt={cursor,offset};paint();
  try{
   const result=s.mode==='owners'?await client.owners({projectId:s.projectId,search:s.query,offset,limit:25,revision:offset?s.page?.revision:null},{signal:request.signal,unlock}):await client.items({sourceId:s.sourceId,kind:s.kind,query:s.query,cursor,limit:25},{signal:request.signal,unlock});
   if(valid(s)&&s.request===request)s.page=result;
  }catch(error){if(valid(s)&&s.request===request&&!request.signal.aborted)s.error=error.name==='AbortError'?{code:'ACCESS_LOCKED',message:tr('accessRequired')}:error;}
  finally{if(valid(s)&&s.request===request){s.busy=false;paint();}}
 }
 async function command(node){
  const s=session;if(!s||!valid(s))return;const command=node.dataset.referenceCommand;clearTimeout(timer);
  if(command==='cancel'){stop();return;}
  if(command==='locations'||command==='all'){
   s.mode='owners';s.projectId=null;s.query='';s.page=null;s.trail=[];s.cursor=null;s.dialog.querySelector('[data-reference-search]').value='';await load();return;
  }
  if(s.busy&&['books','owner','choose','previous','next'].includes(command))return;
  if(command==='books'){
   const item=s.page?.items[Number(node.dataset.index)];if(!item)return;s.mode='owners';s.projectId=item.projectId;s.query='';s.page=null;s.trail=[];s.cursor=null;s.dialog.querySelector('[data-reference-search]').value='';await load({unlock:true});return;
  }
  if(command==='owner'){
   const item=s.page?.items[Number(node.dataset.index)];if(!item)return;s.mode='items';s.sourceId=item.workspaceId;s.ownerLabel=[...item.ancestors,item.label].join(' / ');s.query='';s.page=null;s.trail=[];s.cursor=null;s.dialog.querySelector('[data-reference-search]').value='';await load({unlock:true});return;
  }
  if(command==='first'){s.trail=[];s.cursor=null;await load();return;}
  if(command==='retry'){await load({...s.attempt,unlock:locked(s.error)});return;}
  if(s.busy)return;
  if(command==='previous'||command==='next'){
   if(s.mode==='owners')await load({offset:Math.max(0,s.page.offset+(command==='next'?25:-25))});
   else{if(command==='next'){if(s.trail.length>=32)return;s.trail.push(s.cursor);s.cursor=s.page.next;}else s.cursor=s.trail.pop()??null;await load({cursor:s.cursor});}return;
  }
  if(command==='choose'){
   const item=s.page?.items[Number(node.dataset.index)];if(!item)return;
   s.request?.abort();const request=s.request=new AbortController();s.busy=true;s.error=null;paint();
   try{
    const resolved=await client.resolve(item.reference,{signal:request.signal,unlock:true});
    if(!valid(s)||s.request!==request)return;
    s.resolve({...resolved.reference,label:resolved.title.slice(0,300)});stop();
   }catch(error){if(valid(s)&&s.request===request&&!request.signal.aborted)s.error=error.name==='AbortError'?{code:'ACCESS_LOCKED',message:tr('accessRequired')}:error;}
   finally{if(valid(s)&&s.request===request){s.busy=false;paint();}}
  }
 }
 function open({title,kind=null,recordsOnly=false}){
  stop();const draft=current();if(!draft)return;
  const dialog=document.createElement('dialog');dialog.dataset.retainedSourcePicker='';dialog.setAttribute('aria-labelledby','retained-source-title');let resolve;const result=new Promise(done=>{resolve=done;});const fixedKind=recordsOnly?'record':kind;
  session={draft,dialog,origin:document.activeElement,context:state.storage?.contextId,workspaceId:state.book.id,sourceId:state.book.id,ownerLabel:state.book.title,resolve,trail:[],cursor:null,fixedKind:!!fixedKind,kind:fixedKind??'artifact',mode:'items',projectId:null,query:'',page:null,error:null,busy:false,request:null};
  dialog.innerHTML='<h2 id="retained-source-title">'+esc(title)+'</h2><p data-reference-location></p>'+field(esc(tr('search')),'<input type="search" data-reference-search maxlength="160" aria-label="'+esc(tr('search'))+'">')+'<div data-reference-kind-field>'+field(esc(tr('kind')),'<select data-reference-kind>'+['artifact','dataset','analysis','collection','record'].map(type=>'<option value="'+esc(type)+'">'+esc(tr(type))+'</option>').join('')+'</select>')+'</div><div data-reference-content></div><div class="dialog-actions">'+button(tr('cancel'),'cancel')+'</div>';
  dialog.querySelector('[data-reference-kind]').value=session.kind;
  dialog.addEventListener('click',event=>{const node=event.target.closest('[data-reference-command]');if(node){event.stopPropagation();void command(node);}});
  dialog.addEventListener('input',event=>{if(!event.target.hasAttribute('data-reference-search'))return;event.stopPropagation();const s=session;if(!s)return;clearTimeout(timer);s.request?.abort();s.query=event.target.value;s.page=null;s.trail=[];s.cursor=null;s.error=null;s.busy=true;paint();timer=setTimeout(()=>{if(valid(s))void load();},180);});
  dialog.addEventListener('change',event=>{if(!event.target.hasAttribute('data-reference-kind'))return;event.stopPropagation();session.kind=event.target.value;session.trail=[];session.cursor=null;session.page=null;void load();});
  dialog.addEventListener('close',()=>{if(session?.dialog===dialog)stop();});
  document.body.append(dialog);dialog.showModal();void load();return result;
 }
 return {open,stop,sync(){if(session&&!valid(session))stop();}};
}
