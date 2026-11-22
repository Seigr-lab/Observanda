import {projectWorkspaceTargetUI} from './project-workspace-target-ui.js';
import {localizedText} from './i18n/index.js';
const text=localizedText('projectStorage');
// Placement selects an owning parent. The server relocates the whole tree.
export function projectPlacementUI({state,api,esc,field,accessProject,projectDirectory,rootBook,finished,changed=()=>{}}){
 const entries=new Map();
 const key=id=>JSON.stringify([state.storage?.contextId,id]);
 const current=id=>entries.get(key(id));
 const host=entry=>entry?.context===state.storage?.contextId?document.querySelector('[data-project-placement="'+entry.id+'"]'):null;
 const targets=projectWorkspaceTargetUI({state,api,esc,field,current:entry=>current(entry.id)===entry,changed:paint,ready:entry=>{if(!entry.started){entry.parentId=entry.targetPath?'':'choose';entry.requestId=crypto.randomUUID();}}});
 // Workspace > Project > Lab book: a project moves to a workspace's top level, never inside another project.
 function options(entry){
  return '<option value="choose" disabled>'+esc(text('chooseParent'))+'</option>'+(entry.targetPath||entry.expectedParentId!==null?'<option value="">'+esc(entry.target?.title??rootBook().title)+'</option>':'');
 }
 function paint(entry){
  const node=host(entry);if(!node)return;
  node.innerHTML=entry.open?'<form id="project-placement-form" data-no-draft><h3>'+esc(text('move'))+'</h3><p>'+esc(text('moveTree'))+'</p>'+targets.view(entry)+'<fieldset '+(entry.busy||entry.targetBusy||entry.targetPath&&!entry.target?'disabled':'')+'>'+field(text('inside'),'<select name="parentId" '+(entry.started?'disabled':'')+'>'+options(entry)+'</select>')+'<button type="submit" class="button primary" '+(entry.parentId==='choose'?'disabled':'')+'>'+esc(text(entry.started?'resume':'move'))+'</button></fieldset><button type="button" class="button" data-action="project-storage-placement-cancel" '+(entry.busy?'disabled':'')+'>'+esc(text('cancel'))+'</button>'+(entry.busy?'<p role="status">'+esc(text('movingTree'))+'</p>':'')+(entry.error?'<p role="alert">'+esc(entry.error)+'</p>':'')+'</form>':entry.complete?'<p role="status">'+esc(text('movedTree'))+'</p>':'';
  node.hidden=!entry.open&&!entry.complete;if(entry.open)node.querySelector('[name=parentId]').value=entry.parentId;
 }
 return {
  busy:id=>!!current(id)?.busy,
  view:id=>'<section class="panel" data-project-placement="'+id+'" hidden></section>',
  bind(id){const entry=current(id);if(entry)paint(entry);},
  open(id,parentId){
   let entry=current(id);if(entry?.busy)return;
   entry={id,context:state.storage?.contextId,expectedParentId:parentId,parentId:'choose',open:true,busy:false,error:'',complete:false,requestId:crypto.randomUUID(),targetPath:'',target:null,workspaces:[]};entries.set(key(id),entry);paint(entry);void targets.load(entry);host(entry)?.querySelector('[name=parentId]')?.focus();
  },
  input(element){
   const node=element.closest('[data-project-placement]'),entry=node&&current(node.dataset.projectPlacement);if(!entry||entry.busy||entry.started)return false;
   if(element.name==='targetWorkspace'){entry.parentId='choose';void targets.select(entry,element.value);return true;}
   if(element.name!=='parentId')return false;entry.parentId=element.value;entry.requestId=crypto.randomUUID();entry.error='';node.querySelector('[type=submit]').disabled=entry.parentId==='choose';return true;
  },
  async action(node){
   if(node.dataset.action==='project-storage-target-unlock'){const entry=current(state.projectOwner?.projectId);if(entry)await targets.unlock(entry,node.closest('form'));return true;}
   if(node.dataset.action!=='project-storage-placement-cancel')return false;
   const entry=current(state.projectOwner?.projectId);if(entry&&!entry.busy){entry.open=false;void targets.release(entry);paint(entry);}return true;
  },
  async submit(form){
   if(form.id!=='project-placement-form')return false;
   const entry=current(form.closest('[data-project-placement]').dataset.projectPlacement);if(!entry||entry.busy||entry.parentId==='choose')return true;
   const view=location.hash,started=entry.started;entry.busy=true;entry.error='';paint(entry);changed(entry.id);
   try{
    entry.started=true;const result=await accessProject(()=>api('/api/projects/'+entry.id+'/storage/move',{id:entry.requestId,parentId:entry.parentId||null,expectedParentId:entry.expectedParentId,...(entry.target?{target:entry.target.id}:{})},{adopt:false,view}),targets.accessOptions(entry));
    entry.open=false;entry.complete=true;if(entry.context===state.storage?.contextId){await projectDirectory.refresh();await finished(entry.id,result,entry.targetPath);await targets.release(entry);}
   }catch(error){if(error.operationNotStarted===true)entry.started=false;else if(error.name==='AbortError')entry.started=started;entry.error=error.name==='AbortError'?'':error.message??text('moveFailed');if(error.code==='PROJECT_MOVE_DESTINATION_ACCESS'&&entry.targetPath){await targets.release(entry);entry.target=null;entry.targetAuth=true;}}
   finally{entry.busy=false;paint(entry);changed(entry.id);}return true;
  }
 };
}
