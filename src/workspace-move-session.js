import {ProjectLocationAccess} from './project-location-access.js';
import {WorkspaceProjectMove} from './workspace-project-move.js';
// Keep independently authenticated project grants through workspace activation.
export async function withWorkspaceMoveSession(application,client,operation,options={}){
 const access=new ProjectLocationAccess(application,client,options),bundle=new WorkspaceProjectMove(application.workspace,{...options,beforeMove:id=>application.jobs.invalidateProject(id),withProject:(id,use)=>access.withProject(id,use),withBook:(project,id,use)=>access.withBook(project,id,use),onCopiedBook:book=>access.books.copied(book),onMovedProject:(storage,source,entry)=>access.moved(storage,source,entry)});
 try{return await operation({move:(input,{activate})=>bundle.run(input,{activate:async(destination,source)=>{await access.seal(destination);await activate(destination,source);}}),install:target=>access.install(target,client)});}
 finally{await access.close();}
}
