import {t} from './i18n/index.js';
const text=(key,args)=>t('labBookDirectory',key,args);
// Creation receipts belong to the containing project's book list. Opening the
// list only discovers them; a user action resumes the same durable request.
export function labBookCreationRecoveryUI({state,api,esc,refreshDirectory}){
 let context,generation=0,pages=new Map(),visibleProject=null;
 function sync(){if(context!==state.storage?.contextId){context=state.storage?.contextId;generation++;pages=new Map();visibleProject=null;}}
 function page(id){sync();if(!pages.has(id))pages.set(id,{id,items:[],next:null,loading:false,loaded:false,error:'',pending:new Set(),prompt:null});return pages.get(id);}
 const current=token=>token===generation&&context===state.storage?.contextId;
 function paint(value){
  const node=document.querySelector('[data-lab-book-creations="'+value.id+'"]');if(!node)return;
  node.hidden=!value.items.length&&!value.error&&!value.next;
  const alert=node.querySelector('[role="alert"]');alert.textContent=value.error;alert.hidden=!value.error;
  node.querySelector('[data-refresh]').hidden=!value.error;
  const list=node.querySelector('[data-creations]'),ids=new Set(value.items.map(item=>item.id));
  for(const child of list.children)if(!ids.has(child.dataset.creation))child.remove();
  for(const item of value.items){
   let card=list.querySelector('[data-creation="'+item.id+'"]');if(!card){card=document.createElement('article');card.className='panel';card.dataset.creation=item.id;list.append(card);}
   const running=item.running||value.pending.has(item.id),prompt=value.prompt===item.id;
   const content='<div data-owned-operation="/api/projects/'+value.id+'/lab-books/create"><div data-owned-operation="/api/projects/'+value.id+'/lab-books/create/resume"><h2>'+esc(text('creating',{name:item.name}))+'</h2>'+(running?'<p role="status">'+esc(text('creatingFiles'))+'</p>':prompt?'<form data-book-creation-resume data-project="'+value.id+'" data-id="'+item.id+'" data-no-draft><label>'+esc(text('creationPassword'))+'<input name="password" type="password" autocomplete="current-password" required></label><div class="inline-actions"><button type="button" class="button" data-action="lab-book-directory-create-cancel" data-project="'+value.id+'">'+esc(text('cancel'))+'</button><button type="submit" class="button primary">'+esc(text('finishCreating'))+'</button></div></form>':'<button class="button" data-action="lab-book-directory-create-resume" data-project="'+value.id+'" data-id="'+item.id+'">'+esc(text('finishCreating'))+'</button>')+'</div></div>';
   if(card.dataset.content!==content){const password=card.querySelector('[name=password]')?.value;card.dataset.content=content;card.innerHTML=content;if(password!==undefined&&prompt&&!running)card.querySelector('[name=password]').value=password;}
  }
  node.querySelector('[data-more]').hidden=!value.next;
 }
 async function load(value,more=false){
  if(value.loading)return;value.loading=true;const token=generation;
  try{
   const result=await api('/api/projects/'+value.id+'/lab-books/create/pending',{after:more?value.next:null,limit:20},{adopt:false});if(!current(token))return;
   const finished=!more&&value.items.some(item=>item.running&&!result.items.some(next=>next.id===item.id));
   value.items=more?[...value.items,...result.items]:result.items;value.next=result.next;value.loaded=true;value.error='';if(finished)await refreshDirectory(value.id);
  }catch(error){if(current(token))value.error=error.message??text('creationFailed');}
  finally{if(current(token)){value.loading=false;paint(value);}}
 }
 async function resume(value,item,password){
  if(value.pending.has(item.id))return;const token=generation;value.pending.add(item.id);value.error='';value.prompt=null;paint(value);
  try{await api('/api/projects/'+value.id+'/lab-books/create/resume',{id:item.id,username:item.username,password},{adopt:false});if(current(token)){await load(value);await refreshDirectory(value.id);}}
  catch(error){if(current(token)){await load(value);if(current(token))value.error=error.message??text('creationFailed');}}
  finally{if(current(token)){value.pending.delete(item.id);paint(value);}}
 }
 setInterval(()=>{sync();if(!visibleProject)return;const value=page(visibleProject);if(!value.pending.size&&value.items.some(item=>item.running))void load(value);},1500);
 return {
  view:projectId=>'<section data-lab-book-creations="'+projectId+'" hidden><p role="alert" hidden></p><button class="button" data-refresh data-action="lab-book-directory-create-refresh" data-project="'+projectId+'" hidden>'+esc(text('retry'))+'</button><div data-creations></div><button class="button" data-more data-action="lab-book-directory-create-more" data-project="'+projectId+'" hidden>'+esc(text('moreCreations'))+'</button></section>',
  bind(){sync();const id=state.page==='project'&&!state.access?.locked&&!state.storageUnavailable?state.projectOwner?.projectId:null,entered=id!==visibleProject;visibleProject=id;if(id){const value=page(id);paint(value);if(entered||!value.loaded)void load(value);}},
  async action(node){const {action,project,id}=node.dataset;if(!action?.startsWith('lab-book-directory-create-'))return false;const value=page(project);
   if(action.endsWith('-refresh')||action.endsWith('-more'))await load(value,action.endsWith('-more'));
   else if(action.endsWith('-cancel')){value.prompt=null;paint(value);}
   else{const item=value.items.find(item=>item.id===id);if(item&&!item.running&&!value.pending.has(id)){if(item.password){value.prompt=id;paint(value);document.querySelector('[data-creation="'+id+'"] [name=password]')?.focus();}else await resume(value,item,'');}}return true;
  },
  async submit(form){if(!form.hasAttribute('data-book-creation-resume'))return false;const value=page(form.dataset.project),item=value.items.find(item=>item.id===form.dataset.id);if(item)await resume(value,item,form.elements.password.value);return true;}
 };
}
