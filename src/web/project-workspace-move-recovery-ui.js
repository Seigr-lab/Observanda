import {localizedText} from './i18n/index.js';
import {projectWorkspaceTargetUI} from './project-workspace-target-ui.js';
const text=localizedText('projectStorage');
export function projectWorkspaceMoveRecoveryUI({state,api,esc,field,accessProject,refreshDirectory}){
 let context,items=[],next=null,loading=false,loaded=false,visibleBefore=false,error='',notice=null;
 const visible=()=>state.page==='projects'&&!state.access?.locked&&!state.storageUnavailable;
 const host=()=>visible()?document.querySelector('[data-project-workspace-moves]'):null;
 function sync(){if(context!==state.storage?.contextId){context=state.storage?.contextId;items=[];next=null;loading=loaded=visibleBefore=false;error='';notice=null;}}
 const targets=projectWorkspaceTargetUI({state,api,esc,field,current:entry=>items.includes(entry),changed:paint,ready:()=>{}});
 function paint(){
  const node=host();if(!node)return;node.hidden=!items.length&&!error&&!notice;
  const content=(notice?'<p role="status">'+esc(text('movedToWorkspace',{title:notice.title}))+'</p><button class="button" data-action="storage-open-recent" data-path="'+esc(notice.path)+'">'+esc(text('openDestination'))+'</button>':'')+(error?'<p role="alert">'+esc(error)+'</p><button class="button" data-action="project-workspace-moves-refresh">'+esc(text('retry'))+'</button>':'')+
   items.map(entry=>'<form class="panel" id="project-workspace-move-'+entry.id+'" data-no-draft data-move="'+entry.id+'"><h2>'+esc(text('pendingWorkspaceMove',{title:entry.title}))+'</h2>'+targets.view(entry,{fixed:true})+(entry.running||entry.busy?'<p role="status">'+esc(text('movingTree'))+'</p>':'<button type="button" class="button" data-action="project-workspace-moves-resume" '+(entry.targetBusy?'disabled':'')+'>'+esc(text('resume'))+'</button>')+'<section data-owned-operation="/api/projects/'+entry.projectId+'/storage/move" data-operation-id="'+entry.id+'"></section></form>').join('')+(next?'<button class="button" data-action="project-workspace-moves-more">'+esc(text('moreMoves'))+'</button>':'');
  if(node.dataset.content!==content){node.dataset.content=content;node.innerHTML=content;}
 }
 async function load(more=false){
  sync();if(loading)return;loading=true;const selected=context;
  try{const result=await api('/api/projects/move/pending',{after:more?next:null,limit:20},{adopt:false});if(selected!==state.storage?.contextId)return;
   const previous=new Map(items.map(entry=>[entry.id,entry])),rows=result.items.map(item=>Object.assign(previous.get(item.id)??{context:selected,target:null,targetPath:item.path,targetTitle:item.targetTitle},item));items=more?[...items,...rows]:rows;next=result.next;loaded=true;error='';
   const finished=[...previous.values()].find(entry=>entry.running&&!items.includes(entry));if(finished){notice={path:finished.path,title:finished.targetTitle};await refreshDirectory();}
  }catch(e){if(selected===state.storage?.contextId)error=e.message;}
  finally{if(selected===state.storage?.contextId){loading=false;paint();}}
 }
 async function run(entry){
  if(entry.busy||entry.running)return;entry.busy=true;error='';paint();
  try{
   if(!entry.target)await targets.open(entry);if(!entry.target)return;
   const result=await accessProject(()=>api('/api/projects/'+entry.projectId+'/storage/move',{id:entry.id,target:entry.target.id,parentId:entry.parentId,expectedParentId:entry.expectedParentId},{adopt:false,view:'#/projects'}),targets.accessOptions(entry));
   if(context!==state.storage?.contextId)return;notice={path:entry.path,title:entry.target.title};await targets.release(entry);await refreshDirectory();await load();
  }catch(e){if(e.name!=='AbortError'){error=e.message;if(e.code==='PROJECT_MOVE_DESTINATION_ACCESS'){await targets.release(entry);entry.target=null;entry.targetAuth=true;}}}
  finally{entry.busy=false;paint();}
 }
 setInterval(()=>{sync();if(visible()&&items.some(entry=>entry.running)&&!items.some(entry=>entry.busy))void load();},1500);
 return {
  view:()=>'<section data-project-workspace-moves hidden></section>',
  bind(){sync();const shown=visible(),entered=shown&&!visibleBefore;visibleBefore=shown;if(shown){if(!loading&&(entered||!loaded))void load();else paint();}},
  completed(result,path){sync();notice={path,title:path.split(/[\\/]/).at(-1)};paint();},
  async action(node){const form=node.closest('[data-move]'),entry=items.find(item=>item.id===form?.dataset.move);
   if(node.dataset.action==='project-storage-target-unlock'&&entry){await targets.unlock(entry,form);if(entry.target)await run(entry);return true;}
   if(!node.dataset.action?.startsWith('project-workspace-moves-'))return false;
   if(node.dataset.action==='project-workspace-moves-refresh'||node.dataset.action==='project-workspace-moves-more'){await load(node.dataset.action.endsWith('-more'));return true;}if(entry)await run(entry);return true;
  },
  async submit(form){if(!form.id.startsWith('project-workspace-move-'))return false;const entry=items.find(item=>item.id===form.dataset.move);if(entry&&!entry.busy){if(entry.targetAuth)await targets.unlock(entry,form);if(entry.target)await run(entry);}return true;}
 };
}
