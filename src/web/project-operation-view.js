import {localizedText} from './i18n/index.js';
const text=localizedText('projectStorage');
// A relocating owner has no editable view until its folder handoff finishes.
// Progress lives in that owner's page and navigation stays in the workspace.
export function projectOperationView({state,esc,projectDirectory,restore,render}){
 let resuming=false;
 return {
  show(error,owner,route){
   if(error.code!=='STORAGE_RENAMING'||!owner?.projectId)return false;
   state.ownerOperation={projectId:owner.projectId,operationProjectId:error.projectId??owner.projectId,route};render();return true;
  },
  clear(){state.ownerOperation=null;},
  view(){
   const value=state.ownerOperation;if(!value)return null;
   const entry=projectDirectory.entries().find(item=>item.projectId===value.projectId);
   return '<div class="page-heading"><h1>'+esc(entry?.summary?.title??text('title'))+'</h1></div>'+['storage/move','directory/reparent','settings/save'].map(command=>'<section data-owned-operation="/api/projects/'+value.operationProjectId+'/'+command+'"></section>').join('');
  },
  async activity(snapshot){
   const value=state.ownerOperation;if(!value||resuming||snapshot.contextId!==state.storage?.contextId||location.hash!==value.route)return;
   if(snapshot.operations.some(item=>['running','queued'].includes(item.state)&&item.kind.startsWith('/api/projects/'+value.operationProjectId+'/')))return;
   resuming=true;try{await restore();}finally{resuming=false;}
  }
 };
}
