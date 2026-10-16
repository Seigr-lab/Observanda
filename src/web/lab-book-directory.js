import {labBookImportUI} from './lab-book-import-ui.js';
import {labBookMoveRecoveryUI} from './lab-book-move-recovery-ui.js';
import {labBookCreationRecoveryUI} from './lab-book-creation-recovery-ui.js';
import {labBookDeletionUI} from './lab-book-deletion-ui.js';
import {labBookDirectoryState} from './lab-book-directory-state.js';
import {placeAt,updateText,updateProperty} from './progress-dom.js';
import {t} from './i18n/index.js';
const text=key=>t('labBookDirectory',key);
// A project lists book identities and names without opening sibling databases.
export function labBookDirectory({state,api,esc,changed,directoryChanged=changed,access=operation=>operation()}){
 const cache=labBookDirectoryState({state,api,changed:projectId=>{paint(projectId);directoryChanged();}});
 const refreshDirectory=projectId=>cache.refresh(projectId);
 const imports=labBookImportUI({state,api,esc,access,changed,refreshDirectory});
 const moves=labBookMoveRecoveryUI({state,api,esc,access,changed,refreshDirectory});
 const creations=labBookCreationRecoveryUI({state,api,esc,refreshDirectory});
 const deletions=labBookDeletionUI({state,api,esc,changed,refreshDirectory});
 const hidden=projectId=>new Set([...deletions.hidden(projectId),...moves.hidden(projectId),...imports.hidden(projectId)]);
 const items=projectId=>{const excluded=hidden(projectId);return cache.page(projectId).items.filter(entry=>!excluded.has(entry.labBookId));};
 function card(entry){return '<article class="panel project-notebook" data-directory-book="'+entry.labBookId+'"><p class="scope-kicker">'+esc(text('kind'))+'</p><h2><button class="text-button" data-action="filter-notebook" data-id="'+entry.labBookId+'">'+esc(entry.directory)+'</button></h2><div class="inline-actions"><button class="button" data-action="filter-notebook" data-id="'+entry.labBookId+'">'+esc(text('open'))+'</button><button class="button" data-action="edit-notebook" data-id="'+entry.labBookId+'">'+esc(text('settings'))+'</button></div></article>';}
 function paint(projectId){
  const host=document.querySelector('[data-lab-book-directory="'+projectId+'"]');if(!host)return;
  const value=cache.page(projectId),rows=items(projectId),ids=new Set(rows.map(entry=>entry.labBookId)),grid=host.querySelector('.notebook-grid'),focused=host.contains(document.activeElement)?document.activeElement:null;
  for(const node of [...grid.children])if(!ids.has(node.dataset.directoryBook))node.remove();
  rows.forEach((entry,index)=>{let node=grid.querySelector('[data-directory-book="'+entry.labBookId+'"]');if(!node){const template=document.createElement('template');template.innerHTML=card(entry);node=template.content.firstElementChild;}else updateText(node.querySelector('h2 button'),entry.directory);placeAt(grid,node,index);});
  const error=host.querySelector('[data-directory-error]');updateText(error,value.error);updateProperty(error,'hidden',!value.error);
  updateProperty(host.querySelector('[data-action="lab-book-directory-retry"]'),'hidden',!value.error);
  updateProperty(host.querySelector('[data-directory-loading]'),'hidden',!value.loading);
  updateProperty(host.querySelector('[data-directory-empty]'),'hidden',!value.loaded||!!value.total||!!value.error||value.loading);
  const more=host.querySelector('[data-action="lab-book-directory-more"]');updateProperty(more,'hidden',!value.next);updateProperty(more,'disabled',value.loading);
  if(focused?.isConnected&&document.activeElement!==focused&&!focused.disabled)focused.focus({preventScroll:true});
 }
 function entries(){return cache.entries().filter(entry=>!hidden(entry.projectId).has(entry.labBookId));}
 return {
  deleteBook:(projectId,item)=>deletions.start(projectId,item),
  entries,owner(id){const entry=entries().find(entry=>entry.labBookId===id);return entry?{projectId:entry.projectId,labBookId:id}:null;},
  navigation(book){const combined=new Map(book.notebooks.map(n=>[n.id,n]));for(const entry of entries())if(!combined.has(entry.labBookId))combined.set(entry.labBookId,{id:entry.labBookId,projectId:entry.projectId,title:entry.directory,dedicated:true});return {...book,notebooks:[...combined.values()]};},
  view(projectId){const value=cache.page(projectId);return imports.view(projectId)+creations.view(projectId)+deletions.view(projectId)+moves.view(projectId)+'<div data-lab-book-directory="'+projectId+'"><div class="notebook-grid">'+items(projectId).map(card).join('')+'</div>'+
   '<p role="alert" data-directory-error '+(value.error?'':'hidden')+'>'+esc(value.error)+'</p><button class="button" data-action="lab-book-directory-retry" data-project="'+projectId+'" '+(value.error?'':'hidden')+'>'+esc(text('retry'))+'</button><p role="status" data-directory-loading '+(value.loading?'':'hidden')+'>'+esc(text('loading'))+'</p><p class="muted" data-directory-empty '+(value.loaded&&!value.total&&!value.error&&!value.loading?'':'hidden')+'>'+esc(text('empty'))+'</p>'+
   '<button class="button" data-action="lab-book-directory-more" data-project="'+projectId+'" '+(value.loading?'disabled ':'')+(value.next?'':'hidden')+'>'+esc(text('more'))+'</button></div>';},
  submit:async form=>await imports.submit(form)||creations.submit(form),
  bind(){imports.bind();creations.bind();deletions.bind();moves.bind();void cache.bind();},
  refresh:refreshDirectory,activity:snapshot=>cache.activity(snapshot),
  async action(node){if(await imports.action(node)||await moves.action(node)||await creations.action(node)||await deletions.action(node))return true;if(!node.dataset.action?.startsWith('lab-book-directory-'))return false;await (node.dataset.action==='lab-book-directory-more'?cache.more(node.dataset.project):refreshDirectory(node.dataset.project));return true;}
 };
}
