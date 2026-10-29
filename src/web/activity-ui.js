import {activityOwner,activityViewMatches,activityResource,activityCommand} from './activity-owner.js';
import {localizedText,onLanguageChange} from './i18n/index.js';
import {updateText,updateAttribute,updateProperty,placeAt} from './progress-dom.js';
import {operationProgress} from './operation-progress-ui.js';
import {storageProgressPresentation,storageSize} from './storage-progress-presentation.js';
const text=localizedText('activity'),messages=new Map(['activity','storageProgress','recordSaveProgress'].map(namespace=>[namespace,localizedText(namespace)]));
const optional=(namespace,key)=>{try{return messages.get(namespace)(key);}catch{return '';}};
const active=entry=>['running','queued'].includes(entry.state);
function title(kind,view){
 if(/^\/api\/projects\/[a-f0-9-]{36}\/lab-books\/import(?:\/(?:resume|cancel))?$/.test(kind))return text(kind.endsWith('/cancel')?'cancelBookImport':'importBook');
 if(/^\/api\/projects\/[a-f0-9-]{36}\/lab-books\/create(?:\/resume)?$/.test(kind))return text('createBook');
 if(activityResource(kind).startsWith('lab-book:')){const command=activityCommand(kind);if(['/api/storage/copy','/api/storage/export'].some(prefix=>command.startsWith(prefix)))return text(command.endsWith('/cancel')?'cancelBookTransfer':command.includes('/export')?'exportBook':'copyBook');if(command.startsWith('/api/storage/move'))return text('moveBook');if(command.startsWith('/api/storage/delete'))return text('deleteBook');if(command==='/api/storage/rename')return text('renameBook');if(command==='/api/settings/save')return text('bookSettings');if(command==='/api/access/password')return text('bookPassword');if(command==='/api/access/lock')return text('lockBook');if(command==='/api/access/unlock')return text('unlockBook');}
 if(kind.startsWith('/api/workspaces/delete/'))return optional('activity','delete');
 if(kind.startsWith('/api/projects/open'))return text(kind.endsWith('/cancel')?'cancelProjectImport':'openProject');
 if(activityResource(kind).startsWith('project:')&&activityCommand(kind).startsWith('/api/storage/'))return optional('storageProgress',kind.endsWith('/cancel')?'cancel-project-transfer':kind.includes('/export')?'export-project':kind.includes('/copy')?'copy-project':kind.includes('/delete')?'delete-project':'move-project');
 if(['/api/projects/create','/api/projects/create/resume'].includes(kind))return text('createProject');
 if(/^\/api\/projects\/[a-f0-9-]{36}\/directory\/reparent$/.test(kind))return text('projectPlacement');
 if(activityResource(kind).startsWith('project:')&&(activityCommand(kind).startsWith('/api/workspace/')||activityCommand(kind)==='/api/settings/save'))return text('projectStructure');
 kind=activityCommand(kind);
 if(kind.startsWith('/api/research/records/transfer/'))return text('location');
 if(kind.startsWith('job:'))return optional('activity',kind)||text('operation');
 if(kind.startsWith('/api/storage/')){
  const key=kind.endsWith('/preview')?'review':kind.includes('/database/')?'convert':kind.split('/')[3];
  return optional('activity',key)||text('storage');
 }
 if(kind.includes('/drafts/'))return text(view?.startsWith('#/modules/scientific-calculator')?'saveCalculationDraft':'saveDraft');
 if(kind.startsWith('/api/modules/'))return text('saveModule');
 if(kind.startsWith('/api/workspace/'))return text('structure');
 if(kind.startsWith('/api/sharing/'))return text('sharing');
 if(kind.includes('/drafts/review/'))return text('reviewRecords');
 if(kind.includes('/history/restore'))return text('restore');
 if(kind.endsWith('/pin'))return text('pin');
 return optional('activity',kind.split('/').at(-1))||text(kind.startsWith('/api/research/records/')?'record':'operation');
}
function stageName(kind,stage){
 if(activityResource(kind).startsWith('lab-book:')||activityCommand(kind).startsWith('/api/lab-books/import')){const label=optional('storageProgress','book-'+stage);if(label)return label;}
 if(activityResource(kind).startsWith('project:')||kind.startsWith('/api/projects/open')){const label=optional('storageProgress','project-'+stage);if(label)return label;}
 for(const namespace of ['storageProgress','recordSaveProgress','activity']){const label=optional(namespace,stage);if(label)return label;}
 // Job definitions also report human-readable domain stages.
 return kind.startsWith('job:')?stage:title(kind);
}
function presentation(kind,value){
 if(activityCommand(kind).startsWith('/api/storage/')||activityCommand(kind).startsWith('/api/lab-books/import')){const resource=activityResource(kind),book=resource.startsWith('lab-book:')||activityCommand(kind).startsWith('/api/lab-books/import'),project=!book&&resource.startsWith('project:');return storageProgressPresentation((project||book)&&value.transfer?.phase!=='copying'?{...value,transfer:undefined}:value,{project,book});}
 const total=value.total,bytes=value.unit==='bytes',count=bytes?storageSize(value.completed):(value.completed??0).toLocaleString();
 return {path:(value.stages??[]).filter(s=>s!=='preparing'&&s!==value.stage).map(s=>stageName(kind,s)).join(' › '),
  count:!value.completed&&!(total>0)?'':text(bytes?total>0?'dataTotal':'data':total>0?'countTotal':'count',{count,total:bytes?storageSize(total):(total??0).toLocaleString()}),
  work:'',detail:'',barLabel:stageName(kind,value.stage),total:total??0,completed:value.completed??0};
}

// The global surface is a compact index. Detailed observations follow their
// owning route, independently of the request's original DOM or connection.
export function activityUI({onChange=()=>{}}={}){
 const host=document.createElement('div');host.className='app-activity';host.hidden=true;
 host.innerHTML='<button type="button" class="button" aria-controls="app-activity-panel" aria-expanded="false" data-toggle></button><section id="app-activity-panel" aria-labelledby="app-activity-heading" hidden><header><h2 id="app-activity-heading" tabindex="-1"></h2><button type="button" data-close>&times;</button></header><p data-connection role="status"></p><p data-empty></p><div data-list></div><button type="button" class="button" data-clear></button></section>';

 const toggle=host.querySelector('[data-toggle]'),panel=host.querySelector('section'),list=host.querySelector('[data-list]'),cards=new Map(),owned=new Map();
 let snapshot=null,pending=null,timer=null,stopped=false,generation=0;
 const owner=entry=>activityOwner(entry.kind,entry.view);
 const ordered=()=>[...(snapshot?.operations??[])].sort((a,b)=>({running:0,queued:1}[a.state]??2)-({running:0,queued:1}[b.state]??2)||b.startedAt-a.startedAt);
 function mount(){const slot=document.querySelector('[data-activity-slot]');if(slot&&host.parentNode!==slot)slot.append(host);}
 function visibility(){updateProperty(host,'hidden',!snapshot||!snapshot.operations.length&&panel.hidden);}
 function open(){mount();panel.hidden=false;toggle.setAttribute('aria-expanded','true');visibility();host.querySelector('h2').focus();}
 function close(){panel.hidden=true;toggle.setAttribute('aria-expanded','false');visibility();(host.hidden?document.querySelector('[data-action="shell-menu"]'):toggle)?.focus();}
 function clear(map){for(const card of map.values()){card.progress?.close();card.node.remove();}map.clear();}
 function create(entry,target,detailed){
  const node=document.createElement('article');node.dataset.operation=entry.id;
  node.innerHTML='<h3 data-title></h3><p data-status role="status"></p><p data-error></p>'+(detailed?'<p data-waiting></p><div data-progress></div>':'<a data-owner></a>');target.append(node);return {node};
 }
 function update(card,entry,detailed){
  const {node}=card;updateText(node.querySelector('[data-title]'),title(entry.kind,owner(entry)));
  updateText(node.querySelector('[data-status]'),text(entry.state==='failed'&&entry.resolvedAt?'recovered':entry.state));
  const error=node.querySelector('[data-error]');updateText(error,entry.state==='failed'&&!entry.resolvedAt?(entry.error?.message??''):'');updateProperty(error,'hidden',!error.textContent);
  if(!detailed){const link=node.querySelector('[data-owner]'),view=owner(entry);updateProperty(link,'hidden',!view);updateText(link,text('showProgress'));updateAttribute(link,'href',view);return;}
  const waiting=node.querySelector('[data-waiting]'),blocker=snapshot.operations.find(value=>value.state==='running'&&activityResource(value.kind)===activityResource(entry.kind));
  updateText(waiting,entry.state==='queued'?(blocker?text('waitingFor',{operation:title(blocker.kind)}):text('waiting-writer')):'');updateProperty(waiting,'hidden',!waiting.textContent);
  if(entry.state==='running'){
   if(!card.progress){card.progress=operationProgress({host:node.querySelector('[data-progress]'),title:()=>title(entry.kind),stageText:s=>stageName(entry.kind,s),presentation:value=>presentation(entry.kind,value),disableControls:false,scroll:false,compact:true});card.progress.element.dataset.ownedProgress='';}
   card.progress.update(entry.progress);
  }else{card.progress?.close();card.progress=null;}
 }
 function bind(){
  mount();
  for(const [id,card] of owned)if(!card.node.isConnected){card.progress?.close();owned.delete(id);}
  const main=document.querySelector('#main');if(!snapshot||!main){clear(owned);return;}
  let fallback=main.querySelector('[data-owned-activity]:not([data-owner-container])');
  const hosts=[...main.querySelectorAll('[data-owned-operation]')],targets=new Map();
  for(const entry of ordered()){
   if(!(active(entry)||entry.state==='failed'&&!entry.resolvedAt&&!entry.supersededBy))continue;
   const host=hosts.find(node=>!node.hidden&&node.dataset.ownedOperation===entry.kind&&(!node.dataset.operationId||node.dataset.operationId===entry.commandId));
   if(!host&&fallback?.dataset.allActivity!=='true'&&!activityViewMatches(owner(entry),location.hash))continue;
   if([...main.querySelectorAll('.operation-progress[data-operation-kind]')].some(node=>!node.hidden&&!node.hasAttribute('data-owned-progress')&&node.dataset.operationKind===entry.kind))continue;
   let target;
   if(host){target=[...host.children].find(node=>node.hasAttribute('data-owner-container'));if(!target){target=document.createElement('div');target.dataset.ownedActivity='';target.dataset.ownerContainer='';host.append(target);}}
   else{if(!fallback){fallback=document.createElement('div');fallback.dataset.ownedActivity='';const title=main.querySelector('h1'),heading=title?.closest('.page-heading,.record-title-row,.pdf-toolbar')??title;if(heading)heading.after(fallback);else main.prepend(fallback);}target=fallback;}
   targets.set(entry.id,{entry,target});
  }
  for(const [id,card] of owned)if(!targets.has(id)||card.node.parentNode!==targets.get(id).target){card.progress?.close();card.node.remove();owned.delete(id);}
  const positions=new Map();for(const {entry,target} of targets.values()){let card=owned.get(entry.id);if(!card){card=create(entry,target,true);owned.set(entry.id,card);}update(card,entry,true);const index=positions.get(target)??0;placeAt(target,card.node,index);positions.set(target,index+1);}
 }

 function render(){
  if(!snapshot)return;
  const running=snapshot.operations.filter(entry=>entry.state==='running').length,queued=snapshot.operations.filter(entry=>entry.state==='queued').length;
  updateText(toggle,running&&queued?text('counts',{running,queued}):running?text('runningCount',{count:running}):queued?text('queuedCount',{count:queued}):text('title'));updateText(host.querySelector('h2'),text('title'));
  updateAttribute(host.querySelector('[data-close]'),'aria-label',text('close'));updateText(host.querySelector('[data-clear]'),text('clear'));
  const empty=host.querySelector('[data-empty]');updateText(empty,text('empty'));updateProperty(empty,'hidden',!!snapshot.operations.length);
  const ids=new Set(snapshot.operations.map(entry=>entry.id));for(const [id,card] of cards)if(!ids.has(id)){card.node.remove();cards.delete(id);}
  for(const [index,entry] of ordered().entries()){let card=cards.get(entry.id);if(!card){card=create(entry,list,false);cards.set(entry.id,card);}update(card,entry,false);placeAt(list,card.node,index);}
  updateProperty(host.querySelector('[data-clear]'),'disabled',!snapshot.operations.some(entry=>!active(entry)));visibility();bind();
 }
 async function refresh(){
  if(pending)return pending;
  const epoch=generation;
  pending=(async()=>{
   const response=await fetch('/api/activity',{cache:'no-store'});
   if(!response.ok){if([401,403].includes(response.status)){snapshot=null;clear(cards);clear(owned);host.hidden=true;}throw await response.json();}
   const next=await response.json();if(epoch!==generation)return next;snapshot=next;updateText(host.querySelector('[data-connection]'),'');render();onChange(next);return next;
  })().catch(error=>{updateText(host.querySelector('[data-connection]'),text('connection'));throw error;}).finally(()=>{pending=null;});
  return pending;
 }
 async function poll(){try{await refresh();}catch{/* A stale view must not claim completion. */}finally{if(!stopped)timer=setTimeout(poll,1500);}}
 toggle.addEventListener('click',()=>panel.hidden?open():close());host.querySelector('[data-close]').addEventListener('click',close);
 panel.addEventListener('click',event=>{if(event.target.closest('[data-owner]'))close();});
 panel.addEventListener('keydown',event=>{if(event.key==='Escape'){event.stopPropagation();close();}});
 host.querySelector('[data-clear]').addEventListener('click',async()=>{
  try{const response=await fetch('/api/activity/clear',{method:'POST',headers:{'Content-Type':'application/json','X-Observanda-Workspace':snapshot.contextId},body:'{}'});if(!response.ok)throw await response.json();await refresh();}catch{updateText(host.querySelector('[data-connection]'),text('connection'));}
 });
 const unsubscribe=onLanguageChange(render);
 return {open,refresh,bind,storageBusy:()=>!!snapshot?.busy&&(!snapshot.readable||snapshot.operations.some(entry=>entry.kind.startsWith('/api/storage/')&&active(entry))),start(){stopped=false;void poll();},hide(){generation++;host.hidden=true;panel.hidden=true;toggle.setAttribute('aria-expanded','false');clear(cards);clear(owned);snapshot=null;},stop(){stopped=true;clearTimeout(timer);unsubscribe();clear(cards);clear(owned);host.remove();}};
}
