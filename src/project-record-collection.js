import {LabBookDirectory} from './lab-book-directory.js';
import {projectCollectionScope} from './project-collection-scope.js';
// Scope discovery uses the workspace directory and each project's book
// directory. Every catalogue is authenticated through its own access owner.
import {readFile} from 'node:fs/promises';
import {digest} from './storage-format.js';
import {ProjectSessionOwner} from './project-session-owner.js';
import {LabBookRegistry} from './lab-book-registry.js';
import {LabBookRouter} from './lab-book-router.js';
import {LabBookAccessSession} from './lab-book-access-session.js';
import {readAccess} from './access.js';
import {clearVault} from './encryption.js';
import {AppError} from './errors.js';
const fingerprint=async file=>{try{return digest(await readFile(file));}catch(error){if(error.code==='ENOENT')return null;throw error;}};
const accessCodes=new Set(['ACCESS_LOCKED','ACCESS_DENIED','ACCESS_WAIT','AUTH','DEVICE_UNKNOWN']);
const unavailableCodes=new Set([...accessCodes,'STORAGE_PROJECT_BUSY','LAB_BOOK_IMPORT_PENDING','STORAGE_INCOMPLETE']);
export function projectRecordCollection(application,client,check){
 return async(consume,{workspaceId,query,scope,signal,selection=null,namespaces=null,includeBooks=true,includeOwner=()=>true,onUnavailable=null})=>{
  const registry=await application.registry(),directory=await registry.read(),projects=directory.value.projects;
  const root=scope?projects.find(p=>p.projectId===scope):null;
  if(scope&&!root)throw new AppError('NOT_FOUND');
  if(workspaceId!==(root?.namespaceId??registry.workspaceId))throw new AppError('WORKSPACE_CHANGED');
  const below=(entry,id)=>{const visited=new Set();while(entry){if(entry.projectId===id)return true;if(visited.has(entry.projectId))throw new AppError('FORMAT');visited.add(entry.projectId);entry=projects.find(p=>p.projectId===entry.parentId);}return false;};
  const selectedScope=selection?projectCollectionScope(await registry.hierarchy(directory.value),{scope,selection}):null;
  const chosen=query?.projectId??scope,registered=chosen?projects.find(p=>p.projectId===chosen):null;
  if(scope&&chosen!==scope&&(!registered||!below(registered,scope)))throw new AppError('RECORD_VIEW_SCOPE');
  let namespaceProjects=null;if(namespaces){namespaceProjects=new Set();for(const id of namespaces){const project=projects.find(entry=>entry.namespaceId===id);if(project)namespaceProjects.add(project.projectId);else if(id!==registry.workspaceId){const book=await new LabBookDirectory(registry).read(id);if(book)namespaceProjects.add(book.projectId);}}}
  const selected=projects.filter(entry=>!namespaceProjects||namespaceProjects.has(entry.projectId)).filter(entry=>selectedScope?selectedScope.projectIds.has(entry.projectId):!chosen||registered&&below(entry,chosen)).sort((a,b)=>a.namespaceId<b.namespaceId?-1:a.namespaceId>b.namespaceId?1:0);
  const checks=[];
  await check();signal?.throwIfAborted();
  const includeRoot=selectedScope?[...selectedScope.projectIds].some(id=>id===null||!projects.some(project=>project.projectId===id)):!scope&&(!chosen||!registered);
  if(includeRoot&&includeOwner({workspaceId:registry.workspaceId,projectId:null,labBookId:null})&&(!namespaces||namespaces.has(registry.workspaceId)))await consume(application.workspace,{workspaceId:registry.workspaceId,projectId:null,labBookId:null},selectedScope??chosen);
  for(const entry of selected){
   signal?.throwIfAborted();await check();
   await application.tracked(async()=>{
    const owner=new ProjectSessionOwner(application,client,entry.projectId,{check,recoverRenames:false});let admitted=false;
    const unavailable=async(error,address)=>{if(!onUnavailable||!unavailableCodes.has(error.code))return false;await check();await onUnavailable(error,address);return true;};
    try{
     await owner.use(async project=>{
      admitted=true;
      const books=new LabBookRegistry(project),before=await books.read(),stamp=await fingerprint(books.file),current=()=>owner.check();
      if(includeOwner({workspaceId:entry.namespaceId,projectId:entry.projectId,labBookId:null})&&(!namespaces||namespaces.has(entry.namespaceId)))await consume(project,{workspaceId:entry.namespaceId,projectId:entry.projectId,labBookId:null,projectTitle:entry.summary.title},selectedScope);
      for(const book of (includeBooks?before.value.books:[]).slice().sort((a,b)=>a.namespaceId<b.namespaceId?-1:a.namespaceId>b.namespaceId?1:0)){
       if(!includeOwner({workspaceId:book.namespaceId,projectId:entry.projectId,labBookId:book.labBookId})||selectedScope?.notebookIds&&!selectedScope.notebookIds.has(book.labBookId)||namespaces&&!namespaces.has(book.namespaceId))continue;
       signal?.throwIfAborted();await current();
       const access=new LabBookAccessSession(application,client,project,book.labBookId,current);let vault,accessEtag,bookRoot,bookAdmitted=false;
       try{
        const router=new LabBookRouter(books,{authorize:async()=>{await access.check();return true;},unlock:async(value,saved)=>{bookRoot=value.root;accessEtag=saved.etag;return vault=await access.key(value.root);}});
        await application.tracked(()=>router.withLabBook(book.labBookId,storage=>{bookAdmitted=true;return consume(storage,{workspaceId:book.namespaceId,projectId:entry.projectId,labBookId:book.labBookId,projectTitle:entry.summary.title},selectedScope);}),entry.projectId,book.labBookId);
        const assertBook=async()=>{await access.check();if((await readAccess(bookRoot)).etag!==accessEtag)throw access.error(new AppError('ACCESS_LOCKED'));};
        await assertBook();checks.push(assertBook);
       }catch(error){const failure=access.error(error);if(bookAdmitted||!await unavailable(failure,{workspaceId:book.namespaceId,projectId:entry.projectId,labBookId:book.labBookId}))throw failure;}finally{clearVault(vault);}
      }
      if((await books.read()).revision!==before.revision)throw new AppError('RECORD_QUERY_CURSOR');
      checks.push(async()=>{await current();if(await fingerprint(books.file)!==stamp)throw new AppError('RECORD_QUERY_CURSOR');});
     },{locationOnly:true});
    }catch(error){if(accessCodes.has(error.code))error.projectId??=entry.projectId;if(admitted||!await unavailable(error,{workspaceId:entry.namespaceId,projectId:entry.projectId,labBookId:null}))throw error;}finally{await owner.close();}
   },entry.projectId);
  }
  if((await registry.read()).revision!==directory.revision)throw new AppError('RECORD_QUERY_CURSOR');
  for(const verify of checks){signal?.throwIfAborted();await verify();}await check();
 };
}
