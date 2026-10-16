import {localizedText} from './i18n/index.js';
const text=localizedText('labBookStorage');
// Interrupted placements are shown with the books in their containing project.
// Listing them is read-only; resumption is an explicit owner command.
export function labBookMoveRecoveryUI({state,api,esc,access,changed,refreshDirectory}){
 let context,generation=0,visibleProject=null,pages=new Map();
 function sync(){if(context!==state.storage?.contextId){context=state.storage?.contextId;generation++;pages=new Map();visibleProject=null;}}
 function page(id){sync();if(!pages.has(id))pages.set(id,{id,items:[],next:null,loaded:false,loading:false,error:'',pending:new Set()});return pages.get(id);}
 const current=token=>token===generation&&context===state.storage?.contextId;
 function paint(value){
  const node=document.querySelector('[data-lab-book-moves="'+value.id+'"]');if(!node)return;node.hidden=!value.items.length&&!value.error&&!value.next;
  const content=(value.error?'<p role="alert">'+esc(value.error)+'</p><button class="button" data-action="lab-book-directory-move-refresh" data-project="'+value.id+'">'+esc(text('retry'))+'</button>':'')+value.items.map(item=>'<article class="panel"><h2>'+esc(text(['cancelling','cancelled'].includes(item.phase)?'moveCleanup':'moving',{name:item.name,project:item.projectName}))+'</h2>'+(item.running||value.pending.has(item.id)?'<p role="status">'+esc(text('moveWorking'))+'</p>':'<button class="button" data-action="lab-book-directory-move-resume" data-project="'+value.id+'" data-id="'+item.id+'">'+esc(text(['cancelling','cancelled'].includes(item.phase)?'resumeCleanup':'resumeMove'))+'</button>')+'</article>').join('')+(value.next?'<button class="button" data-action="lab-book-directory-move-more" data-project="'+value.id+'">'+esc(text('moreMoves'))+'</button>':'');
  if(node.dataset.content!==content){node.dataset.content=content;node.innerHTML=content;}
 }
 async function load(value,more=false){
  if(value.loading)return;value.loading=true;const token=generation;
  try{
   const result=await api('/api/projects/'+value.id+'/lab-books/move/pending',{after:more?value.next:null,limit:20},{adopt:false});if(!current(token))return;
   const before=value.items.map(item=>item.id).join(),finished=!more&&value.items.some(item=>!result.items.some(next=>next.id===item.id));
   value.items=more?[...value.items,...result.items]:result.items;value.next=result.next;value.loaded=true;value.error='';
   if(finished)await refreshDirectory(value.id);else if(before!==value.items.map(item=>item.id).join())changed();
  }catch(error){if(current(token))value.error=error.message??text('unavailable');}
  finally{if(current(token)){value.loading=false;paint(value);}}
 }
 async function resume(value,item){
  if(item.running||value.pending.has(item.id))return;const token=generation;value.pending.add(item.id);value.error='';paint(value);
  try{await access(()=>api('/api/projects/'+value.id+'/lab-books/'+item.labBookId+'/storage/move/resume',{id:item.id},{adopt:false,view:location.hash}));if(current(token)){await load(value);await refreshDirectory(item.sourceProjectId);await refreshDirectory(item.projectId);}}
  catch(error){if(current(token)){await load(value);if(current(token))value.error=error.name==='AbortError'?'':error.message??text('failed');}}
  finally{if(current(token)){value.pending.delete(item.id);paint(value);}}
 }
 setInterval(()=>{sync();if(!visibleProject)return;const value=page(visibleProject);if(!value.pending.size&&value.items.some(item=>item.running))void load(value);},1500);
 return {
  hidden:projectId=>new Set(page(projectId).items.map(item=>item.labBookId)),
  view:projectId=>'<section data-lab-book-moves="'+projectId+'" hidden></section>',
  bind(){sync();const id=state.page==='project'&&!state.access?.locked&&!state.storageUnavailable?state.projectOwner?.projectId:null,entered=id!==visibleProject;visibleProject=id;if(id){const value=page(id);paint(value);if(entered||!value.loaded)void load(value);}},
  async action(node){const {action,project,id}=node.dataset;if(!action?.startsWith('lab-book-directory-move-'))return false;const value=page(project);if(action.endsWith('-refresh')||action.endsWith('-more'))await load(value,action.endsWith('-more'));else{const item=value.items.find(item=>item.id===id);if(item)await resume(value,item);}return true;}
 };
}
