import {projectDirectoryChoices} from './project-directory-choices.js';
import {localizedText} from './i18n/index.js';
const text=localizedText('projectStorage');
// Placement selects an owning parent. The server relocates the whole tree.
export function projectPlacementUI({state,api,esc,field,accessProject,projectDirectory,rootBook,finished,changed=()=>{}}){
 const entries=new Map();let active=null;
 const key=id=>JSON.stringify([state.storage?.contextId,id]);
 const current=id=>entries.get(key(id));
 const host=entry=>entry?.context===state.storage?.contextId?document.querySelector('[data-project-placement="'+entry.id+'"]'):null;
 const choices=projectDirectoryChoices({state,api,esc,changed:()=>paintChoices()});
 function options(entry){
  const rows=choices.rows('parents').filter(row=>row.projectId!==entry.expectedParentId);
  if(entry.parentId&&entry.parentId!=='choose'&&!rows.some(row=>row.projectId===entry.parentId)){
   const selected=choices.known(entry.parentId);if(selected)rows.unshift(selected);
  }
  return '<option value="choose" disabled>'+esc(text('chooseParent'))+'</option>'+(entry.expectedParentId!==null?'<option value="">'+esc(rootBook().title)+'</option>':'')+rows.map(row=>'<option value="'+row.projectId+'">'+esc(row.summary?.title??row.projectId)+'</option>').join('');
 }
 function paintChoices(){
  const entry=active,node=host(entry);if(!node||!entry.open)return;
  const select=node.querySelector('[name=parentId]');if(!select)return;
  select.innerHTML=options(entry);select.value=entry.parentId;choices.paint(node,'parents');
 }
 function paint(entry){
  const node=host(entry);if(!node)return;
  node.innerHTML=entry.open?'<form id="project-placement-form" data-no-draft><h3>'+esc(text('move'))+'</h3><p>'+esc(text('moveTree'))+'</p><fieldset '+(entry.busy?'disabled':'')+'>'+field(text('inside'),'<select name="parentId">'+options(entry)+'</select>')+choices.view('parents')+'<div class="inline-actions"><button type="button" class="button" data-action="project-storage-placement-cancel">'+esc(text('cancel'))+'</button><button type="submit" class="button primary" '+(entry.parentId==='choose'?'disabled':'')+'>'+esc(text('move'))+'</button></div></fieldset>'+(entry.busy?'<p role="status">'+esc(text('movingTree'))+'</p>':'')+(entry.error?'<p role="alert">'+esc(entry.error)+'</p>':'')+'</form>':entry.complete?'<p role="status">'+esc(text('movedTree'))+'</p>':'';
  node.hidden=!entry.open&&!entry.complete;if(entry.open){node.querySelector('[name=parentId]').value=entry.parentId;choices.paint(node,'parents');}
 }
 return {
  busy:id=>!!current(id)?.busy,
  view:id=>'<section class="panel" data-project-placement="'+id+'" hidden></section>',
  bind(id){const entry=current(id);if(entry){active=entry;paint(entry);}},
  open(id,parentId){
   let entry=current(id);if(entry?.busy)return;
   entry={id,context:state.storage?.contextId,expectedParentId:parentId,parentId:'choose',open:true,busy:false,error:'',complete:false,requestId:crypto.randomUUID()};entries.set(key(id),entry);active=entry;choices.reset();paint(entry);choices.start(id,{parents:true,templates:false});host(entry)?.querySelector('[name=parentId]')?.focus();
  },
  input(element){
   const node=element.closest('[data-project-placement]'),entry=node&&current(node.dataset.projectPlacement);if(!entry||entry.busy)return false;
   active=entry;if(choices.input(element))return true;
   if(element.name!=='parentId')return false;entry.parentId=element.value;entry.requestId=crypto.randomUUID();entry.error='';node.querySelector('[type=submit]').disabled=entry.parentId==='choose';return true;
  },
  async choiceAction(node){if(!node.closest?.('[data-project-placement]'))return false;return choices.action(node);},
  async action(node){
   if(node.dataset.action!=='project-storage-placement-cancel')return false;
   const entry=current(state.projectOwner?.projectId);if(entry&&!entry.busy){entry.open=false;choices.reset();paint(entry);}return true;
  },
  async submit(form){
   if(form.id!=='project-placement-form')return false;
   const entry=current(form.closest('[data-project-placement]').dataset.projectPlacement);if(!entry||entry.busy||entry.parentId==='choose')return true;
   const view=location.hash;entry.busy=true;entry.error='';paint(entry);changed(entry.id);
   try{
    await accessProject(()=>api('/api/projects/'+entry.id+'/storage/move',{id:entry.requestId,parentId:entry.parentId||null,expectedParentId:entry.expectedParentId},{adopt:false,view}));
    entry.open=false;entry.complete=true;if(entry.context===state.storage?.contextId){await projectDirectory.refresh();await finished(entry.id);}
   }catch(error){entry.error=error.name==='AbortError'?'':error.message??text('moveFailed');}
   finally{entry.busy=false;paint(entry);changed(entry.id);}return true;
  }
 };
}
