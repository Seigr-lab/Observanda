import {labBookImportUI} from './lab-book-import-ui.js';
import {labBookMoveRecoveryUI} from './lab-book-move-recovery-ui.js';
import {labBookCreationRecoveryUI} from './lab-book-creation-recovery-ui.js';
import {labBookDeletionUI} from './lab-book-deletion-ui.js';
import {t} from './i18n/index.js';
const text=key=>t('labBookDirectory',key);
// A project lists book identities and names without opening sibling databases.
export function labBookDirectory({state,api,esc,changed,access=operation=>operation()}){
 const imports=labBookImportUI({state,api,esc,access,changed,refreshDirectory:projectId=>load(page(projectId))});
 const moves=labBookMoveRecoveryUI({state,api,esc,access,changed,refreshDirectory:projectId=>load(page(projectId))});
 const creations=labBookCreationRecoveryUI({state,api,esc,refreshDirectory:projectId=>load(page(projectId))});
 const deletions=labBookDeletionUI({state,api,esc,changed,refreshDirectory:projectId=>load(page(projectId))});
 let context=state.storage?.contextId,pages=new Map(),generation=0;
 function sync(){if(context!==state.storage?.contextId){context=state.storage?.contextId;pages=new Map();generation++;}}
 function page(projectId){sync();if(!pages.has(projectId))pages.set(projectId,{projectId,items:[],next:null,total:null,revision:null,loaded:false,loading:false,error:''});return pages.get(projectId);}
 async function load(value,{more=false}={}){
  if(value.loading)return;const captured=generation;value.loading=true;value.error='';
  try{
   const result=await api('/api/projects/'+value.projectId+'/lab-books/list',{after:more?value.next:null,limit:50,revision:more?value.revision:null},{adopt:false});
   sync();if(captured!==generation)return;
   value.items=more?[...value.items,...result.items]:result.items;value.next=result.next;value.total=result.total;value.revision=result.revision;value.loaded=true;
  }catch(error){if(captured===generation)value.error=error.message??text('failed');}
  finally{if(captured===generation){value.loading=false;changed();}}
 }
 function entries(){sync();return [...pages.values()].flatMap(value=>value.items.filter(entry=>!deletions.hidden(value.projectId).has(entry.labBookId)&&!moves.hidden(value.projectId).has(entry.labBookId)&&!imports.hidden(value.projectId).has(entry.labBookId)).map(entry=>({...entry,projectId:value.projectId})));}
 return {
  deleteBook:(projectId,item)=>deletions.start(projectId,item),
  entries,owner(id){const entry=entries().find(entry=>entry.labBookId===id);return entry?{projectId:entry.projectId,labBookId:id}:null;},
  navigation(book){const combined=new Map(book.notebooks.map(n=>[n.id,n]));for(const entry of entries())if(!combined.has(entry.labBookId))combined.set(entry.labBookId,{id:entry.labBookId,projectId:entry.projectId,title:entry.directory,dedicated:true});return {...book,notebooks:[...combined.values()]};},
  view(projectId){const value=page(projectId);return imports.view(projectId)+creations.view(projectId)+deletions.view(projectId)+moves.view(projectId)+'<div data-lab-book-directory="'+projectId+'"><div class="notebook-grid">'+value.items.filter(entry=>!deletions.hidden(projectId).has(entry.labBookId)&&!moves.hidden(projectId).has(entry.labBookId)&&!imports.hidden(projectId).has(entry.labBookId)).map(entry=>'<article class="panel project-notebook"><p class="scope-kicker">' +esc(text('kind'))+'</p><h2><button class="text-button" data-action="filter-notebook" data-id="'+entry.labBookId+'">'+esc(entry.directory)+'</button></h2><div class="inline-actions"><button class="button" data-action="filter-notebook" data-id="'+entry.labBookId+'">'+esc(text('open'))+'</button><button class="button" data-action="edit-notebook" data-id="'+entry.labBookId+'">'+esc(text('settings'))+'</button></div></article>').join('')+'</div>'+
   (value.error?'<p role="alert">'+esc(value.error)+'</p><button class="button" data-action="lab-book-directory-retry" data-project="'+projectId+'">'+esc(text('retry'))+'</button>':value.loading?'<p role="status">'+esc(text('loading'))+'</p>':value.loaded&&!value.total?'<p class="muted">'+esc(text('empty'))+'</p>':'')+
   (value.next?'<button class="button" data-action="lab-book-directory-more" data-project="'+projectId+'" '+(value.loading?'disabled':'')+'>'+esc(text('more'))+'</button>':'')+'</div>';},
  submit:async form=>await imports.submit(form)||creations.submit(form),
  bind(){imports.bind();creations.bind();deletions.bind();moves.bind();sync();const id=state.projectOwner?.projectId;if(!id||state.access?.locked||state.storageUnavailable)return;const value=page(id);if(!value.loaded&&!value.loading&&!value.error)void load(value);},
  async refresh(projectId){await load(page(projectId));},
  async action(node){if(await imports.action(node)||await moves.action(node)||await creations.action(node)||await deletions.action(node))return true;if(!node.dataset.action?.startsWith('lab-book-directory-'))return false;await load(page(node.dataset.project),{more:node.dataset.action==='lab-book-directory-more'});return true;}
 };
}
