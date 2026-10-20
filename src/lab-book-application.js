import {recordOwnerTransferRequest} from './record-owner-transfer-application.js';
import {sampleAnalysisRequest,executeSampleAnalysisRequest} from './sample-analysis-requests.js';
import {projectModuleRequest} from './project-module-requests.js';
import {projectCalendarRequest} from './project-calendar.js';
import {locateResearchReference,resolveResearchReference} from './research-owner-reference.js';
import {validTarget} from './web/research-reference.js';
import {LabBookCopies} from './lab-book-copy.js';
import {LabBookAccessSettings} from './lab-book-access-settings.js';
import {LabBookDeletions,pendingLabBookDeletions} from './lab-book-deletion.js';
import {LabBookSettings} from './lab-book-settings.js';
import {LabBookRenames} from './lab-book-rename.js';
import {LabBookCreation} from './lab-book-creation.js';
import {LabBookRegistry} from './lab-book-registry.js';
import {LabBookRouter} from './lab-book-router.js';
import {readAccess,verifyAccess} from './access.js';
import {ProjectStorage} from './project-storage.js';
import {projectAssetRequest,executeProjectAsset} from './project-asset-requests.js';
import {projectPublicationRequest} from './project-publication-requests.js';
import {materialRequest,executeMaterialRequest} from './material-requests.js';
import {reviewRequest,executeReviewRequest} from './review-requests.js';
import {recordStarterRequest,executeRecordStarterRequest} from './record-starter-requests.js';
import {intakeRequest,intakeCommand} from './intake/commands.js';
import {cloneVault,clearVault} from './encryption.js';
import {researchRequest,executeResearchRequest} from './research-requests.js';
import {researchId} from './web/research-reference.js';
import {MAX_BYTES} from './model.js';
import {AppError} from './errors.js';
export function labBookRequest(suffix,method='POST'){
 if(method==='POST'&&['lab-books/import','lab-books/import/resume','lab-books/import/cancel','lab-books/import/pending'].includes(suffix))return {bookOperation:'import',operation:suffix,write:!suffix.endsWith('/pending'),limit:16384};
 if(method==='POST'&&suffix==='lab-books/move/pending')return {bookOperation:'placements',operation:suffix,write:false,limit:16384};
 if(method==='POST'&&suffix==='lab-books/list')return {bookOperation:'list',operation:suffix,write:false,limit:16384};
 if(method==='POST'&&suffix==='lab-books/delete/pending')return {bookOperation:'deletions',operation:suffix,write:false,limit:16384};
 if(method==='POST'&&suffix==='lab-books/create/pending')return {bookOperation:'creations',operation:suffix,write:false,limit:16384};
 if(method==='POST'&&suffix==='lab-books/create/resume')return {bookOperation:'resumeCreation',operation:suffix,write:true,limit:16384};
 if(method==='POST'&&suffix==='lab-books/create')return {bookOperation:'create',operation:suffix,write:true,limit:MAX_BYTES};
 const match=/^lab-books\/([a-f0-9-]{36})\/(.+)$/.exec(suffix);if(!match||!researchId(match[1]))return null;
 if(method==='POST'&&['storage/move','storage/move/resume'].includes(match[2]))return {bookOperation:'placement',operation:'lab-books/'+match[2],labBookId:match[1],write:true,limit:16384};
 if(method==='POST'&&['access/unlock','access/lock','access/details','access/password'].includes(match[2]))return {bookOperation:'access',operation:'lab-books/'+match[2],labBookId:match[1],write:match[2]!=='access/details',limit:16384};
 if(method==='POST'&&['storage/details','storage/copy','storage/copy/resume','storage/copy/cancel','storage/export','storage/export/resume','storage/export/cancel'].includes(match[2]))return {bookOperation:'transfer',operation:'lab-books/'+match[2],labBookId:match[1],write:match[2]!=='storage/details',limit:16384};
 if(method==='POST'&&match[2]==='storage/rename')return {bookOperation:'rename',operation:'lab-books/storage/rename',labBookId:match[1],write:true,limit:16384};
 if(method==='POST'&&match[2]==='settings/save')return {bookOperation:'settings',operation:'lab-books/settings/save',labBookId:match[1],write:true,limit:MAX_BYTES};
 if(method==='POST'&&['storage/delete','storage/delete/status','storage/delete/resume'].includes(match[2]))return {bookOperation:'delete',operation:'lab-books/'+match[2],labBookId:match[1],write:match[2]!=='storage/delete/status',limit:16384};
 if(method==='POST'&&['reference','reference-location'].includes(match[2]))return {bookOperation:'reference',operation:'lab-books/'+match[2],labBookId:match[1],write:false,limit:16384};
 if(method==='POST'&&match[2]==='publication-source-directory')return {operation:'publication-source-directory',labBookId:match[1],write:false,limit:16384};
 if(method==='POST'&&match[2]==='publication-source')return {operation:'publication-source',labBookId:match[1],write:false,limit:1048576};
 const route='/api/'+match[2];
 const command=recordOwnerTransferRequest(route,method)??sampleAnalysisRequest(route,method)??projectModuleRequest(route)??projectCalendarRequest(route)??projectAssetRequest(route,method)??projectPublicationRequest(route)??reviewRequest(route,method)??recordStarterRequest(route,method)??materialRequest(route)??intakeRequest(route)??(method==='POST'&&/^\/api\/(?:research\/|workspace\/read\/)/.test(route)?researchRequest(route):null);return command?{...command,bookOperation:'research',labBookId:match[1],route}:null;
}
export async function executeLabBookRequest(project,selected,data,{deviceStore,access:bookAccess,check=async()=>{},jobs,stopJobs=async()=>{},publishBook=async()=>{},...options}={}){
 const registry=new LabBookRegistry(project);await check();
 if(selected.bookOperation==='list'){
  if(!data||Object.keys(data).some(key=>!['after','limit','revision'].includes(key)))throw new AppError('INVALID');return registry.list(data);
 }
 if(selected.bookOperation==='deletions'){if(!data||Object.keys(data).some(key=>!['after','limit'].includes(key)))throw new AppError('INVALID');return pendingLabBookDeletions(project,data);}
 if(selected.bookOperation==='creations'){if(!data||Object.keys(data).some(key=>!['after','limit'].includes(key)))throw new AppError('INVALID');return new LabBookCreation(project,deviceStore,{publish:publishBook,withConfigurationSource:options.withConfigurationSource}).pending(data);}
 if(selected.bookOperation==='resumeCreation')return new LabBookCreation(project,deviceStore,{publish:publishBook,withConfigurationSource:options.withConfigurationSource}).resume(data,{check});
 if(selected.bookOperation==='create')return new LabBookCreation(project,deviceStore,{publish:publishBook,withConfigurationSource:options.withConfigurationSource}).create(data,{check});
 if(selected.operation==='lab-books/access/unlock')return bookAccess.unlock(data);
 if(selected.operation==='lab-books/access/lock'){if(!data||Object.keys(data).length)throw new AppError('INVALID');return bookAccess.lock();}
 const keyFor=root=>bookAccess?bookAccess.key(root):readAccess(root).then(value=>verifyAccess(value,'','',{deviceStore}));
 if(selected.bookOperation==='delete'){
  const deletions=new LabBookDeletions(project,selected.labBookId),receipt=await deletions.receipt();
  if(selected.operation.endsWith('/status')){if(!data||Object.keys(data).length)throw new AppError('INVALID');return {deletion:receipt&&{id:receipt.id,labBookId:receipt.labBookId,name:receipt.directory,phase:receipt.phase}};}
  if(!data||Object.keys(data).sort().join()!=='expectedName,id')throw new AppError('INVALID');
  if(selected.operation.endsWith('/resume')&&receipt?.id!==data.id)throw new AppError('NOT_FOUND');
  const root=receipt?.id===data.id?await deletions.authenticationRoot(receipt):(await registry.locate(selected.labBookId)).root;
  let key;try{if(root)key=await keyFor(root);await check();await stopJobs();return await deletions.run(key,{...data,check:bookAccess?()=>bookAccess.check():check,onProgress:options.onProgress});}finally{clearVault(key);}
 }
 if(!['research','rename','settings','access','transfer','reference'].includes(selected.bookOperation))throw new AppError('NOT_FOUND');
 const placement=selected.operation==='lab-books/storage/details'?await options.placementStatus?.():null;
 if(selected.operation==='lab-books/storage/details'&&placement?.canResume){
  if(!data||Object.keys(data).length)throw new AppError('INVALID');const root=await options.placementRoot(),key=await keyFor(root);try{await check();return {path:root,move:placement};}finally{clearVault(key);}
 }
 const renames=new LabBookRenames(project),pending=await renames.pending(selected.labBookId);
 if(pending){
  await stopJobs();const root=pending.phase==='complete'?(await registry.locate(selected.labBookId)).root:await renames.locate(pending);
  const key=await keyFor(root);
  try{await renames.resume(selected.labBookId,key,{check:bookAccess?()=>bookAccess.check():check});}finally{clearVault(key);}
 }
 let vault,entry,etag;
 const current=async(directory=registry)=>{
  await check();await bookAccess?.check();if(!entry)return;
  const next=await directory.locate(entry.labBookId);
  if(next.root!==entry.root||next.namespaceId!==entry.namespaceId||next.vaultId!==entry.vaultId||(await readAccess(entry.root)).etag!==etag){const error=new AppError('ACCESS_LOCKED');throw bookAccess?bookAccess.error(error):error;}
 };
 const router=new LabBookRouter(registry,{
  authorize:async({labBookId})=>{await current();return labBookId===selected.labBookId;},
  unlock:async(value,access)=>{if(selected.bookIdentity&&['namespaceId','vaultId'].some(key=>value[key]!==selected.bookIdentity[key]))throw new AppError('DATABASE_LOCATION');entry=value;etag=access.etag;vault=await keyFor(value.root);await current();return vault;}
 });
 // A durable worker retains its own encrypted-directory access. A request's
 // project key is cleared when its response ends, independently of that worker.
 const retain=async()=>{
  const parent=new ProjectStorage(project.root,project.projectId,cloneVault(project.vault)),directory=new LabBookRegistry(parent);let closed=false;
  return {check:async()=>{if(closed)throw new AppError('ACCESS_LOCKED');await current(directory);},close(){closed=true;clearVault(parent.vault);}};
 };
 try{
  const result=await router.withLabBook(selected.labBookId,async storage=>{
   if(selected.bookOperation==='reference'){
    if(!validTarget(data)||data.kind==='workspace')throw new AppError('INVALID');
    return (selected.operation.endsWith('-location')?locateResearchReference:resolveResearchReference)(storage,data,{namespaceId:entry.namespaceId});
   }
   const background=()=>jobs(storage,etag,()=>current(),retain);
   if(selected.bookOperation==='transfer'){
    const copy=new LabBookCopies(project,selected.labBookId),archive=new LabBookCopies(project,selected.labBookId,'export');
    if(selected.operation==='lab-books/storage/details'){if(!data||Object.keys(data).length)throw new AppError('INVALID');return {path:storage.root,copy:await copy.status(),export:await archive.status(),move:placement??null};}
    const command=selected.operation.includes('/export')?archive:copy,resume=selected.operation.endsWith('/resume'),cancel=selected.operation.endsWith('/cancel');
    if(!data||Object.keys(data).sort().join()!==(resume||cancel?'id':'id,parent'))throw new AppError('INVALID');
    if(cancel)return command.cancel(storage,{...data,check:()=>current()});
    return command.run(storage,{...data,resume,onProgress:options.onProgress,check:()=>current(),checkDestination:options.checkTransferDestination,forbiddenRoots:options.transferRoots?await options.transferRoots():[project.root]});
   }

   if(selected.bookOperation==='access'){
    const settings=new LabBookAccessSettings(storage);
    if(selected.operation==='lab-books/access/details'){if(!data||Object.keys(data).length)throw new AppError('INVALID');return settings.details();}
    await stopJobs();return settings.password(data,{deviceStore,check:()=>current(),changed:async next=>{await bookAccess.changed(storage.root,next,vault);etag=next;}});
   }
   if(selected.bookOperation==='settings'){
    const result=await new LabBookSettings(project).save(storage,data,{check:bookAccess?()=>bookAccess.check():check,stopJobs});entry=await registry.locate(selected.labBookId);etag=(await readAccess(entry.root)).etag;return result;
   }
   if(selected.bookOperation==='rename'){
    if(!data||Object.keys(data).sort().join()!=='expectedName,id,name')throw new AppError('INVALID');
    await stopJobs();const result=await renames.run(storage,{...data,check:bookAccess?()=>bookAccess.check():check});entry=await registry.locate(selected.labBookId);etag=(await readAccess(entry.root)).etag;return result;
   }
   if(selected.sampleAnalysis)return executeSampleAnalysisRequest(storage,selected,data,{...options,check:()=>current()});
   if(selected.asset)return executeProjectAsset(storage,selected,data,{...options,jobs:background});
   if(selected.material)return executeMaterialRequest(storage,selected,data,{...options,jobs:background});
   if(selected.review)return executeReviewRequest(storage,deviceStore,selected.review,data);
   if(selected.starter)return executeRecordStarterRequest(storage,selected,data,options);
   if(selected.publication){const owner=await background();return owner.publications.run(selected,data,{...options,sourceReader:options.publicationSources?.(owner.storage),check:()=>current()});}
   if(selected.intake){const owner=await background(),response=await intakeCommand(storage,owner.queue,selected.intake,data,options);owner.worker.wake();return response;}
   if(selected.calendar)return options.calendar(storage,etag,selected.calendar,data);
   if(selected.run&&projectModuleRequest(selected.route)){const response=await selected.run(storage,data,{...options,check:()=>current()});if(selected.route==='/api/modules/command'&&response.entities)options.reconcileModules?.(response.entities);return response;}
   return executeResearchRequest(storage,selected.route,data,options);
  },{action:selected.write?'write':'read'});
  await current();return result;
 }finally{clearVault(vault);}
}
