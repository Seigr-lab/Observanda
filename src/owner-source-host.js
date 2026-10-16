import {AppError} from './errors.js';
import {researchId} from './web/research-reference.js';
import {LabBookDirectory} from './lab-book-directory.js';
// Namespace validation is shared by discovery and selected-source readers.
export async function ownerSourceHost(application,{workspaceId,scope=null,labBookId=null}){
 if(!researchId(workspaceId)||scope!==null&&!researchId(scope)||labBookId!==null&&!researchId(labBookId))throw new AppError('INVALID');
 const registry=await application.registry(),directory=await registry.read(),host=scope?directory.value.projects.find(project=>project.projectId===scope):null;
 if(scope&&!host)throw new AppError('NOT_FOUND');
 const book=labBookId?await new LabBookDirectory(registry).locate(workspaceId):null;
 if(labBookId?(!scope||!book||book.projectId!==scope||book.labBookId!==labBookId):workspaceId!==(host?.namespaceId??registry.workspaceId))throw new AppError('WORKSPACE_CHANGED');
 return {registry,directory};
}
