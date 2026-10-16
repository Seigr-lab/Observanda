import {projectDirectoryChoices} from './project-directory-choices.js';
import {localizedText} from './i18n/index.js';
const text=localizedText('labBookStorage');
// A selected book owns its commands. Durable status survives navigation;
// progress is rendered by the activity owner in this same book view.
export function labBookStorageUI({state,api,esc,field,showDialog,access=operation=>operation(),moved=async()=>{}}){
 const choices=projectDirectoryChoices({state,api,esc,changed:paintChoices});
 function paintChoices(){const form=document.getElementById('lab-book-storage-form');if(!form||dialogCommand?.kind!=='move')return;const select=form.elements.projectId,previous=select.value,rows=choices.rows('book-parents');select.innerHTML='<option value="">'+esc(text('selectProject'))+'</option>'+rows.map(row=>'<option value="'+row.projectId+'">'+esc(row.summary?.title??row.projectId)+'</option>').join('');select.value=previous;choices.paint(form,'book-parents');}
 let context,entries=new Map(),dialogCommand=null;
 const prefix=entry=>'/api/projects/'+entry.projectId+'/lab-books/'+entry.labBookId+'/storage/';
 function selected(){
  if(context!==state.storage?.contextId){context=state.storage?.contextId;entries=new Map();dialogCommand=null;}
  const owner=state.projectOwner;if(!owner?.labBookId)return null;const id=owner.projectId+'/'+owner.labBookId;
  if(!entries.has(id))entries.set(id,{...owner,id,context,data:null,loading:false,pending:false,error:'',open:false});return entries.get(id);
 }
 const host=entry=>entry.context===state.storage?.contextId?document.querySelector('[data-lab-book-storage="'+entry.id+'"]'):null;
 const active=entry=>entry.pending||['copy','export','move'].some(kind=>entry.data?.[kind]?.running);
 const button=(label,action,extra='')=>'<button type="button" class="button" data-action="lab-book-storage-'+action+'" '+extra+'>'+esc(text(label))+'</button>';
 function paint(entry){
  const node=host(entry)?.querySelector('[data-transfer-fields]');if(!node)return;const data=entry.data,pending=active(entry);
  const signature=JSON.stringify([data,pending,entry.error,entry.loading&&!data]);if(node.dataset.signature===signature)return;node.dataset.signature=signature;
  node.innerHTML=(data?'<p class="storage-path">'+esc(data.path)+'</p><div class="inline-actions">'+button('copy','copy',pending?'disabled':'')+button('export','export',pending?'disabled':'')+button('move','move',pending?'disabled':'')+'</div>':'<p role="status">'+esc(text(entry.loading?'loading':'unavailable'))+'</p>')+
   (entry.error?'<p role="alert">'+esc(entry.error)+'</p>'+button('retry','refresh'):'')+
   (data?['copy','export','move'].map(kind=>{const receipt=data[kind];if(!receipt)return '';if(kind==='move'&&receipt.phase==='complete'&&!receipt.canResume)return '<p>'+esc(text('moved',{project:receipt.projectName}))+'</p>';if(kind==='move'&&receipt.phase==='cancelled'&&!receipt.canResume)return '';if(kind==='move'&&['cancelling','cancelled'].includes(receipt.phase))return '<p>'+esc(text('moveCleanup',{name:receipt.name}))+'</p>'+button('resumeCleanup','resume','data-kind="move"');if(receipt.phase==='complete'&&kind!=='move')return '<p>'+esc(text(kind==='copy'?'copied':'exported',{path:receipt.destination}))+'</p>';if(receipt.phase==='cancelled')return '<p>'+esc(text('cancelled',{path:receipt.destination}))+'</p>';return pending?'':'<p>'+esc(text(kind+'Pending'))+'</p><div class="inline-actions">'+button('resume','resume','data-kind="'+kind+'"')+(receipt.canCancel?button('cancelTransfer','cancel-transfer','data-kind="'+kind+'"'):'')+'</div>';}).join(''):'')+
   (pending?'<p role="status">'+esc(text(entry.pendingKind==='move'||data?.move?.running?'moveWorking':'working'))+'</p>':'');
 }
 async function load(entry){
  if(entry.loading)return;entry.loading=true;paint(entry);
  try{entry.data=await api(prefix(entry)+'details',{}, {adopt:false});entry.error='';}catch(error){entry.error=error.message??text('unavailable');}
  finally{entry.loading=false;paint(entry);}
 }
 async function run(entry,kind,command,suffix=''){
  if(active(entry))return;entry.pending=true;entry.pendingKind=kind;entry.error='';paint(entry);const view=location.hash;
  try{const result=await access(()=>api(prefix(entry)+kind+suffix,command,{adopt:false,view}));if(kind==='move'){entries.delete(entry.id);await moved(result,view,entry);}else await load(entry);}
  catch(error){entry.error=error.name==='AbortError'?'':error.message??text('failed');try{entry.data=await api(prefix(entry)+'details',{}, {adopt:false});}catch{}}
  finally{entry.pending=false;entry.pendingKind=null;paint(entry);}
 }
 setInterval(()=>{for(const entry of entries.values())if(host(entry)&&!entry.pending&&active(entry))void load(entry);},1500);
 return {
  view(){const entry=selected();return entry?'<details class="panel" data-lab-book-storage="'+entry.id+'"'+(entry.open?' open':'')+'><summary>'+esc(text('title'))+'</summary><div data-transfer-fields></div></details>':'';},
  bind(){const entry=selected(),node=entry&&host(entry);if(!node||node.dataset.bound)return;node.dataset.bound='true';paint(entry);node.addEventListener('toggle',()=>{if(!node.isConnected)return;entry.open=node.open;if(node.open)void load(entry);});if(entry.open)void load(entry);},
  async action(node){
   const action=node.dataset.action;if(!action?.startsWith('lab-book-storage-'))return false;const entry=selected();if(!entry||active(entry))return true;
   if(action==='lab-book-storage-refresh'){await load(entry);return true;}
   const kind=node.dataset.kind,receipt=entry.data?.[kind];
   if(action==='lab-book-storage-resume'){if(['copy','export','move'].includes(kind)&&receipt)await run(entry,kind,{id:receipt.id},'/resume');return true;}
   if(action==='lab-book-storage-cancel-transfer'){if(['copy','export'].includes(kind)&&receipt?.canCancel)await run(entry,kind,{id:receipt.id},'/cancel');return true;}
   const command=action.slice('lab-book-storage-'.length);if(!['copy','export','move'].includes(command))return true;
   dialogCommand={entry,kind:command,id:crypto.randomUUID()};
   if(command==='move'){
    showDialog('<form id="lab-book-storage-form" data-no-draft><h2 id="dialog-title">'+esc(text('move'))+'</h2>'+field(text('destinationProject'),'<select name="projectId" required><option value="">'+esc(text('selectProject'))+'</option></select>')+choices.view('book-parents')+'<div class="dialog-actions"><button type="button" class="button" data-action="close-dialog">'+esc(text('cancel'))+'</button><button type="submit" class="button primary">'+esc(text('move'))+'</button></div></form>');choices.start(entry.projectId,{templates:false,bookParents:true});return true;
   }
   showDialog('<form id="lab-book-storage-form" data-no-draft><h2 id="dialog-title">'+esc(text(command))+'</h2>'+field(text('destinationParent'),'<input id="lab-book-storage-path" name="path" required autocomplete="off" spellcheck="false">')+'<button type="button" class="button" data-action="storage-browse" data-target="lab-book-storage-path">'+esc(text('choose'))+'</button><p>'+esc(text(command+'Effect'))+'</p><div class="dialog-actions"><button type="button" class="button" data-action="close-dialog">'+esc(text('cancel'))+'</button><button type="submit" class="button primary">'+esc(text(command))+'</button></div></form>');return true;
  },
  input(element){return !!element.closest('#lab-book-storage-form')&&choices.input(element);},
  async choiceAction(node){return !!node.closest?.('#lab-book-storage-form')&&choices.action(node);},
  async submit(form){
   if(form.id!=='lab-book-storage-form')return false;const command=dialogCommand;if(!command||command.entry.context!==state.storage?.contextId)return true;
   if(command.kind==='move'){const projectId=form.elements.projectId.value;if(!projectId)return true;dialogCommand=null;choices.reset();document.querySelector('#dialog').close();await run(command.entry,'move',{id:command.id,projectId});return true;}
   const parent=form.elements.path.value.trim();if(!parent)return true;dialogCommand=null;document.querySelector('#dialog').close();await run(command.entry,command.kind,{id:command.id,parent});return true;
  }
 };
}
