import {hasProjectDirectory} from './project-directory-capability.js';
import {localizedText} from './i18n/index.js';
const text=localizedText('projectOpening');
// Folder selection, independent-owner credentials and restart recovery stay in
// the Projects section. Only the currently submitted owner's secret is held.
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
   const content='<div data-owned-operation="/api/projects/open" data-operation-id="'+item.id+'"><div data-owned-operation="/api/projects/open/access/finish" data-operation-id="'+item.id+'"><div data-owned-operation="/api/projects/open/cancel" data-operation-id="'+item.id+'"><h2>'+esc(text(cancelling?'cancellingImport':'importing',{name:item.name}))+'</h2>'+controls+'</div></div></div>';if(card.dataset.content!==content){card.dataset.content=content;card.innerHTML=content;}
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
  const token=generation,view=location.hash;let succeeded=false,command;
  pending=true;prompt=null;error='';paint();
  try{
   if(attempt.cancel&&['cancelling','authorizing'].includes(attempt.phase)){
    command={id:attempt.id,username:'',password:'',recovery:''};
    const result=await api('/api/projects/open/cancel',command,{adopt:false,view});succeeded=result.cancelled?'cancelled':true;
   }else{
    const secret=attempt.secret??{username:'',password:'',recovery:''};
    command=attempt.admission?{id:attempt.id,session:attempt.admission.session,revision:attempt.admission.revision,relative:attempt.relative,...secret}:{id:attempt.id,...secret,intent:attempt.cancel?'cancel':'import',...(!attempt.resume?{path:attempt.path,parentId:null}:{})};
    const request=async(command,method)=>{
     let response;
     try{response=await api('/api/projects/open/access/'+method,command,{adopt:false,view});}
     catch(error){
      if(method!=='submit'||!['CONFLICT',undefined].includes(error.code)||error.name==='AbortError')throw error;
      // Acceptance can precede a lost response; the client-bound cursor tells
      // us which owner comes next without retaining earlier passwords.
      response=await api('/api/projects/open/access/page',{id:attempt.id,session:command.session},{adopt:false,view});
      if(response.revision===command.revision)throw error;
     }
     if(response.session)attempt.admission={session:response.session,revision:response.revision};return response;
    };
    let response=await request(command,attempt.admission?'submit':'start');
    command.password='';command.recovery='';command.username='';if(attempt.secret){attempt.secret.password='';attempt.secret.recovery='';attempt.secret.username='';delete attempt.secret;}
    while(current(token)&&response.automatic){const owner=response.items[0];response=await request({id:attempt.id,...attempt.admission,relative:owner.relative,username:'',password:'',recovery:''},'submit');}
    if(!current(token))return;
    if(response.session){
     attempt.admission={session:response.session,revision:response.revision};
     if(response.ready){
      const result=await api('/api/projects/open/access/finish',{id:attempt.id,...attempt.admission},{adopt:false,view});
      if(current(token))succeeded=result.cancelled?'cancelled':true;
     }else{
      const owner=response.items[0];if(!owner)throw Error(text('failed'));
      prompt={...attempt,relative:owner.relative,name:owner.name,draft:{}};delete prompt.secret;
     }
    }else succeeded=true;
   }
   if(succeeded&&current(token))await refreshDirectory();
  }catch(e){if(current(token)&&e.name!=='AbortError'){
   error=e.message??text('failed');prompt={...attempt,draft:{}};delete prompt.secret;
   if(e.code==='CONFLICT'||e.code==='ACCESS_LOCKED'||e.code==='PROJECT_IMPORT_ACCESS'&&attempt.admission&&e.details?.[0]!==attempt.relative){prompt.admission=null;prompt.relative='';}
  }}finally{
   if(command){command.password='';command.recovery='';command.username='';}if(attempt.secret){attempt.secret.password='';attempt.secret.recovery='';attempt.secret.username='';delete attempt.secret;}
   if(current(token)){pending=false;await load();complete=succeeded;if(prompt&&items.some(item=>item.id===attempt.id)){const saved=items.find(item=>item.id===attempt.id);if(saved.phase==='cancelling')prompt=null;else{prompt.resume=true;prompt.phase=saved.phase;}}paint();}
  }
 }

 return {
  view:()=>'<section data-project-opening><p role="alert" hidden></p><p data-import-complete role="status" hidden>'+esc(text('imported'))+'</p><div data-opening-form></div><div data-opening-pending></div><button class="button" data-opening-more data-action="project-opening-more" hidden>'+esc(text('more'))+'</button></section>',
  button:()=>'<button class="button" data-action="project-open-folder">'+esc(text('open'))+'</button>',
  bind(){sync();const shown=hasProjectDirectory(state)&&state.page==='projects',entered=shown&&!visible;visible=shown;paint();if(entered)void load();},
  async action(node){sync();const action=node.dataset.action;if(action!=='project-open-folder'&&!action?.startsWith('project-opening-'))return false;
   if(action==='project-opening-dismiss'){const dismissed=prompt;prompt=null;error='';if(dismissed?.admission){try{await api('/api/projects/open/access/release',{id:dismissed.id,session:dismissed.admission.session},{adopt:false});await load();}catch(e){error=e.message??text('failed');}}}
   else if(action==='project-opening-more'){await load(true);return true;}
   else{error='';complete=false;const item=items.find(item=>item.id===node.dataset.id);if(action==='project-opening-cancel'&&item?.phase==='cancelling'){await execute({id:item.id,resume:true,cancel:true,phase:item.phase,relative:''});return true;}prompt={id:item?.id??crypto.randomUUID(),resume:!!item,cancel:action==='project-opening-cancel',inPlace:item?.inPlace,name:item?.name,relative:'',path:'',phase:item?.phase,admission:null};}
   paint();document.querySelector('#project-opening-form input')?.focus();return true;
  },
  async submit(form){
   if(form.id!=='project-opening-form'||!prompt)return false;if(pending)return true;const attempt=prompt;
   if(form.elements.path)attempt.path=form.elements.path.value;attempt.secret={username:form.elements.username.value,password:form.elements.password.value,recovery:form.elements.recovery.value};attempt.draft={};form.elements.password.value='';form.elements.recovery.value='';
   await execute(attempt);
   return true;
  }
 };
}
