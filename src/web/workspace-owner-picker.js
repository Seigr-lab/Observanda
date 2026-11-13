import './i18n/catalogues/workspaceReach.js';
import {t} from './i18n/index.js';
import {researchId} from './research-reference.js';
import {revisionId} from './revision-model.js';
import {researchOwner,researchContext} from './project-context.js';
const tr=(key,values)=>t('workspaceReach',key,values);
const LOCKED=['ACCESS_LOCKED','ACCESS_DENIED','AUTH','DEVICE_UNKNOWN'];
const invalid=()=>{throw Error(tr('invalid'));};
const nullableId=value=>value===null||researchId(value);

// The workspace route that serves the selected research owner. Another
// project or lab book is only ever addressed by the namespace it is read from.
export function workspaceOwnerRoute(name,owner){
 const projectId=typeof owner==='object'&&owner!==null?owner.projectId:owner,labBookId=typeof owner==='object'&&owner!==null?owner.labBookId:null;
 if(!projectId)return '/api/projects/'+name;
 if(!researchId(projectId)||labBookId&&!researchId(labBookId))throw new TypeError('Invalid research owner');
 return '/api/projects/'+projectId+(labBookId?'/lab-books/'+labBookId:'')+'/'+name;
}

// workspace() names the requesting host: a research owner's namespace, or null
// for the workspace's own editors, which the server resolves to its namespace.
export const researchWorkspace=state=>()=>({workspaceId:state.book?.id??null,owner:researchOwner(state)});
export function workspaceOwnerClient({state,api,workspace=researchWorkspace(state)}){
 async function request(name,body,{signal}={}){
  const {workspaceId,owner}=workspace();
  const result=await api(workspaceOwnerRoute(name,owner),{...body,workspaceId},{adopt:false,owner,signal});
  if(!researchId(result?.workspaceId)||workspaceId!==null&&result.workspaceId!==workspaceId)invalid();return result;
 }
 async function owners({projectId=null,search='',offset=0,limit=25,revision=null}={},options={}){
  const result=await request('workspace-owners',{projectId,search,offset,limit,revision},options);
  if(result.projectId!==projectId||typeof result.revision!=='string'||result.offset!==offset||!Number.isSafeInteger(result.total)||!Array.isArray(result.items)||result.items.length>limit||result.items.some(item=>!researchId(item?.workspaceId)||!nullableId(item.projectId)||!nullableId(item.labBookId)||!['workspace','project','lab-book'].includes(item.kind)||!['open','locked'].includes(item.access)||typeof item.label!=='string'||!Array.isArray(item.ancestors)))invalid();
  return result;
 }
 async function records({sourceId,search='',offset=0,limit=20},options={}){
  const result=await request('workspace-owner-records',{sourceId,search,offset,limit},options);
  if(result.sourceId!==sourceId||result.owner?.workspaceId!==sourceId||!nullableId(result.owner.projectId)||!nullableId(result.owner.labBookId)||result.offset!==offset||!Number.isSafeInteger(result.total)||!Array.isArray(result.items)||result.items.length>limit||result.items.some(item=>!researchId(item?.id)||!revisionId(item.revision)||typeof item.title!=='string'||!researchId(item.notebookId)||!researchId(item.projectId)||!Array.isArray(item.attachments)||item.attachments.some(a=>!researchId(a?.id)||typeof a.name!=='string')))invalid();
  return result;
 }
 return {owners,records};
}

// A separate dialog keeps the caller's form intact while the access owner
// presents its unlock dialog above this one. A locked owner is listed with an
// unlock action and is never read until its own grant opens it.
export function workspaceOwnerPicker({state,api,esc,field,access=operation=>operation(),workspace=researchWorkspace(state),client=workspaceOwnerClient({state,api,workspace})}){
 let session=null,timer=null;
 const limit=20;
 const valid=s=>session===s&&s.dialog.open&&s.context===researchContext(state)&&s.workspaceId===workspace().workspaceId&&!state.access?.locked;
 const button=(label,command,attrs='')=>'<button type="button" class="button" data-owner-command="'+command+'" '+attrs+'>'+esc(label)+'</button>';
 function stop(){clearTimeout(timer);if(!session)return;const s=session;session=null;s.request?.abort();s.dialog.remove();s.origin?.isConnected&&s.origin.focus({preventScroll:true});s.onClose?.();}
 const name=item=>[...item.ancestors,item.label].join(' / ');
 function ownerRow(item,index){
  const disabled=session.busy?'disabled':'',label=name(item);
  if(item.current)return '<li data-owner-row="'+esc(item.workspaceId)+'"><p>'+esc(label)+' <small>'+esc(tr('current'))+'</small></p></li>';
  const actions=item.access==='locked'?'<p data-owner-locked>'+esc(tr('lockedHelp',{name:label}))+'</p>'+button(tr('unlock',{name:item.label}),'unlock','data-index="'+index+'" '+disabled):button(tr('openOwner',{name:item.label}),'owner','data-index="'+index+'" '+disabled);
  const books=item.kind==='project'&&session.projectId===null?button(tr('labBooks',{name:item.label}),'books','data-index="'+index+'" '+disabled):'';
  return '<li data-owner-row="'+esc(item.workspaceId)+'" data-owner-access="'+esc(item.access)+'"><p>'+esc(label)+(item.access==='locked'?' <strong>'+esc(tr('locked'))+'</strong>':'')+'</p><div class="inline-actions">'+actions+books+'</div></li>';
 }
 function paint(){
  const s=session;if(!s||!valid(s))return;
  const content=s.dialog.querySelector('[data-owner-content]'),page=s.page;content.setAttribute('aria-busy',String(s.busy));
  const error=s.error?'<p role="alert">'+esc(s.error.message??tr('failed'))+'</p>'+button(tr(LOCKED.includes(s.error.code)?'unlockRetry':'retry'),'retry',s.busy?'disabled':''):'';
  const rows=s.mode==='owners'?(page?.items??[]).map(ownerRow).join(''):(page?.items??[]).map((item,index)=>'<li data-owner-record="'+esc(item.id)+'"><p><span>'+esc(item.title)+'</span> <small>'+esc(item.notebook)+'</small></p>'+s.row(item,index,s.source)+'</li>').join('');
  const status=s.busy?tr('loading'):page?.items.length?tr('range',{first:page.offset+1,last:page.offset+page.items.length,total:page.total}):tr(s.mode==='owners'?'emptyOwners':'emptyRecords');
  content.innerHTML=error+'<p role="status" data-owner-status>'+esc(status)+'</p><ul class="research-link-targets">'+rows+'</ul><nav class="inline-actions" aria-label="'+esc(tr('pages'))+'">'+button(tr('previous'),'previous',s.busy||!page||page.offset===0?'disabled':'')+button(tr('next'),'next',s.busy||!page||page.offset+page.items.length>=page.total?'disabled':'')+'</nav>';
  s.dialog.querySelector('[data-owner-location]').innerHTML=s.mode==='owners'?(s.projectId?button(tr('allLocations'),'all'):''):'<span data-owner-selected>'+esc(s.sourceLabel)+'</span> '+button(tr('allLocations'),'all');
  s.dialog.querySelector('[data-owner-search]').setAttribute('aria-label',tr(s.mode==='owners'?'findLocation':'search'));
 }
 async function load(offset=0,{unlock=false}={}){
  const s=session;if(!s||!valid(s))return;s.request?.abort();const request=s.request=new AbortController();s.busy=true;s.error=null;s.attempt=offset;paint();
  try{
   const read=()=>s.mode==='owners'?client.owners({projectId:s.projectId,search:s.query,offset,limit,revision:offset?s.page?.revision??null:null},{signal:request.signal}):client.records({sourceId:s.sourceId,search:s.query,offset,limit},{signal:request.signal});
   const result=await(unlock?access(read):read());
   if(s.mode==='records'&&s.loaded&&valid(s)&&s.request===request)await s.loaded(result,{signal:request.signal});
   if(valid(s)&&s.request===request){s.page=result;if(s.mode==='records')s.source=result;}
  }catch(error){
   // A cancelled unlock prompt leaves the owner locked and unread.
   if(valid(s)&&s.request===request&&!request.signal.aborted)s.error=error?.name==='AbortError'?{code:'ACCESS_LOCKED',message:tr('lockedHelp',{name:s.mode==='records'?s.sourceLabel:''})}:error;
  }
  finally{if(valid(s)&&s.request===request){s.busy=false;paint();}}
 }
 function reset(s,mode){s.mode=mode;s.query='';s.page=null;s.error=null;s.dialog.querySelector('[data-owner-search]').value='';}
 async function command(node){
  const s=session;if(!s||!valid(s))return;const name=node.dataset.ownerCommand;clearTimeout(timer);
  if(name==='close'){stop();return;}
  if(name==='all'){reset(s,'owners');s.projectId=null;await load();return;}
  if(name==='retry'){await load(s.attempt??0,{unlock:LOCKED.includes(s.error?.code)});return;}
  if(s.busy)return;
  const item=s.mode==='owners'?s.page?.items[Number(node.dataset.index)]:null;
  if(name==='books'&&item){reset(s,'owners');s.projectId=item.projectId;await load(0,{unlock:true});return;}
  if((name==='owner'||name==='unlock')&&item){reset(s,'records');s.sourceId=item.workspaceId;s.sourceLabel=[...item.ancestors,item.label].join(' / ');await load(0,{unlock:true});return;}
  if(name==='previous'||name==='next'){await load(Math.max(0,(s.page?.offset??0)+(name==='next'?limit:-limit)));return;}
  if(s.mode==='records'){
   const id=node.closest('[data-owner-record]')?.dataset.ownerRecord,record=s.page?.items.find(item=>item.id===id);if(!record)return;
   s.busy=true;s.error=null;paint();
   try{const done=await s.act(node,record,s.source);if(done){stop();return;}}
   catch(error){if(valid(s)&&error?.name!=='AbortError')s.error=error;}
   finally{if(valid(s)){s.busy=false;paint();}}
  }
 }
 // row(record,index,source) renders the record's controls; act(node,record,source)
 // applies one of them and returns true when the picker is finished. loaded(page)
 // lets the caller read its own saved choices for exactly the listed records.
 function open({title,help='',row,act,loaded=null,onClose}){
  stop();
  const dialog=document.createElement('dialog');dialog.dataset.workspaceOwnerPicker='';dialog.setAttribute('aria-labelledby','workspace-owner-title');
  session={dialog,origin:document.activeElement,context:researchContext(state),workspaceId:workspace().workspaceId,mode:'owners',projectId:null,sourceId:null,sourceLabel:'',source:null,query:'',page:null,error:null,busy:false,request:null,row,act,loaded,onClose};
  dialog.innerHTML='<h2 id="workspace-owner-title">'+esc(title)+'</h2>'+(help?'<p>'+esc(help)+'</p>':'')+'<p data-owner-location></p>'+field(esc(tr('search')),'<input type="search" data-owner-search maxlength="160">')+'<div data-owner-content></div><div class="dialog-actions">'+button(tr('close'),'close')+'</div>';
  dialog.addEventListener('click',event=>{const node=event.target.closest('[data-owner-command]');if(node&&dialog.contains(node)&&node.tagName!=='INPUT'){event.preventDefault();event.stopPropagation();void command(node);}});
  dialog.addEventListener('change',event=>{const node=event.target.closest('[data-owner-command]');if(node&&dialog.contains(node)&&node.tagName==='INPUT'){event.stopPropagation();void command(node);}});
  dialog.addEventListener('input',event=>{if(!event.target.hasAttribute('data-owner-search'))return;event.stopPropagation();const s=session;if(!s)return;clearTimeout(timer);s.request?.abort();s.query=event.target.value;s.page=null;s.busy=true;paint();timer=setTimeout(()=>{if(valid(s))void load();},180);});
  dialog.addEventListener('close',()=>{if(session?.dialog===dialog)stop();});
  document.body.append(dialog);dialog.showModal();void load();dialog.querySelector('[data-owner-search]').focus();
 }
 return {open,stop,repaint:paint,sync(){if(session&&!valid(session))stop();},get busy(){return !!session?.busy;}};
}
