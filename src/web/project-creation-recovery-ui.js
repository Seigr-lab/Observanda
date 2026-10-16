import {hasProjectDirectory} from './project-directory-capability.js';
import {localizedText} from './i18n/index.js';
const text=localizedText('projectCreation');
// Recovery belongs in the project directory. The service owns the durable
// request; navigation and window lifetime do not own a second creation.
export function projectCreationRecoveryUI({state,api,esc,field,showDialog,refreshDirectory}){
 let context=null,storageKind=null,generation=0,loading=false,loaded=false,items=[],next=null,error='',command=null,submitting=new Set(),wasVisible=false;
 const visible=()=>hasProjectDirectory(state)&&state.page==='projects'&&!state.access?.locked&&!state.storageUnavailable&&!state.newWorkspace;
 function sync(){if(context!==state.storage?.contextId||storageKind!==state.storage?.researchStorage){context=state.storage?.contextId;storageKind=state.storage?.researchStorage;generation++;loading=loaded=false;items=[];next=null;error='';command=null;submitting=new Set();wasVisible=false;}}
 const host=()=>visible()?document.querySelector('[data-project-creation-recovery]'):null;
 function paint(){
  const node=host();if(!node)return;node.hidden=!items.length&&!error;
  const content=(error?'<p role="alert">'+esc(error)+'</p><button class="button" data-action="project-creation-refresh">'+esc(text('retry'))+'</button>':'')+items.map(item=>'<article class="panel" data-creation="'+item.id+'"><h2>'+esc(text('title',{title:item.title}))+'</h2><p class="storage-path">'+esc(item.path)+'</p>'+(item.running||submitting.has(item.id)?'<p role="status">'+esc(text('running'))+'</p>':'<button class="button" data-action="project-creation-resume" data-id="'+item.id+'">'+esc(text('resume'))+'</button>')+'</article>').join('')+(next?'<button class="button" data-action="project-creation-more">'+esc(text('more'))+'</button>':'');
  if(node.dataset.content!==content){node.dataset.content=content;node.innerHTML=content;}
 }
 async function load(more=false){
  sync();if(!hasProjectDirectory(state)||loading)return;loading=true;const token=generation;
  try{const result=await api('/api/projects/create/pending',{after:more?next:null,limit:20},{adopt:false});if(token!==generation||context!==state.storage?.contextId)return;const finished=items.some(item=>item.running&&!result.items.some(value=>value.id===item.id));items=more?[...items,...result.items]:result.items;next=result.next;loaded=true;error='';if(finished)await refreshDirectory();}
  catch(e){if(token===generation)error=e.message??text('failed');}
  finally{if(token===generation){loading=false;paint();}}
 }
 async function resume(item,password){
  const token=generation;submitting.add(item.id);error='';paint();
  try{const result=await api('/api/projects/create/resume',{id:item.id,username:item.username,password},{adopt:false});if(token!==generation||context!==state.storage?.contextId)return;
   if(password)await api('/api/projects/'+result.project.projectId+'/access/unlock',{username:item.username,password,recovery:''},{adopt:false});
   await load();await refreshDirectory();
  }catch(e){if(token===generation){error=e.message??text('failed');paint();}}
  finally{if(token===generation){submitting.delete(item.id);paint();}}
 }
 setInterval(()=>{sync();if(visible()&&items.some(item=>item.running)&&!submitting.size)void load();},1500);
 return {
  view:()=>'<section data-project-creation-recovery hidden></section>',
  bind(){sync();const shown=visible(),entered=shown&&!wasVisible;wasVisible=shown;if(shown){if((entered||!loaded)&&!loading)void load();else paint();}},
  async action(node){
   if(!node.dataset.action?.startsWith('project-creation-'))return false;sync();
   if(node.dataset.action==='project-creation-refresh'||node.dataset.action==='project-creation-more'){await load(node.dataset.action.endsWith('-more'));return true;}
   const item=items.find(value=>value.id===node.dataset.id);if(!item||item.running||submitting.has(item.id))return true;
   if(!item.password){await resume(item,'');return true;}command=item;
   showDialog('<form id="project-creation-resume-form" data-no-draft><h2 id="dialog-title">'+esc(text('title',{title:item.title}))+'</h2>'+field(text('password'),'<input name="password" type="password" autocomplete="current-password" required>')+'<div class="dialog-actions"><button type="button" class="button" data-action="close-dialog">'+esc(text('cancel'))+'</button><button type="submit" class="button primary">'+esc(text('resume'))+'</button></div></form>');return true;
  },
  async submit(form){if(form.id!=='project-creation-resume-form')return false;sync();const item=command;if(!item)return true;const password=form.elements.password.value;command=null;document.getElementById('dialog').close();await resume(item,password);return true;}
 };
}
