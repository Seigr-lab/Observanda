import {hasProjectDirectory} from './project-directory-capability.js';
import {localizedText} from './i18n/index.js';
const text=localizedText('projectOpening');
// Folder selection, independent-owner credentials and restart recovery stay in
// the Projects section. Secrets are held only for the current import attempt.
export function projectOpeningUI({state,api,esc,field,refreshDirectory,enterProject,render}){
 let context=null,storageKind=null,generation=0,visible=false,loading=false,items=[],next=null,prompt=null,pending=false,error='',complete=false;
 const current=token=>token===generation&&context===state.storage?.contextId;
 function sync(){if(context!==state.storage?.contextId||storageKind!==state.storage?.researchStorage){context=state.storage?.contextId;storageKind=state.storage?.researchStorage;generation++;visible=false;loading=false;items=[];next=null;prompt=null;pending=false;error='';complete=false;}}
 function paint(){
  sync();const host=document.querySelector('[data-project-opening]');if(!host)return;
  const alert=host.querySelector('[role=alert]');alert.textContent=error;alert.hidden=!error;host.querySelector('[data-import-complete]').hidden=!complete;host.querySelector('[data-import-complete]').textContent=text(complete==='cancelled'?'importCancelled':'imported');
  const forms=host.querySelector('[data-opening-form]'),key=JSON.stringify(prompt?{id:prompt.id,resume:prompt.resume,cancel:prompt.cancel,relative:prompt.relative,name:prompt.name}:null);
  if(forms.dataset.key!==key){forms.dataset.key=key;forms.innerHTML=prompt?'<form id="project-opening-form" data-no-draft><h2>'+esc(text(prompt.relative?'unlockOwner':prompt.cancel?(prompt.inPlace?'stopImportQuestion':'discardImportQuestion'):prompt.resume?'resume':'open',{name:prompt.name??''}))+'</h2>'+(prompt.cancel?'<p>'+esc(text(prompt.inPlace?'stopImportDetail':'discardImportDetail'))+'</p>':'')+(!prompt.resume&&!prompt.relative?field(text('folder'),'<input name="path" id="project-open-path" value="'+esc(prompt.path??'')+'" required autocomplete="off" spellcheck="false">')+'<button type="button" class="button" data-action="storage-browse" data-target="project-open-path">'+esc(text('choose'))+'</button>':'')+field(text('password'),'<input name="password" type="password" value="'+esc(prompt.draft?.password??'')+'" autocomplete="current-password">')+'<details><summary>'+esc(text('moreAccess'))+'</summary>'+field(text('username'),'<input name="username" value="'+esc(prompt.draft?.username??'')+'" autocomplete="username">')+field(text('recoveryKey'),'<input name="recovery" type="password" value="'+esc(prompt.draft?.recovery??'')+'" autocomplete="off">')+'</details><div class="inline-actions"><button type="button" class="button" data-action="project-opening-dismiss">'+esc(text(prompt.cancel?'keepImport':'cancel'))+'</button><button type="submit" class="button primary">'+esc(text(prompt.cancel?(prompt.inPlace?'cancelImport':'discardImport'):prompt.resume||prompt.relative?'resume':'open'))+'</button></div></form>':'';}
  const list=host.querySelector('[data-opening-pending]'),ids=new Set(items.map(item=>item.id));for(const card of list.children)if(!ids.has(card.dataset.importId))card.remove();
  for(const item of items){
   let card=list.querySelector('[data-import-id="'+item.id+'"]');if(!card){card=document.createElement('article');card.className='panel';card.dataset.importId=item.id;list.append(card);}
   const running=item.running||pending,cancelling=item.phase==='cancelling',button=(action,label)=>'<button class="button" data-action="project-opening-'+action+'" data-id="'+item.id+'">'+esc(text(label))+'</button>';
   const controls=running?'':cancelling?button('cancel','finishCancellation'):button('resume','resume')+(item.cancellable?button('cancel','cancelImport'):'');
   const content='<div data-owned-operation="/api/projects/open" data-operation-id="'+item.id+'"><div data-owned-operation="/api/projects/open/resume" data-operation-id="'+item.id+'"><div data-owned-operation="/api/projects/open/cancel" data-operation-id="'+item.id+'"><h2>'+esc(text(cancelling?'cancellingImport':'importing',{name:item.name}))+'</h2>'+controls+'</div></div></div>';if(card.dataset.content!==content){card.dataset.content=content;card.innerHTML=content;}
  }
  host.querySelector('[data-opening-more]').hidden=!next;
 }
 async function load(more=false){
  if(!hasProjectDirectory(state)||loading)return;loading=true;const token=generation;
  try{const result=await api('/api/projects/open/pending',{after:more?next:null,limit:20},{adopt:false});if(!current(token))return;const finished=!more&&items.some(item=>!result.items.some(other=>other.id===item.id));items=more?[...items,...result.items]:result.items;next=result.next;if(finished)await refreshDirectory();}
  catch(e){if(current(token)&&e.name!=='AbortError')error=e.message??text('failed');}
  finally{if(current(token)){loading=false;paint();}}
 }
 document.addEventListener('input',event=>{if(!prompt||!event.target.closest?.('#project-opening-form'))return;const field=event.target.name;if(field==='path')prompt.path=event.target.value;else if(['username','password','recovery'].includes(field)){prompt.draft??={};prompt.draft[field]=event.target.value;}});
 setInterval(()=>{sync();if(visible&&!pending&&items.some(item=>item.running))void load();},1500);
 async function execute(attempt){
  const token=generation,view=location.hash;let succeeded=false;
   const root=attempt.credentials.get('')??{username:'',password:'',recovery:''},command={id:attempt.id,username:root.username,password:root.password,recovery:root.recovery,owners:[...attempt.credentials.values()].filter(item=>item.relative),...(!attempt.resume?{path:attempt.path,parentId:null}:{})};pending=true;prompt=null;error='';paint();
   try{const result=await api('/api/projects/open'+(attempt.cancel?'/cancel':attempt.resume?'/resume':''),command,{adopt:false,view});if(current(token)){succeeded=result.cancelled?'cancelled':true;attempt.credentials.clear();await refreshDirectory();}}
   catch(e){if(current(token)&&e.name!=='AbortError'){
    error=e.message??text('failed');prompt=attempt;prompt.draft={};
    if(e.code==='PROJECT_IMPORT_ACCESS'&&Array.isArray(e.details)){prompt.relative=e.details[0];prompt.name=e.details[1];prompt.credentials.delete(prompt.relative);}
    else{prompt.credentials.clear();prompt.relative='';}
   }}finally{command.password='';command.recovery='';command.owners=[];if(current(token)){pending=false;await load();complete=succeeded;if(prompt&&items.some(item=>item.id===attempt.id)){if(items.find(item=>item.id===attempt.id).phase==='cancelling')prompt=null;else prompt.resume=true;}paint();}}
 }
 return {
  view:()=>'<section data-project-opening><p role="alert" hidden></p><p data-import-complete role="status" hidden>'+esc(text('imported'))+'</p><div data-opening-form></div><div data-opening-pending></div><button class="button" data-opening-more data-action="project-opening-more" hidden>'+esc(text('more'))+'</button></section>',
  button:()=>'<button class="button" data-action="project-open-folder">'+esc(text('open'))+'</button>',
  bind(){sync();const shown=hasProjectDirectory(state)&&state.page==='projects',entered=shown&&!visible;visible=shown;paint();if(entered)void load();},
  async action(node){sync();const action=node.dataset.action;if(action!=='project-open-folder'&&!action?.startsWith('project-opening-'))return false;
   if(action==='project-opening-dismiss'){prompt=null;error='';}
   else if(action==='project-opening-more'){await load(true);return true;}
   else{error='';complete=false;const item=items.find(item=>item.id===node.dataset.id);if(action==='project-opening-cancel'&&item?.phase==='cancelling'){await execute({id:item.id,resume:true,cancel:true,relative:'',credentials:new Map()});return true;}prompt={id:item?.id??crypto.randomUUID(),resume:!!item,cancel:action==='project-opening-cancel',inPlace:item?.inPlace,name:item?.name,relative:'',path:'',credentials:new Map()};}
   paint();document.querySelector('#project-opening-form input')?.focus();return true;
  },
  async submit(form){
   if(form.id!=='project-opening-form'||!prompt)return false;if(pending)return true;const attempt=prompt;
   if(form.elements.path)attempt.path=form.elements.path.value;attempt.credentials.set(attempt.relative,{relative:attempt.relative,username:form.elements.username.value,password:form.elements.password.value,recovery:form.elements.recovery.value});
   await execute(attempt);
   return true;
  }
 };
}
