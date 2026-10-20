import {ScopedLocationAccess} from './scoped-location-access.js';
import {WorkspaceProjectMove} from './workspace-project-move.js';
// Keep independently authenticated project grants through workspace activation.
export async function withWorkspaceMoveSession(application,client,operation,options={}){
 return ScopedLocationAccess.run(application,client,{...options,copy:true},async access=>{
  const grants=access.copy,bundle=new WorkspaceProjectMove(application.workspace,{...options,beforeMove:id=>application.jobs.invalidateProject(id),withProject:(id,use)=>access.withProject(id,use),withBook:(project,id,use)=>access.withBook(project,id,use),onCopiedBook:book=>grants.copiedBook(book),onMovedProject:(storage,source,entry)=>grants.moved(storage,source,entry)});
  return operation({move:async(input,{activate})=>{await grants.prepareMove(input);return bundle.run(input,{activate:async(destination,source)=>{await grants.seal(destination);await activate(destination,source);}});},install:target=>access.install(target,client)});
 });
}
