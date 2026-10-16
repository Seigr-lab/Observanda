import {localizedText} from './i18n/index.js';
const text=localizedText('labBookStorage');
// Import controls and recovery live beside the selected project's book list.
export function labBookImportUI({state,api,esc,access,refreshDirectory,changed}){
 let context,generation=0,visible=null,pages=new Map();
 function sync(){if(context!==state.storage?.contextId){context=state.storage?.contextId;generation++;pages=new Map();visible=null;}}
 function page(id){sync();if(!pages.has(id))pages.set(id,{id,items:[],next:null,loaded:false,loading:false,prompt:null,pending:new Set(),error:'',complete:false});return pages.get(id);}
 const current=token=>token===generation&&context===state.storage?.contextId;
 const url=value=>'/api/projects/'+value.id+'/lab-books/import';
 const input=(label,name,type='text',extra='')=>'<label>'+esc(text(label))+'<input name="'+name+'" type="'+type+'" '+extra+'></label>';
 function paint(value){
  const host=document.querySelector('[data-book-import="'+value.id+'"]');if(!host)return;
  host.querySelector('[data-import-error]').textContent=value.error;host.querySelector('[data-import-error]').hidden=!value.error;
  host.querySelector('[data-import-complete]').hidden=!value.complete;host.querySelector('[data-import-complete]').textContent=text(value.complete==='cancelled'?'importCancelled':'imported');
  const formHost=host.querySelector('[data-import-form]'),prompt=value.prompt;
  const formKey=JSON.stringify([prompt?.id,prompt?.resume,prompt?.cancel,context]);if(formHost.dataset.key!==formKey){formHost.dataset.key=formKey;
   formHost.innerHTML=prompt?'<form data-book-import-form data-no-draft data-project="'+value.id+'"><h2>'+esc(text(prompt.cancel?(prompt.inPlace?'stopImportQuestion':'discardImportQuestion'):prompt.resume?'resumeImport':'import',{name:prompt.name??''}))+'</h2>'+(prompt.cancel?'<p>'+esc(text(prompt.inPlace?'stopImportDetail':'discardImportDetail'))+'</p>':'')+(!prompt.resume?input('importFolder','path','text','id="book-import-path" required autocomplete="off" spellcheck="false" value="'+esc(prompt.path??'')+'"')+'<button class="button" type="button" data-action="storage-browse" data-target="book-import-path">'+esc(text('choose'))+'</button>':'')+input('password','password','password','autocomplete="current-password" value="'+esc(prompt.draft?.password??'')+'"')+'<details><summary>'+esc(text('username'))+' / '+esc(text('recovery'))+'</summary>'+input('username','username','text','autocomplete="username" value="'+esc(prompt.draft?.username??'')+'"')+input('recovery','recovery','password','autocomplete="off"')+'</details><div class="inline-actions"><button class="button" type="button" data-action="lab-book-directory-import-dismiss" data-project="'+value.id+'">'+esc(text(prompt.cancel?'keepImport':'cancel'))+'</button><button class="button primary" type="submit">'+esc(text(prompt.cancel?(prompt.inPlace?'cancelImport':'discardImport'):prompt.resume?'resumeImport':'import'))+'</button></div></form>':'';
  }
  const list=host.querySelector('[data-imports]'),ids=new Set(value.items.map(item=>item.id));for(const card of list.children)if(!ids.has(card.dataset.importId))card.remove();
  for(const item of value.items){let card=list.querySelector('[data-import-id="'+item.id+'"]');if(!card){card=document.createElement('article');card.className='panel';card.dataset.importId=item.id;list.append(card);}
   const running=item.running||value.pending.has(item.id),cancelling=item.phase==='cancelling',button=(action,label)=>'<button class="button" data-action="lab-book-directory-import-'+action+'" data-project="'+value.id+'" data-id="'+item.id+'">'+esc(text(label))+'</button>';
   const controls=running?'':cancelling?button('cancel','finishCancellation'):button('resume','resumeImport')+(item.cancellable?button('cancel','cancelImport'):'');
   const content='<div data-owned-operation="'+url(value)+'" data-operation-id="'+item.id+'"><div data-owned-operation="'+url(value)+'/resume" data-operation-id="'+item.id+'"><div data-owned-operation="'+url(value)+'/cancel" data-operation-id="'+item.id+'"><h2>'+esc(text(cancelling?'cancellingImport':'importing',{name:item.name}))+'</h2>'+controls+'</div></div></div>';if(card.dataset.content!==content){card.dataset.content=content;card.innerHTML=content;}
  }
  host.querySelector('[data-import-more]').hidden=!value.next;
 }
 async function load(value,more=false){
  if(value.loading)return;value.loading=true;const token=generation;
  try{const result=await api(url(value)+'/pending',{after:more?value.next:null,limit:20},{adopt:false});if(!current(token))return;
   const finished=!more&&value.items.some(item=>!value.pending.has(item.id)&&!result.items.some(next=>next.id===item.id));
   value.items=more?[...value.items,...result.items]:result.items;value.next=result.next;value.loaded=true;if(finished){await refreshDirectory(value.id);changed();}
  }catch(error){if(current(token))value.error=error.message??text('failed');}
  finally{if(current(token)){value.loading=false;paint(value);}}
 }
 async function run(value,request,resume,cancel=false){
  if(value.pending.has(request.id))return;let succeeded=false;const token=generation,view=location.hash;value.pending.add(request.id);value.error='';value.complete=false;const prompt={...value.prompt,path:request.path,username:request.username};value.prompt=null;
  if(!value.items.some(item=>item.id===request.id))value.items.push({id:request.id,name:(request.path??'').split(/[\\/]/).filter(Boolean).at(-1),running:true});paint(value);
  try{const result=await access(()=>api(url(value)+(cancel?'/cancel':resume?'/resume':''),request,{adopt:false,view}));if(current(token)){succeeded=result.cancelled?'cancelled':true;await refreshDirectory(value.id);}}
  catch(error){if(current(token)){value.error=error.name==='AbortError'?'':error.message??text('failed');value.prompt=prompt;}}
  finally{if(current(token)){value.pending.delete(request.id);await load(value);value.complete=succeeded;if(value.prompt&&value.items.some(item=>item.id===request.id))value.prompt=value.items.find(item=>item.id===request.id).phase==='cancelling'?null:{...value.prompt,resume:true};paint(value);}}
 }
 document.addEventListener('input',event=>{const form=event.target.closest?.('[data-book-import-form]');if(!form)return;const value=page(form.dataset.project),prompt=value.prompt;if(!prompt)return;const field=event.target.name;if(field==='path')prompt.path=event.target.value;else if(['username','password','recovery'].includes(field)){prompt.draft??={};prompt.draft[field]=event.target.value;}});
 setInterval(()=>{sync();if(!visible)return;const value=page(visible);if(!value.pending.size&&value.items.some(item=>item.running))void load(value);},1500);
 return {
  hidden:projectId=>new Set(page(projectId).items.map(item=>item.labBookId).filter(Boolean)),
  view:projectId=>'<section data-book-import="'+projectId+'"><button class="button" data-action="lab-book-directory-import-start" data-project="'+projectId+'">'+esc(text('import'))+'</button><p data-import-error role="alert" hidden></p><p data-import-complete role="status" hidden>'+esc(text('imported'))+'</p><div data-import-form></div><div data-imports></div><button class="button" data-import-more data-action="lab-book-directory-import-more" data-project="'+projectId+'" hidden>'+esc(text('moreImports'))+'</button></section>',
  bind(){sync();const id=state.page==='project'&&!state.access?.locked&&!state.storageUnavailable?state.projectOwner?.projectId:null,entered=id!==visible;visible=id;if(id){const value=page(id);paint(value);if(entered||!value.loaded)void load(value);}},
  async action(node){const {action,project,id}=node.dataset;if(!action?.startsWith('lab-book-directory-import-'))return false;const value=page(project);
   if(action.endsWith('-start')){value.error='';value.complete=false;value.prompt={id:crypto.randomUUID(),resume:false};paint(value);document.getElementById('book-import-path')?.focus();}
   else if(action.endsWith('-dismiss')){value.prompt=null;paint(value);}
   else if(action.endsWith('-more'))await load(value,true);
   else if(action.endsWith('-resume')||action.endsWith('-cancel')){const item=value.items.find(item=>item.id===id);if(action.endsWith('-cancel')&&item?.phase==='cancelling'){await run(value,{id,username:'',password:'',recovery:''},true,true);return true;}value.prompt={id,resume:true,cancel:action.endsWith('-cancel'),inPlace:item?.inPlace,name:item?.name};paint(value);document.querySelector('[data-book-import-form] [name=password]')?.focus();}return true;
  },
  async submit(form){if(!form.hasAttribute('data-book-import-form'))return false;const value=page(form.dataset.project),prompt=value.prompt;if(!prompt)return true;const request={id:prompt.id,username:form.elements.username.value,password:form.elements.password.value,recovery:form.elements.recovery.value,...(!prompt.resume?{path:form.elements.path.value}:{})};await run(value,request,prompt.resume,prompt.cancel);return true;}
 };
}
