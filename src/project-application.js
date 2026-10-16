import {publicationSourceDirectory} from './publication-source-directory.js';
import {projectPublicationSource,publicationSourceFactory} from './project-publication-sources.js';
import {publicationSiteDirectory} from './publication-site-directory.js';
import {timelineCollectionQuery} from './timeline-collection-query.js';
import {timelineCollectionChoices} from './timeline-collection-choices.js';
import {dashboardCollectionChoices} from './dashboard-collection-choices.js';
import {dashboardCollectionStructure} from './dashboard-collection-structure.js';
import {dashboardCollectionDiscovery} from './dashboard-collection-discovery.js';
import {dashboardCollectionTypes} from './dashboard-collection-types.js';
import {dashboardCollectionRecords} from './dashboard-collection-records.js';
import {projectCollectionReader} from './project-collection-reader.js';
import {recordCollectionTypes} from './record-collection-types.js';
import {RecordCollectionPages} from './record-collection-pages.js';
import {recordCollectionQuery} from './record-collection-query.js';
import {projectRecordCollection} from './project-record-collection.js';
import {ProjectImports} from './project-import.js';
import {ProjectStorage} from './project-storage.js';
import {LabBookImports} from './lab-book-import.js';
import {LabBookReparentApplication} from './lab-book-reparent-application.js';
import {LabBookDirectory} from './lab-book-directory.js';
import {LabBookLocationAccess} from './lab-book-location-access.js';
import {storageCreationPath} from './storage-names.js';
import {ProjectLocationAccess} from './project-location-access.js';
import {ProjectRenameApplication} from './project-rename-application.js';
import {LabBookAccessSession} from './lab-book-access-session.js';
import {labBookRequest,executeLabBookRequest} from './lab-book-application.js';
import {reviewRequest,executeReviewRequest} from './review-requests.js';
import {recordStarterRequest,executeRecordStarterRequest} from './record-starter-requests.js';
import {projectAssetRequest,executeProjectAsset} from './project-asset-requests.js';
import {projectPublicationRequest} from './project-publication-requests.js';
import {ProjectArchives} from './project-archives.js';
import {ProjectAccessSettings} from './project-access-settings.js';
import {ProjectSessionOwner} from './project-session-owner.js';
import {withProjectHistoryAccess} from './project-history-access.js';
import {projectMaterialReferenceRequest,addressedMaterialCommand} from './project-material-reference.js';
import {intakeRequest,intakeCommand} from './intake/commands.js';
import {ProjectJobs} from './project-jobs.js';
import {materialRequest,executeMaterialRequest} from './material-requests.js';
import {ProjectDeletions,pendingProjectDeletions} from './project-deletion.js';
import {withDatabaseRequest} from './database-request-context.js';
// Authenticated application access to explicitly selected project owners.
// Workspace catalogue activity is unrelated to these project transactions.
import {ProjectCalendars,projectCalendarRequest} from './project-calendar.js';
import {projectModuleRequest} from './project-module-requests.js';
import {ProjectRegistry} from './project-registry.js';
import {projectDirectoryChoices} from './project-directory-query.js';
import path from 'node:path';
import {resolveLocation} from './locations.js';
import {ProjectMoves} from './project-move.js';
import {ProjectCopies} from './project-copy.js';
import {authenticateKeyring} from './security/keyring.js';
import {ProjectOpening} from './project-opening.js';
import {ProjectCreation} from './project-creation.js';
import {MAX_BYTES} from './model.js';
import {ProjectReferences} from './project-references.js';
import {workspaceFile,assertRegular} from './storage.js';
import {readAccess,verifyAccess} from './access.js';
import {cloneVault,clearVault} from './encryption.js';
import {researchId,validTarget} from './web/research-reference.js';
import {executeResearchRequest,researchRequest} from './research-requests.js';
import {AppError} from './errors.js';

export function projectRequest(route,method){
 if(route==='/api/projects/publication-source-directory')return {operation:'publication-source-directory',write:false,limit:16384};
 if(route==='/api/projects/publication-source')return {operation:'publication-source',write:false,limit:1048576};
 if(route==='/api/projects/publication-sites')return {operation:'publication-sites',write:false,limit:16384};
 if(['/api/projects/timeline-collection/query','/api/projects/timeline-collection/choices'].includes(route))return {operation:route.slice('/api/projects/'.length),write:false,limit:131072};
 if(['/api/projects/record-collection/query','/api/projects/record-collection/types','/api/projects/dashboard-collection/records','/api/projects/dashboard-collection/discovery','/api/projects/dashboard-collection/types','/api/projects/dashboard-collection/structure','/api/projects/dashboard-collection/choices'].includes(route))return {operation:route.slice('/api/projects/'.length),write:false,limit:16384};
 const addressed=projectMaterialReferenceRequest(route);if(addressed)return addressed;
 if(route==='/api/projects/delete/pending')return {operation:'delete/pending',write:false,limit:16384};
 if(['/api/projects/open','/api/projects/open/resume','/api/projects/open/cancel','/api/projects/open/pending'].includes(route))return {operation:route.slice('/api/projects/'.length),write:!route.endsWith('/pending'),limit:2*1024*1024};
 if(['/api/projects/reference','/api/projects/reference-location'].includes(route))return {operation:route.endsWith('-location')?'research-reference-location':'research-reference',write:false,limit:16384};
 if(['/api/projects/create/pending','/api/projects/create/resume'].includes(route))return {operation:route.slice('/api/projects/'.length),write:route.endsWith('/resume'),limit:16384};
 if(['/api/projects/list','/api/projects/choices','/api/projects/create'].includes(route))return {operation:route.split('/').at(-1),write:route.endsWith('/create'),limit:MAX_BYTES};
 const match=/^\/api\/projects\/([a-f0-9-]{36})\/(.+)$/.exec(route);
 if(!match||!researchId(match[1]))return null;
 if(match[2]==='publication-source-directory')return {projectId:match[1],operation:'publication-source-directory',write:false,limit:16384};
 if(match[2]==='publication-source')return {projectId:match[1],operation:'publication-source',write:false,limit:1048576};
 if(match[2]==='publication-sites')return {projectId:match[1],operation:match[2],write:false,limit:16384};
 if(['timeline-collection/query','timeline-collection/choices'].includes(match[2]))return {projectId:match[1],operation:match[2],write:false,limit:131072};
 const bookRequest=labBookRequest(match[2],method);if(bookRequest)return {projectId:match[1],...bookRequest};
 if(['record-collection/query','record-collection/types','dashboard-collection/records','dashboard-collection/discovery','dashboard-collection/types','dashboard-collection/structure','dashboard-collection/choices'].includes(match[2]))return {projectId:match[1],operation:match[2],write:false,limit:16384};
 if(match[2]==='settings/save')return {projectId:match[1],operation:match[2],write:true,limit:MAX_BYTES};
 if(match[2]==='directory/reparent')return {projectId:match[1],operation:match[2],write:true,limit:16384};
 if(['storage/details','storage/copy','storage/copy/resume','storage/copy/cancel','storage/export','storage/export/resume','storage/export/cancel','storage/move','storage/move/resume','storage/move/cancel','storage/move/status','storage/delete','storage/delete/resume','storage/delete/status'].includes(match[2]))return {projectId:match[1],operation:match[2],write:!['storage/details','storage/move/status','storage/delete/status'].includes(match[2]),limit:16384};
 const command=reviewRequest('/api/'+match[2],method)??recordStarterRequest('/api/'+match[2],method)??projectAssetRequest('/api/'+match[2],method)??projectPublicationRequest('/api/'+match[2])??intakeRequest('/api/'+match[2])??materialRequest('/api/'+match[2])??researchRequest('/api/'+match[2])??projectModuleRequest('/api/'+match[2])??projectCalendarRequest('/api/'+match[2]);
 if(command)return {projectId:match[1],route:'/api/'+match[2],...command};
 if(['access/details','access/password'].includes(match[2]))return {projectId:match[1],operation:match[2],write:match[2]==='access/password',limit:16384};
 if(['access/unlock','access/lock','reference'].includes(match[2]))return {projectId:match[1],operation:match[2],write:false,limit:16384};
 return null;
}
export class ProjectApplication{
 constructor(workspace,{deviceStore,authenticate,publisherOptions}={}){
  this.workspace=workspace;this.deviceStore=deviceStore;this.authenticate=authenticate??((root,access,username,password,recovery)=>verifyAccess(access,username,password,{deviceStore,recovery}));
  this.renames=new ProjectRenameApplication(this);this.bookPlacements=new LabBookReparentApplication(this);this.sessions=new WeakMap();this.calendars=new ProjectCalendars();this.jobs=new ProjectJobs({publisherOptions});this.credentials=new Set();this.active=new Map();this.closed=false;this.recordCollections=new RecordCollectionPages();this.dashboardCollections=new RecordCollectionPages({max:256,maxBytes:16*1024*1024,reuse:true});
 }
 async recoverProjectRename(client,projectId,options){return this.renames.recover(client,projectId,options);}
 async registry(){
  if(this.closed)throw new AppError('ACCESS_LOCKED');
  if(this.registryOwner)return this.registryOwner;
  const file=await workspaceFile(this.workspace.root),stat=await assertRegular(file);
  if(stat.size>4096)throw new AppError('ACCESS_UPGRADE');let value;
  try{value=JSON.parse(await this.workspace.readFile(file,'utf8'));}catch(error){if(error instanceof SyntaxError)throw new AppError('FORMAT');throw error;}
  if(value?.format!=='observanda-research-catalogue'||value.version!==2||!researchId(value.workspaceId))throw new AppError('ACCESS_UPGRADE');
  return this.registryOwner??=new ProjectRegistry(this.workspace,value.workspaceId);
 }
 session(client){if(!client||typeof client!=='object')throw new AppError('AUTH');let session=this.sessions.get(client);if(!session){session=new Map();this.sessions.set(client,session);}return session;}
 forget(session,id){if(researchId(id))for(const [key,value] of session)if(key.startsWith('book:'+id+':')&&!value.locked)this.forget(session,key);this.calendars.forget(session,id);const old=session.get(id);if(old?.vault){clearVault(old.vault);this.credentials.delete(old);}session.delete(id);}
 async tracked(operation,projectId,labBookId){
  if(this.closed)throw new AppError('ACCESS_LOCKED');let release;const active=new Promise(resolve=>release=resolve);this.active.set(active,{projectId,labBookId});
  try{return await operation();}finally{this.active.delete(active);release();}
 }
 expire(now=Date.now()){this.recordCollections.expire();this.dashboardCollections.expire();this.jobs.expire(now);this.calendars.expire(now);for(const entry of this.credentials)if(entry.expires<=now){clearVault(entry.vault);this.credentials.delete(entry);}}
 async close(){this.closed=true;this.recordCollections.clear();this.dashboardCollections.clear();this.calendars.clear();const jobs=this.jobs.close();await Promise.all(this.active.keys());await jobs;this.calendars.clear();for(const entry of this.credentials)clearVault(entry.vault);this.credentials.clear();this.sessions=new WeakMap();}
 async unlock(client,projectId,data,{check=async()=>{}}={}){
  if(!data||Object.keys(data).some(key=>!['username','password','recovery'].includes(key))||Object.values(data).some(value=>typeof value!=='string'||value.length>1024))throw new AppError('INVALID');
  return this.tracked(async()=>{
   await check();const session=this.session(client),previous=session.get(projectId),registry=await this.registry(),entry=await registry.locate(projectId),access=await readAccess(entry.root);
   if(access.value.formatVersion!==3||access.value.vaultId!==entry.vaultId)throw new AppError('DATABASE_LOCATION');
   const vault=await this.authenticate(entry.root,access,data.username??'',data.password??'',data.recovery??'');
   try{
    await check();if(this.closed)throw new AppError('ACCESS_LOCKED');
    const current=await registry.locate(projectId);
    if(current.root!==entry.root||(await readAccess(entry.root)).etag!==access.etag)throw new AppError('CONFLICT');
    if(session.get(projectId)!==previous)throw new AppError('CONFLICT');await this.jobs.forget(session,projectId);this.forget(session,projectId);
    const saved={root:entry.root,etag:access.etag,vault:cloneVault(vault),expires:Date.now()+8*60*60*1000};session.set(projectId,saved);this.credentials.add(saved);return {projectId,locked:false};
   }finally{clearVault(vault);}
  },projectId);
 }
 async lock(client,projectId){if(!researchId(projectId))throw new AppError('INVALID');const session=this.session(client);const stopped=this.jobs.forget(session,projectId);this.forget(session,projectId);session.set(projectId,{locked:true});await stopped;await Promise.all([...this.active].filter(([,owner])=>owner.projectId===projectId).map(([pending])=>pending));return {projectId,locked:true};}
 withSourceHistory(client,operation,options){return withProjectHistoryAccess(this,client,operation,options);}
 async run(client,selected,data,options={}){
  try{return await withDatabaseRequest(options.signal,()=>this.execute(client,selected,data,options));}
  catch(error){if(selected.projectId&&['ACCESS_LOCKED','ACCESS_DENIED','ACCESS_WAIT','AUTH','DEVICE_UNKNOWN'].includes(error.code))error.projectId??=selected.projectId;throw error;}
 }
 async deletion(client,selected,data,{check=async()=>{},onProgress}={}){
  return this.tracked(async()=>{
   await check();const registry=await this.registry(),deletions=new ProjectDeletions(registry,selected.projectId),session=this.session(client);
   if(selected.operation==='storage/delete/status'){if(!data||Object.keys(data).length)throw new AppError('INVALID');return {deletion:await deletions.status()};}
   const resume=selected.operation==='storage/delete/resume',fields=Object.keys(data??{}).sort().join();
   if(!researchId(data?.id)||(resume?fields!=='id,password,recovery,username'||['username','password','recovery'].some(key=>typeof data[key]!=='string'||data[key].length>1024):fields!=='expectedRoot,id'||typeof data.expectedRoot!=='string'))throw new AppError('INVALID');
   const receipt=await deletions.receipt();if(resume&&receipt?.id!==data.id)throw new AppError('NOT_FOUND');
   const root=receipt?.id===data.id?await deletions.authenticationRoot(receipt):(await registry.locate(selected.projectId)).root;
   let vault,owners,sessionEntry=session.get(selected.projectId),access;
   const current=async()=>{await check();if(this.closed||session.get(selected.projectId)!==sessionEntry||sessionEntry?.locked)throw new AppError('ACCESS_LOCKED');if(root&&(await readAccess(root)).etag!==access?.etag)throw new AppError('CONFLICT');};
   try{
    if(root){
     if(sessionEntry?.locked)throw new AppError('ACCESS_LOCKED');access=await readAccess(root);
     if(sessionEntry?.vault&&sessionEntry.root===root&&sessionEntry.etag===access.etag&&sessionEntry.expires>Date.now())vault=cloneVault(sessionEntry.vault);
     else vault=await this.authenticate(root,access,data.username??'',data.password??'',data.recovery??'');
     authenticateKeyring(access.value,vault);await current();
    }
    await this.jobs.invalidateProject(selected.projectId);
    owners=new ProjectLocationAccess(this,client,{check:root?current:check});
    return await deletions.run(vault,{id:data.id,...(!resume?{expectedRoot:data.expectedRoot}:{}),check:root?current:check,onProgress,withProject:(id,use)=>owners.withProject(id,use),placeChild:(child,placement)=>this.renames.reparent(client,child.projectId,{id:child.id,...placement},{check:root?current:check}),withBook:(project,id,use)=>owners.withProject(project.projectId,parent=>owners.withBook(parent,id,use)),onFrozen:async value=>{
     this.calendars.invalidateProject(selected.projectId);
     for(const saved of this.credentials)if(saved.root===value.source||saved.root?.startsWith(value.source+path.sep)){clearVault(saved.vault);saved.expires=0;this.credentials.delete(saved);}
    }});
   }catch(error){
    if(['ACCESS_LOCKED','ACCESS_DENIED','AUTH','DEVICE_UNKNOWN'].includes(error.code)){
     error.projectId??=selected.projectId;
     // Authentication can precede the durable command. The unlock dialog owns
     // this admission request; no deletion activity has started yet.
     if(!await deletions.receipt())error.operationNotStarted=true;
    }
    throw error;
   }finally{await owners?.close();clearVault(vault);}
  },selected.projectId);
 }
 async execute(client,selected,data,{signal,onProgress,download,stream,websiteId,binary,headless,query,contentLength,check=async()=>{},setCheck=()=>{}}={}){
  if(selected.operation==='publication-source-directory')return this.tracked(()=>publicationSourceDirectory(this,client,data,{scope:selected.projectId??null,labBookId:selected.labBookId??null,signal,check}),selected.projectId);
  if(selected.operation==='publication-source')return this.tracked(()=>projectPublicationSource(this,client,data,{scope:selected.projectId??null,labBookId:selected.labBookId??null,signal,check}),selected.projectId);
  if(selected.operation==='publication-sites')return this.tracked(()=>publicationSiteDirectory(this.recordCollections,client,data,{scope:selected.projectId??null,visit:projectRecordCollection(this,client,check),signal}),selected.projectId);
  if(['timeline-collection/query','timeline-collection/choices'].includes(selected.operation))return this.tracked(async()=> (selected.operation.endsWith('/choices')?timelineCollectionChoices:timelineCollectionQuery)(this.recordCollections,client,data,{scope:selected.projectId??null,registry:await this.registry(),visit:projectRecordCollection(this,client,check),check,signal}),selected.projectId);
  if(selected.operation==='dashboard-collection/choices')return this.tracked(async()=>dashboardCollectionChoices(this.dashboardCollections,client,data,{scope:selected.projectId??null,registry:await this.registry(),visit:projectRecordCollection(this,client,check),check,signal}),selected.projectId);
  if(selected.operation==='dashboard-collection/structure')return this.tracked(()=>dashboardCollectionStructure(this.dashboardCollections,client,data,{scope:selected.projectId??null,visit:projectRecordCollection(this,client,check),signal}),selected.projectId);
  if(['dashboard-collection/discovery','dashboard-collection/types'].includes(selected.operation))return this.tracked(()=>(selected.operation.endsWith('/types')?dashboardCollectionTypes:dashboardCollectionDiscovery)(this.dashboardCollections,client,data,{scope:selected.projectId??null,visit:projectRecordCollection(this,client,check),signal}),selected.projectId);
  if(selected.operation==='dashboard-collection/records')return this.tracked(()=>dashboardCollectionRecords(this.dashboardCollections,client,data,{scope:selected.projectId??null,visit:projectRecordCollection(this,client,check),reader:projectCollectionReader(this,client,check),signal}),selected.projectId);
  if(['record-collection/query','record-collection/types'].includes(selected.operation))return this.tracked(()=>(selected.operation.endsWith('/types')?recordCollectionTypes:recordCollectionQuery)(this.recordCollections,client,data,{scope:selected.projectId??null,visit:projectRecordCollection(this,client,check),signal}),selected.projectId);
  if(selected.referenceOwner){
   await check();const {ref,command}=addressedMaterialCommand(selected,data),registry=await this.registry(),{referenceOwner,...request}=selected;let entry;
   try{entry=await registry.reference(ref);}catch(error){if(error.code!=='NOT_FOUND'||ref.workspaceId!==registry.workspaceId)throw error;}
   // Only a reference to this workspace's own namespace can remain here. A
   // registered or retired project never falls back to the source catalogue.
   if(!entry)return this.tracked(async()=>{
    await check();signal?.throwIfAborted();const value=await executeMaterialRequest(this.workspace,request,command,{signal,download,stream});await check();
    return selected.download?value:{projectId:null,namespaceId:registry.workspaceId,value};
   });
   const value=await this.run(client,{...request,projectId:entry.projectId,...(entry.labBookId?{labBookId:entry.labBookId,bookOperation:'research',bookIdentity:{namespaceId:entry.namespaceId,vaultId:entry.bookVaultId}}:{})},command,{signal,onProgress,download,stream,check,setCheck});
   return selected.download?value:{projectId:entry.projectId,...(entry.labBookId?{labBookId:entry.labBookId}:{}),namespaceId:entry.namespaceId,value};
  }

  if(selected.bookOperation==='placement')return this.bookPlacements.run(client,selected.projectId,selected.labBookId,data,{resume:selected.operation.endsWith('/resume'),check,onProgress});
  if(selected.operation?.startsWith('storage/delete'))return this.deletion(client,selected,data,{check,onProgress});
  if(selected.operation==='delete/pending'){await check();if(!data||Object.keys(data).sort().join()!=='after,limit')throw new AppError('INVALID');return pendingProjectDeletions(await this.registry(),data);}
  if(['research-reference','research-reference-location'].includes(selected.operation)){
   await check();if(!validTarget(data)||data.kind==='workspace')throw new AppError('INVALID');
   let entry;
   try{entry=await (await this.registry()).reference(data);}catch(error){if(selected.operation==='research-reference-location'&&error.code==='NOT_FOUND')return {registered:false};throw error;}
   const {workspaceId,...reference}=data;
   const operation=selected.operation==='research-reference-location'?'reference-location':'reference';
   const result=await this.run(client,{projectId:entry.projectId,operation:entry.labBookId?'lab-books/'+operation:operation,write:false,...(entry.labBookId?{labBookId:entry.labBookId,bookOperation:'reference',bookIdentity:{namespaceId:entry.namespaceId,vaultId:entry.bookVaultId}}:{})},entry.labBookId?data:{...reference,domain:'research'},{signal,check,setCheck});
   return {...result,registered:true,target:structuredClone(data),projectId:entry.projectId,...(entry.labBookId?{labBookId:entry.labBookId}:{}),namespaceId:entry.namespaceId};
  }
  if(['list','choices','open','open/resume','open/cancel','open/pending','create','create/pending','create/resume'].includes(selected.operation))return this.tracked(async()=>{
   await check();const registry=await this.registry();let result;
   if(selected.operation==='open/pending'){if(!data||Object.keys(data).some(key=>!['after','limit'].includes(key)))throw new AppError('INVALID');result=await new ProjectImports(registry,this.deviceStore).pending(data);}
   else if(['open','open/resume','open/cancel'].includes(selected.operation)){
    const session=this.session(client),expected=new Map();
    const openingCheck=async()=>{await check();if(this.closed||[...expected].some(([id,saved])=>session.get(id)!==saved))throw new AppError('ACCESS_LOCKED');};
    const options={check:openingCheck,onProgress,identified:id=>expected.set(id,session.get(id)),opened:async(entry,access,vault)=>{
     await openingCheck();
     if(entry.labBookId){const parent=await registry.locate(entry.projectId),grant=session.get(entry.projectId);if(!grant?.vault)throw new AppError('ACCESS_LOCKED');new LabBookAccessSession(this,client,new ProjectStorage(parent.root,parent.projectId,grant.vault),entry.labBookId,openingCheck).save(entry.root,access.etag,vault);return;}
     this.forget(session,entry.projectId);const saved={root:entry.root,etag:access.etag,vault:cloneVault(vault),expires:Date.now()+8*60*60*1000};session.set(entry.projectId,saved);this.credentials.add(saved);expected.set(entry.projectId,saved);
    }};
    const imports=new ProjectImports(registry,this.deviceStore),parentId=selected.operation!=='open'?(await imports.read(data?.id))?.parentId:data?.parentId??null;
    if(parentId===undefined)throw new AppError('NOT_FOUND');
    result=await this.renames.withParent(client,parentId,openingCheck,current=>selected.operation==='open/cancel'?imports.cancel(data,{...options,check:current}):selected.operation==='open/resume'?imports.run(data,{...options,check:current,resume:true}):new ProjectOpening(registry,this.deviceStore).open(data,{...options,check:current}));
   }
   else if(selected.operation==='choices')result=await projectDirectoryChoices(registry,data);
   else if(selected.operation==='create')result=await new ProjectCreation(registry,this.deviceStore).create(data,{check});
   else if(selected.operation==='create/resume')result=await new ProjectCreation(registry,this.deviceStore).resume(data,{check});
   else if(selected.operation==='create/pending'){if(!data||Object.keys(data).sort().join()!=='after,limit')throw new AppError('INVALID');result=await new ProjectCreation(registry,this.deviceStore).pending(data);}
   else{
    if(!data||!['limit,offset,revision','limit,offset,parentId,revision'].includes(Object.keys(data).sort().join())||!Number.isSafeInteger(data.offset)||data.offset<0||!Number.isSafeInteger(data.limit)||data.limit<1||data.limit>100||data.revision!==null&&typeof data.revision!=='string')throw new AppError('INVALID');
    if(data.parentId!==undefined&&data.parentId!==null&&!researchId(data.parentId))throw new AppError('INVALID');
    const current=await registry.directory();if(data.revision!==null&&data.revision!==current.revision)throw new AppError('CONFLICT');
    const all=current.projects,projects=data.parentId===undefined?current.value.projects:current.value.projects.filter(entry=>entry.parentId===data.parentId),ancestors=[];
    for(let id=data.parentId;id;){const entry=all.find(item=>item.projectId===id);if(!entry)throw new AppError('NOT_FOUND');ancestors.unshift(entry);id=entry.parentId;}
    result={revision:current.revision,total:projects.length,projects:projects.slice(data.offset,data.offset+data.limit),...(data.parentId===undefined?{}:{ancestors})};
   }
   await check();return result;
  },selected.operation==='create'?data?.project?.id:undefined);
  if(['directory/reparent','storage/move'].includes(selected.operation))return this.tracked(()=>this.renames.reparent(client,selected.projectId,data,{check}),selected.projectId);
  if(selected.operation==='storage/move/resume'){const resumed=await this.tracked(()=>this.renames.resumeMove(client,selected.projectId,data,{check}),selected.projectId);if(resumed)return resumed;}
  if(selected.operation==='settings/save')return this.tracked(()=>this.renames.save(client,selected.projectId,data,{check}),selected.projectId);
  return this.tracked(async()=>{
   await check();signal?.throwIfAborted();const registry=await this.registry(),session=this.session(client),owner=new ProjectSessionOwner(this,client,selected.projectId,{check,recoverRenames:!['storage/details','storage/move/status'].includes(selected.operation),deferPreparedRename:['lab-books/access/unlock','lab-books/access/lock'].includes(selected.operation)});
   const assertCurrent=()=>owner.check(),acceptRelocation=latest=>owner.relocated(latest),moves=new ProjectMoves(registry),copies=new ProjectCopies(registry),archives=new ProjectArchives(registry);
   try{
    const router=await owner.router();
    setCheck(assertCurrent);
    if(['reference','reference-location'].includes(selected.operation)&&data.projectId!==undefined&&data.projectId!==selected.projectId)throw new AppError('INVALID');
    const result=['reference','reference-location'].includes(selected.operation)?await new ProjectReferences(router)[selected.operation==='reference-location'?'locate':'resolve']({...data,projectId:selected.projectId}):await router.withProject(selected.projectId,async storage=>{
     if(selected.bookOperation==='import'){
      const imports=new LabBookImports(storage,registry,this.deviceStore);
      if(selected.operation.endsWith('/pending')){if(!data||Object.keys(data).some(key=>!['after','limit'].includes(key)))throw new AppError('INVALID');return imports.pending(data);}
      if(selected.operation.endsWith('/cancel'))return imports.cancel(data,{check:assertCurrent,onProgress});
      return imports.run(data,{resume:selected.operation.endsWith('/resume'),check:assertCurrent,onProgress,opened:async(entry,vault)=>{await assertCurrent();new LabBookAccessSession(this,client,storage,entry.labBookId,assertCurrent).save(entry.root,(await readAccess(entry.root)).etag,vault);}});
     }
     if(selected.bookOperation==='placements'){if(!data||Object.keys(data).some(key=>!['after','limit'].includes(key)))throw new AppError('INVALID');return this.bookPlacements.pending(storage,data);}
     if(selected.bookOperation)return executeLabBookRequest(storage,selected,data,{deviceStore:this.deviceStore,placementStatus:()=>this.bookPlacements.status(storage,selected.labBookId),placementRoot:()=>this.bookPlacements.root(storage,selected.labBookId),publishBook:async entry=>{await assertCurrent();await new LabBookDirectory(registry).register(selected.projectId,entry);},access:new LabBookAccessSession(this,client,storage,selected.labBookId,assertCurrent),transferRoots:async()=>[this.workspace.root,...(await registry.read()).value.projects.map(entry=>entry.root)],check:assertCurrent,signal,onProgress,download,stream,websiteId,binary,headless,query,contentLength,stopJobs:()=>this.jobs.invalidateBook(selected.projectId,selected.labBookId),publicationSources:host=>publicationSourceFactory(this,client,host,{scope:selected.projectId,labBookId:selected.labBookId,check}),jobs:(book,etag,current,retain)=>this.jobs.owner(session,book,etag,current,{projectId:selected.projectId,retain})});
     if(selected.operation==='access/details'){if(!data||Object.keys(data).length)throw new AppError('INVALID');return new ProjectAccessSettings(storage).details();}
     if(selected.operation==='access/password'){await this.jobs.invalidateProject(selected.projectId);return new ProjectAccessSettings(storage).password(data,{deviceStore:this.deviceStore,check:assertCurrent,changed:etag=>owner.accessChanged(etag)});}
     if(selected.operation?.startsWith('storage/')){
      const copyOwner=async(command,options)=>{const books=new LabBookLocationAccess(this,client),projects=new ProjectLocationAccess(this,client,{check:assertCurrent});try{return await command.run(storage,{...options,withBook:(id,use)=>books.use(storage,id,owner,use),withProject:(id,use)=>projects.withProject(id,use),withProjectBook:(project,id,use)=>projects.withBook(project,id,use)});}finally{books.close();await projects.close();}};
      const moveOwner=async options=>{const books=new LabBookLocationAccess(this,client);try{return await moves.run(selected.projectId,owner.vault,{...options,withBook:(id,use)=>books.use(storage,id,owner,use),onCopiedBook:book=>books.copied(book),onAdopt:async latest=>{await acceptRelocation(latest);books.relocateGrants();}});}finally{books.close();}};
      if(selected.write&&!selected.operation.startsWith('storage/export')&&!selected.operation.endsWith('/cancel'))await this.jobs.invalidateProject(selected.projectId);
      if(selected.operation==='storage/details'){if(!data||Object.keys(data).length)throw new AppError('INVALID');return {path:storage.root,projectId:storage.projectId,parentId:(await registry.locate(storage.projectId)).parentId,move:await this.renames.moveStatus(selected.projectId,await moves.status(selected.projectId),storage.root),copy:await copies.status(selected.projectId),export:await archives.status(selected.projectId)};}
      if(['storage/copy/cancel','storage/export/cancel','storage/move/cancel'].includes(selected.operation)){if(!data||Object.keys(data).join()!=='id'||!researchId(data.id))throw new AppError('INVALID');return ({copy:copies,export:archives,move:moves}[selected.operation.split('/')[1]]).cancel(storage,{id:data.id});}
      if(['storage/copy/resume','storage/export/resume'].includes(selected.operation)){if(!data||Object.keys(data).join()!=='id'||!researchId(data.id))throw new AppError('INVALID');return copyOwner(selected.operation==='storage/export/resume'?archives:copies,{id:data.id,resume:true,onProgress});}
      if(selected.operation==='storage/move/status'){if(!data||Object.keys(data).length)throw new AppError('INVALID');return {move:await this.renames.moveStatus(selected.projectId,await moves.status(selected.projectId),storage.root)};}
      if(selected.operation==='storage/move/resume'){if(!data||Object.keys(data).join()!=='id'||!researchId(data.id))throw new AppError('INVALID');return moveOwner({id:data.id,resume:true,onProgress});}
      if(data&&Object.keys(data).sort().join()==='id,parent'&&['storage/copy','storage/export'].includes(selected.operation)){if(typeof data.parent!=='string')throw new AppError('INVALID');data={id:data.id,path:storageCreationPath(data.parent,path.basename(storage.root))};}
      if(!data||Object.keys(data).sort().join()!=='id,path'||!researchId(data.id)||typeof data.path!=='string')throw new AppError('INVALID');
      const destination=await resolveLocation(data.path),within=(a,b)=>{const relative=path.relative(a,b);return relative===''||relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);};
      const roots=[this.workspace.root,...(await registry.read()).value.projects.map(entry=>entry.root)];if(roots.some(root=>within(root,destination)||within(destination,root)))throw new AppError('STORAGE_PATH');
      return copyOwner(selected.operation==='storage/export'?archives:copies,{id:data.id,path:destination,onProgress});
     }
     if(selected.review)return executeReviewRequest(storage,this.deviceStore,selected.review,data);
     if(selected.starter)return executeRecordStarterRequest(storage,selected,data,{signal,binary});
     if(selected.asset)return executeProjectAsset(storage,selected,data,{signal,stream,query,contentLength,binary,jobs:()=>this.jobs.owner(session,storage,owner.etag,assertCurrent)});
     if(selected.publication){const jobs=await this.jobs.owner(session,storage,owner.etag,assertCurrent);return jobs.publications.run(selected,data,{websiteId,binary,headless,signal,check:assertCurrent,sourceReader:publicationSourceFactory(this,client,jobs.storage,{scope:selected.projectId,check})});}
     if(selected.intake){const jobs=await this.jobs.owner(session,storage,owner.etag,assertCurrent),response=await intakeCommand(storage,jobs.queue,selected.intake,data,{signal});jobs.worker.wake();return response;}
     if(selected.material)return executeMaterialRequest(storage,selected,data,{signal,download,stream,jobs:()=>this.jobs.owner(session,storage,owner.etag,assertCurrent)});
     if(selected.calendar)return this.calendars.run(session,storage,owner.etag,selected.calendar,data,{signal,authenticate:this.authenticate});
     const response=await (projectModuleRequest(selected.route)?selected.run(storage,data,{signal,check:assertCurrent}):executeResearchRequest(storage,selected.route,data,{signal}));
     if(selected.route==='/api/modules/command'&&response.entities)this.calendars.reconcile(session,storage.projectId,response.entities);
     if(selected.route==='/api/workspace/structure'&&data.change?.kind==='project')await registry.refreshSummary(storage.projectId,(await storage.outline()).metadata);
     return response;
    },{action:selected.write?'write':'read',locationOnly:selected.bookOperation==='list'||['storage/details','storage/move/status'].includes(selected.operation)});
    await assertCurrent();return result;
   }finally{setCheck(check);await owner.close();}
  },selected.projectId,selected.operation==='lab-books/access/lock'?undefined:selected.labBookId);
 }
}
