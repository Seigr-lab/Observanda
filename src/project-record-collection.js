import {withProjectCollectionDirectory} from './project-collection-directory.js';
// Scope discovery uses the workspace directory and each project's book
// directory. Every catalogue is authenticated through its own access owner.
import {ProjectSessionOwner} from './project-session-owner.js';
import {LabBookRegistry} from './lab-book-registry.js';
import {LabBookRouter} from './lab-book-router.js';
import {LabBookAccessSession} from './lab-book-access-session.js';
import {readAccess} from './access.js';
import {clearVault} from './encryption.js';
import {AppError} from './errors.js';
const accessCodes=new Set(['ACCESS_LOCKED','ACCESS_DENIED','ACCESS_WAIT','AUTH','DEVICE_UNKNOWN']);
const unavailableCodes=new Set([...accessCodes,'STORAGE_PROJECT_BUSY','LAB_BOOK_IMPORT_PENDING','STORAGE_INCOMPLETE']);
export function projectRecordCollection(application,client,check){
 return async(consume,{workspaceId,query,scope,signal,selection=null,namespaces=null,includeBooks=true,includeOwner=()=>true,onUnavailable=null})=>{
  const registry=await application.registry();
  return withProjectCollectionDirectory(registry,{workspaceId,query,scope,selection,namespaces,signal},async directory=>{
  const checks=[];
  await check();signal?.throwIfAborted();
  if(directory.includeRoot&&includeOwner({workspaceId:registry.workspaceId,projectId:null,labBookId:null})&&(!namespaces||namespaces.has(registry.workspaceId)))await consume(application.workspace,{workspaceId:registry.workspaceId,projectId:null,labBookId:null},await directory.ownerScope(null)??directory.chosen);
  for await(const entry of directory.projects()){
   const selectedScope=await directory.ownerScope(entry);
   signal?.throwIfAborted();await check();
   await application.tracked(async()=>{
    const owner=new ProjectSessionOwner(application,client,entry.projectId,{check,recoverRenames:false});let admitted=false;
    const unavailable=async(error,address)=>{if(!onUnavailable||!unavailableCodes.has(error.code))return false;await check();await onUnavailable(error,address);return true;};
    try{
     await owner.use(async project=>{
      admitted=true;
      const books=new LabBookRegistry(project),stamp=await books.version(),current=()=>owner.check();
      if(includeOwner({workspaceId:entry.namespaceId,projectId:entry.projectId,labBookId:null})&&(!namespaces||namespaces.has(entry.namespaceId)))await consume(project,{workspaceId:entry.namespaceId,projectId:entry.projectId,labBookId:null,projectTitle:entry.summary.title},selectedScope);
      if(includeBooks)await books.inspect(async bookView=>{
      const selectedBooks=async function*(){if(namespaces){for(const id of [...namespaces].sort()){const row=await bookView.get(id,{index:'namespace'});if(row?.state==='active')yield row.entry;}}else if(selectedScope?.notebookIds){const values=[];for(const id of selectedScope.notebookIds){const row=await bookView.get(id);if(row?.state==='active')values.push(row.entry);}yield* values.sort((a,b)=>a.namespaceId<b.namespaceId?-1:1);}else for await(const row of bookView.entries({index:'namespace',signal}))if(row.state==='active')yield row.entry;};
      for await(const book of selectedBooks()){
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
      });
      if(await books.version()!==stamp)throw new AppError('RECORD_QUERY_CURSOR');
      checks.push(async()=>{await current();const fresh=new ProjectSessionOwner(application,client,entry.projectId,{check:current,recoverRenames:false});try{await fresh.use(async parent=>{if(await new LabBookRegistry(parent).version()!==stamp)throw new AppError('RECORD_QUERY_CURSOR');},{locationOnly:true});}finally{await fresh.close();}});
     },{locationOnly:true});
    }catch(error){if(accessCodes.has(error.code))error.projectId??=entry.projectId;if(admitted||!await unavailable(error,{workspaceId:entry.namespaceId,projectId:entry.projectId,labBookId:null}))throw error;}finally{await owner.close();}
   },entry.projectId);
  }
  if(await registry.version()!==directory.revision)throw new AppError('RECORD_QUERY_CURSOR');
  for(const verify of checks){signal?.throwIfAborted();await verify();}await check();
  });
 };
}
