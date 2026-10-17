import {projectDirectoryChoices} from './project-directory-choices.js';
import {localizedText} from './i18n/index.js';
const text=localizedText('recordAuthoring');

// Directory reads choose an owner; the editor only opens that book afterwards.
export function recordDestinationUI({state,api,esc,field,showDialog,rootBook,access=operation=>operation(),selected}){
 let active=null,generation=0;
 const dialog=()=>document.getElementById('dialog');
 const host=()=>dialog()?.querySelector('[data-record-destination]');
 const choices=projectDirectoryChoices({state,api,esc,changed:()=>paintProjects()});
 function reset({cancel=true}={}){const previous=active;generation++;active?.controller?.abort();active=null;choices.reset();if(cancel)previous?.cancelled?.();}
 const current=(entry,request)=>active===entry&&entry.context===state.storage?.contextId&&entry.route===location.hash&&entry.request===request&&(entry.authorizing||!!host());
 const title=entry=>[...(entry.ancestors??[]),entry.summary?.title??entry.projectId].join(' / ');
 function projects(){
  const rows=[...choices.rows(active?.kind??'record-parents')];
  if(active?.projectId&&!rows.some(row=>row.projectId===active.projectId)){
   const chosen=choices.known(active.projectId)??active.initial;if(chosen)rows.unshift(chosen);
  }
  return rows;
 }
 function paintProjects(){
  const node=host();if(!node||!active)return;
  const select=node.querySelector('[name=recordProject]');
  select.innerHTML='<option value="">'+esc(text('chooseProject'))+'</option>'+projects().map(row=>'<option value="'+esc(row.projectId)+'">'+esc(title(row))+'</option>').join('');
  select.value=active.projectId??'';choices.paint(node,active.kind);
 }
 function paintBooks(){
  const node=host(),entry=active;if(!node||!entry)return;
  node.querySelector('[data-record-destination-books]').innerHTML=entry.items.filter(book=>!entry.filter||entry.filter(book,entry.projectId)).map(book=>'<button type="button" class="record-type-option" data-action="record-destination-book" data-id="'+esc(book.labBookId)+'"><strong>'+esc(book.directory)+'</strong></button>').join('');
  const status=node.querySelector('[data-record-destination-status]');
  status.textContent=entry.error||(entry.loading?text('loadingBooks'):entry.projectId&&!entry.items.some(book=>!entry.filter||entry.filter(book,entry.projectId))?text('noBooks'):'');status.setAttribute('role',entry.error?'alert':'status');
  const retry=node.querySelector('[data-action=record-destination-retry]');retry.hidden=!entry.error;retry.textContent=text(entry.locked?'unlockBooks':'retryBooks');retry.disabled=entry.loading;
  const more=node.querySelector('[data-action=record-destination-more]');more.hidden=!entry.next;more.disabled=entry.loading;
 }
 async function loadBooks({more=false,retry=true,authorize=false}={}){
  const entry=active;if(!entry)return;entry.controller?.abort();entry.controller=new AbortController();const request=++entry.request;
  const previousError=entry.error;entry.loading=true;entry.authorizing=authorize;entry.error='';if(!more){entry.items=[];entry.next=null;entry.revision=null;}paintBooks();
  try{
   if(!entry.projectId)return;
   const project=choices.known(entry.projectId)??entry.initial;
   if(project?.legacy){entry.items=rootBook().notebooks.filter(book=>book.projectId===entry.projectId).map(book=>({labBookId:book.id,directory:book.title})).sort((a,b)=>a.directory.localeCompare(b.directory));return;}
   const read=()=>api('/api/projects/'+entry.projectId+'/lab-books/list',{after:more?entry.next:null,limit:50,revision:more?entry.revision:null},{adopt:false,signal:entry.controller.signal});
   const result=await (authorize?access(read):read());
   if(!current(entry,request))return;
   entry.locked=false;entry.items=more?[...entry.items,...result.items]:result.items;entry.next=result.next;entry.revision=result.revision;
  }catch(error){
   if(!current(entry,request))return;if(error.name==='AbortError'){entry.error=previousError;return;}
   if(error.code==='CONFLICT'&&more&&retry)return loadBooks({retry:false});
   entry.locked=['ACCESS_LOCKED','ACCESS_DENIED','DEVICE_UNKNOWN'].includes(error.code);entry.error=error.message??text('booksFailed');
  }finally{if(current(entry,request)){if(authorize&&!host()){present();paintProjects();}entry.authorizing=false;entry.loading=false;paintBooks();}}
 }
 function present(){
  showDialog('<form data-no-draft data-record-destination><h2 id="dialog-title">'+esc(active.heading??text('chooseBook'))+'</h2>'+field(text('destinationProject'),'<select name="recordProject"></select>')+choices.view(active.kind)+'<div class="record-type-grid" data-record-destination-books></div><p data-record-destination-status role="status"></p><button type="button" class="button" data-action="record-destination-retry" hidden>'+esc(text('retryBooks'))+'</button><button type="button" class="button" data-action="record-destination-more" hidden>'+esc(text('moreBooks'))+'</button><div class="dialog-actions"><button type="button" class="button" data-action="close-dialog">'+esc(text('cancel'))+'</button></div></form>');
 }
 function open({heading,selected:onSelected,cancelled,filter,kind='record-parents'}={}){
  reset();const candidate=state.project??state.projectOwner?.projectId??null,id=kind==='book-parents'&&!state.projectOwner?null:candidate,project=state.book.projects.find(row=>row.id===id);
  active={heading,selected:onSelected,cancelled,filter,kind,context:state.storage?.contextId,route:location.hash,projectId:id,initial:project?{projectId:id,summary:{title:project.title},legacy:!state.projectOwner}:null,items:[],next:null,revision:null,request:0,loading:false,error:''};
  present();
  const opened=++generation;dialog().addEventListener('close',()=>{if(generation===opened&&!active?.authorizing&&!dialog().open)reset();},{once:true});
  choices.start(null,{recordParents:kind==='record-parents',bookParents:kind==='book-parents',templates:false});paintProjects();void loadBooks();
 }
 return {open,reset,
  input(element){if(!element.closest?.('[data-record-destination]'))return false;if(choices.input(element))return true;if(element.name!=='recordProject')return false;active.projectId=element.value||null;void loadBooks();return true;},
  async action(node){
   if(!node.closest?.('[data-record-destination]'))return false;
   if(await choices.action(node))return true;
   if(node.dataset.action==='record-destination-more'){if(!active.loading)await loadBooks({more:true});return true;}
   if(node.dataset.action==='record-destination-retry'){if(!active.loading)await loadBooks({authorize:active.locked});return true;}
   if(node.dataset.action!=='record-destination-book')return false;
   const entry=active,book=entry.items.find(book=>book.labBookId===node.dataset.id);if(!book||entry.loading||entry.filter&&!entry.filter(book,entry.projectId))return true;
   const project=choices.known(entry.projectId)??entry.initial,projectId=entry.projectId,choose=entry.selected??selected;reset({cancel:false});dialog().close();await choose(projectId,book.labBookId,project?.legacy===true,{...book,projectTitle:project?title(project):projectId});return true;
  }
 };
}
