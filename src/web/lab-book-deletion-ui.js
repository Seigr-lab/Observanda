import {t} from './i18n/index.js';
const text=(key,args)=>t('labBookDirectory',key,args);
// The containing project's book list owns deletion and its restart recovery.
export function labBookDeletionUI({state,api,esc,refreshDirectory,changed}){
 let context,generation=0,pages=new Map(),visibleProject=null;
 function sync(){if(context!==state.storage?.contextId){context=state.storage?.contextId;generation++;pages=new Map();visibleProject=null;}}
 function page(id){sync();if(!pages.has(id))pages.set(id,{id,items:[],next:null,loading:false,loaded:false,error:'',pending:new Map()});return pages.get(id);}
 const current=token=>token===generation&&context===state.storage?.contextId;
 function paint(value){
  const node=document.querySelector('[data-lab-book-deletions="'+value.id+'"]');if(!node)return;
  const items=new Map(value.items.map(item=>[item.id,item]));for(const [id,item] of value.pending)items.set(id,{...item,running:true});
  const content=(value.error?'<p role="alert">'+esc(value.error)+'</p><button class="button" data-action="lab-book-directory-delete-refresh" data-project="'+value.id+'">'+esc(text('retry'))+'</button>':'')+[...items.values()].map(item=>'<article class="panel" data-owned-operation="/api/projects/'+value.id+'/lab-books/'+item.labBookId+'/storage/delete"><div data-owned-operation="/api/projects/'+value.id+'/lab-books/'+item.labBookId+'/storage/delete/resume"><h2>'+esc(text('deleting',{name:item.name}))+'</h2>'+(item.running?'<p role="status">'+esc(text('deletingFiles'))+'</p>':'<button class="button" data-action="lab-book-directory-delete-resume" data-project="'+value.id+'" data-id="'+item.id+'">'+esc(text('finishDeleting'))+'</button>')+'</div></article>').join('')+(value.next?'<button class="button" data-action="lab-book-directory-delete-more" data-project="'+value.id+'">'+esc(text('moreDeletions'))+'</button>':'');
  node.hidden=!content;if(node.dataset.content!==content){node.dataset.content=content;node.innerHTML=content;}
 }
 async function load(value,more=false){
  if(value.loading)return;value.loading=true;const token=generation;value.error='';
  try{
   const result=await api('/api/projects/'+value.id+'/lab-books/delete/pending',{after:more?value.next:null,limit:20},{adopt:false});if(!current(token))return;
   const finished=!more&&value.items.some(item=>item.running&&!result.items.some(next=>next.id===item.id));
   const before=value.items.map(item=>item.labBookId).join();
   value.items=more?[...value.items,...result.items]:result.items;value.next=result.next;value.loaded=true;
   if(finished)await refreshDirectory(value.id);else if(before!==value.items.map(item=>item.labBookId).join())changed();
  }catch(error){if(current(token))value.error=error.message??text('deleteFailed');}
  finally{if(current(token)){value.loading=false;paint(value);}}
 }
 async function run(value,item,resume){
  if(value.pending.has(item.id))return;const token=generation;value.pending.set(item.id,item);value.error='';changed();paint(value);
  try{
   await api('/api/projects/'+value.id+'/lab-books/'+item.labBookId+'/storage/delete'+(resume?'/resume':''),{id:item.id,expectedName:item.name},{adopt:false});
   if(current(token)){value.items=value.items.filter(old=>old.id!==item.id);await refreshDirectory(value.id);}
  }catch(error){if(current(token)){await load(value);if(!current(token))return;value.error=error.message??text('deleteFailed');await refreshDirectory(value.id);}}
  finally{if(current(token)){value.pending.delete(item.id);changed();paint(value);}}
 }
 setInterval(()=>{sync();if(!visibleProject)return;const value=page(visibleProject);if(!value.pending.size&&value.items.some(item=>item.running))void load(value);},1500);
 return {
  hidden(projectId){const value=page(projectId);return new Set([...value.items,...value.pending.values()].map(item=>item.labBookId));},
  view:projectId=>'<section data-lab-book-deletions="'+projectId+'" hidden></section>',
  bind(){sync();const id=state.page==='project'&&!state.access?.locked&&!state.storageUnavailable?state.projectOwner?.projectId:null,entered=id!==visibleProject;visibleProject=id;if(id){const value=page(id);paint(value);if(entered||!value.loaded)void load(value);}},
  start(projectId,item){return run(page(projectId),item,false);},
  async action(node){const {action,project,id}=node.dataset;if(!action?.startsWith('lab-book-directory-delete-'))return false;const value=page(project);
   if(action.endsWith('-refresh')||action.endsWith('-more'))await load(value,action.endsWith('-more'));
   else{const item=value.items.find(item=>item.id===id);if(item&&!item.running)await run(value,item,true);}return true;
  }
 };
}
