// Client-scoped authorization for one pending import. The existing encrypted
// import receipt owns native pages; plaintext passwords never enter those pages.
import path from 'node:path';
import {opendir} from 'node:fs/promises';
import {randomUUID,randomBytes} from 'node:crypto';
import {NativePortabilityCollection,createPortabilityCollection,portabilityCollection,releasePortabilityCollection,validPortabilityCollection} from './portability-collection.js';
import {ProjectImportInventory,importOwnerStorage} from './project-import-inventory.js';
import {ProjectImports} from './project-import.js';
import {readProjectImport,saveProjectImport,projectImportOwners} from './project-import-state.js';
import {ProjectOpening} from './project-opening.js';
import {projectRegistryLocationKey} from './project-registry-locations.js';
import {LabBookRegistry} from './lab-book-registry.js';
import {inspectArchivedOwnerDirectory} from './owner-directory-archive.js';
import {readAccess} from './access.js';
import {authenticateKeyring} from './security/keyring.js';
import {seal,unseal,clearVault} from './encryption.js';
import {assertRegular,privateDirectory,serialize} from './storage.js';
import {resolveLocation} from './locations.js';
import {storageCreationPath,storageFolderName,validateStorageName} from './storage-names.js';
import {researchId} from './web/research-reference.js';
import {withWriterLease} from './writer-lease.js';
import {AppError} from './errors.js';
const ttl=60*60*1000,identity=stat=>({dev:String(stat.dev),ino:String(stat.ino)}),same=(a,b)=>serialize(a)===serialize(b);
const within=(root,child)=>{const relative=path.relative(root,child);return relative===''||relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);};
const relativeOK=relative=>{if(typeof relative!=='string'||relative.length>16384||relative.includes('\\'))return false;try{if(relative)relative.split('/').forEach(part=>validateStorageName(part));return true;}catch{return false;}};
const ownerMatches=(actual,expected)=>['kind','projectId','labBookId','namespaceId','vaultId','relative','archiveDigest'].every(key=>expected?.[key]===undefined||actual?.[key]===expected[key]);
const accessFailure=relative=>new AppError('PROJECT_IMPORT_ACCESS',[relative,path.posix.basename(relative)]);
const credential=value=>{if(!value||Object.keys(value).sort().join()!=='password,recovery,username'||Object.values(value).some(item=>typeof item!=='string'||item.length>1024))throw new AppError('INVALID');return value;};
export function validImportAuthorization(value){
 const access=value?.access;
 return !!access&&access.version===1&&['import','cancel'].includes(access.intent)&&researchId(access.session)&&researchId(access.revision)&&Number.isSafeInteger(access.cursor)&&access.cursor>=0&&validPortabilityCollection(access.candidates)&&validPortabilityCollection(access.grants)&&access.candidates.id!==access.grants.id&&access.cursor<=access.candidates.count&&(access.initializing===undefined||access.initializing===true);
}
export async function eraseImportAuthorization(registry,value){
 if(!value.access)return;if(!validImportAuthorization(value))throw new AppError('STORAGE_COPY');
 // The receipt remains the cleanup authority until both namespaces, including
 // superseded roots, have been erased. Retrying either erase is harmless.
 await releasePortabilityCollection(registry.workspace,value.access.grants);
 await releasePortabilityCollection(registry.workspace,value.access.candidates);delete value.access;
}
export class ProjectImportAccess{
 constructor(application,{now=Date.now}={}){this.application=application;this.now=now;this.sessions=new Map();this.cleanups=new Set();this.cleanupQueue=new Map();this.closed=false;this.recovered=false;}
 scheduleCleanup(id,session){
  this.cleanupQueue.set(id,session);if(session.cleanup)return session.cleanup;
  const pending=this.cleanup(id,session).then(()=>{if(this.cleanupQueue.get(id)===session)this.cleanupQueue.delete(id);}).catch(()=>{}).finally(()=>{session.cleanup=null;this.cleanups.delete(pending);});session.cleanup=pending;this.cleanups.add(pending);return pending;
 }
 async cleanup(id,session){return this.locked(session.registry,id,async()=>{const value=await readProjectImport(session.registry,id,{metadataOnly:true});if(value?.access?.session!==session.stamp)return;if(value.accessOnly){value.phase='cancelled';await saveProjectImport(session.registry,value);}else{await eraseImportAuthorization(session.registry,value);await saveProjectImport(session.registry,value);}});}
 expire(){for(const [id,session] of this.sessions)if(!session.running&&session.expires<=this.now()){session.key.fill(0);this.sessions.delete(id);this.scheduleCleanup(id,session);}for(const [id,session] of this.cleanupQueue)this.scheduleCleanup(id,session);return Promise.all(this.cleanups);}
 async close(){this.closed=true;for(const [id,session] of this.sessions){session.key.fill(0);this.scheduleCleanup(id,session);}this.sessions.clear();for(const [id,session] of this.cleanupQueue)this.scheduleCleanup(id,session);await Promise.all(this.cleanups);}
 async recover(registry){
  await this.expire();if(this.recovered)return;for(const part of ['project-imports','project-imported']){const directory=path.join(registry.workspace.root,'.observanda',part);if(!await assertRegular(directory,{directory:true,missing:true}))continue;
   for await(const entry of await opendir(directory)){if(!entry.name.endsWith('.obsv')||!researchId(entry.name.slice(0,-5)))continue;const id=entry.name.slice(0,-5);await this.locked(registry,id,async()=>{const value=await readProjectImport(registry,id,{metadataOnly:true});if(value?.access&&!this.sessions.has(id)){if(value.accessOnly){value.phase='cancelled';await saveProjectImport(registry,value);}else{await eraseImportAuthorization(registry,value);await saveProjectImport(registry,value);}}});}
  }this.recovered=true;
 }
 session(client,id,stamp){this.expire();const session=this.sessions.get(id);if(this.closed||!session||session.client!==client||stamp!==undefined&&stamp!==session.stamp)throw new AppError('ACCESS_LOCKED');session.expires=this.now()+ttl;return session;}
 async operation(session,run){session.running=(session.running??0)+1;try{return await run();}finally{session.running--;session.expires=this.now()+ttl;}}
 async scoped(client,id,stamp,run){const session=this.session(client,id,stamp);return this.operation(session,run);}
 async locked(registry,id,operation){const directory=await privateDirectory(registry.workspace.root,'.observanda/project-imports');return withWriterLease(path.join(directory,id+'.lock'),operation,{wait:false});}
 async current(client,id,stamp){const session=this.session(client,id,stamp),registry=await this.application.registry(),value=await readProjectImport(registry,id,{metadataOnly:true});if(!value||!validImportAuthorization(value)||value.access.session!==session.stamp||['complete','cancelled','cancelling'].includes(value.phase))throw new AppError('ACCESS_LOCKED');return {session,registry,value};}
 async start(client,data,options={}){
  if(!data||Object.keys(data).some(key=>!['id','path','parentId','username','password','recovery','intent'].includes(key))||!researchId(data.id)||!['import','cancel'].includes(data.intent))throw new AppError('INVALID');credential({username:data.username,password:data.password,recovery:data.recovery});
  const registry=await this.application.registry(),imports=new ProjectImports(registry,this.application.deviceStore);await options.check?.();await this.expire();await this.recover(registry);const previous=this.sessions.get(data.id);if(previous&&previous.client!==client)throw new AppError('ACCESS_LOCKED');
  let value=await imports.header(data.id);if(value&&['complete','cancelled','cancelling'].includes(value.phase))throw new AppError('CONFLICT');
  if(!value&&(data.intent!=='import'||typeof data.path!=='string'))throw new AppError('INVALID');
  const source=value?.source??await resolveLocation(data.path);
  if(!value&&(await registry.state(projectRegistryLocationKey(source,registry.workspace.root),{index:'location'})).state==='active'){const {intent,...command}=data;return new ProjectOpening(registry,this.application.deviceStore).open(command,options);}
  return this.locked(registry,data.id,async()=>{
   value=await imports.header(data.id);if(value&&['complete','cancelled','cancelling'].includes(value.phase))throw new AppError('CONFLICT');
   if(value&&data.path!==undefined&&await resolveLocation(data.path)!==value.source||value&&data.parentId!==undefined&&data.parentId!==value.parentId)throw new AppError('CONFLICT');
   const parentId=value?.parentId??data.parentId??null,destination=value?.destination??storageCreationPath(await imports.parent(parentId),storageFolderName(source));
   if(!value&&(within(source,registry.workspace.root)||source!==destination&&(within(registry.workspace.root,source)||within(source,destination)||within(destination,source))))throw new AppError('STORAGE_PATH');
   const rootEntry=value&&!value.accessOnly?await projectImportOwners(registry,value).get(''):null,root=data.intent!=='cancel'&&rootEntry?.copied?destination:source,inventory=new ProjectImportInventory(this.application.deviceStore,[{relative:'',username:data.username,password:data.password,recovery:data.recovery}]);
   try{
    const unlocked=rootEntry?await inventory.unlock(root,'',data.intent==='cancel'?{vaultId:rootEntry.vaultId}:rootEntry):null,found=rootEntry?{entry:{...rootEntry,accessEtag:unlocked.access.etag},storage:importOwnerStorage(root,rootEntry,unlocked.vault)}:await inventory.owner(root,'','project',value?.manifest);await options.check?.();
    if(value?.accessOnly&&!same(identity(await assertRegular(source,{directory:true})),value.sourceIdentity))throw new AppError('CONFLICT');
    if(previous){previous.key.fill(0);this.sessions.delete(data.id);}if(value?.access){try{await eraseImportAuthorization(registry,value);await saveProjectImport(registry,value);}catch(error){if(previous)this.cleanupQueue.set(data.id,previous);throw error;}}
    const session={client,registry,key:randomBytes(32),stamp:randomUUID(),expires:this.now()+ttl};this.sessions.set(data.id,session);
    if(this.sessions.size>32){session.key.fill(0);this.sessions.delete(data.id);throw new AppError('LIMIT');}
    return await this.operation(session,async()=>{
    if(!value)value={version:2,id:data.id,source,destination,parentId,sourceIdentity:identity(await assertRegular(source,{directory:true})),destinationIdentity:null,phase:'authorizing',accessOnly:true,manifest:{projectId:found.entry.projectId,namespaceId:found.entry.namespaceId,vaultId:found.entry.vaultId},owners:null};
    value.access={version:1,intent:data.intent,session:session.stamp,revision:randomUUID(),cursor:0,initializing:true,candidates:new NativePortabilityCollection(null,randomUUID()).empty(),grants:new NativePortabilityCollection(null,randomUUID()).empty()};
    // Journal both namespace identities before the first grant-bearing write.
    await saveProjectImport(registry,value);
    const candidates=value.accessOnly?[{relative:'',kind:'project',parentId:null,expected:found.entry,authorized:false}]: (async function*(){for await(const entry of projectImportOwners(registry,value).entries())yield {relative:entry.relative,kind:entry.kind,parentId:entry.parentId??null,expected:entry,authorized:false};})();
    value.access.candidates=await createPortabilityCollection(registry.workspace,candidates,{id:value.access.candidates.id});
    value.access.grants=await createPortabilityCollection(registry.workspace,[],{id:value.access.grants.id});delete value.access.initializing;await saveProjectImport(registry,value);
    await this.accept(session,registry,value,portabilityCollection(registry.workspace,value.access.candidates).get(''),found,inventory.keys.get(''),options);inventory.forget('');
    return this.advance(session,registry,value,options);});
   }finally{inventory.close();}
  });
 }
 root(value,candidate){return value.access.intent!=='cancel'&&candidate.expected?.copied?value.destination:value.source;}
 async inspectBoundary(value){if(value.accessOnly&&!same(identity(await assertRegular(value.source,{directory:true})),value.sourceIdentity))throw new AppError('CONFLICT');}
 async accept(session,registry,value,candidate,found,vault,options){
  candidate=await candidate;
  await this.inspectBoundary(value);await options.check?.();const access=value.access,grants=portabilityCollection(registry.workspace,access.grants),candidates=portabilityCollection(registry.workspace,access.candidates),root=path.join(this.root(value,candidate),...candidate.relative.split('/'));
  const row={...found.entry,relative:candidate.relative,owner:found.entry,identity:identity(await assertRegular(root,{directory:true})),sealed:seal(vault.key,session.key,'Observanda/import-access/'+value.id+'/'+session.stamp+'/'+candidate.relative).toString('base64')};
  if(await grants.get(candidate.relative))await grants.update(candidate.relative,row);else await grants.append(row);await saveProjectImport(registry,value);
  if(value.accessOnly&&candidate.kind==='project'){
   const books=new LabBookRegistry(found.storage),inspect=operation=>found.entry.archiveDigest?inspectArchivedOwnerDirectory(books,found.entry.archiveDigest,operation):books.inspect(operation);
   await inspect(async view=>{
    const children=async function*(){
     for await(const {entry} of view.entries()){const relative=[candidate.relative,entry.directory].filter(Boolean).join('/');if(!await candidates.get(relative))yield {relative,kind:'lab-book',parentId:found.entry.projectId,expected:entry,authorized:false};}
     for await(const folder of await opendir(root)){
      if(folder.name==='.observanda'||!folder.isDirectory()&&!folder.isSymbolicLink()||(await view.get(view.nameKey(folder.name),{index:'location'}))?.state==='active')continue;
      const child=path.join(root,folder.name);await assertRegular(child,{directory:true});if(!await assertRegular(path.join(child,'.observanda/access.json'),{missing:true}))continue;
      const relative=[candidate.relative,folder.name].filter(Boolean).join('/');if(!await candidates.get(relative))yield {relative,kind:'project',parentId:found.entry.projectId,expected:null,authorized:false};
     }
    };
    await candidates.appendAll(children());
   });
  }
  await this.inspectBoundary(value);await options.check?.();if((await readAccess(root)).etag!==found.entry.accessEtag)throw new AppError('CONFLICT');
  await candidates.update(candidate.relative,{authorized:true});access.cursor++;access.revision=randomUUID();await saveProjectImport(registry,value);
 }
 async response(value,{offset=value.access.cursor,limit=1}={}){
  const access=value.access;if(access.initializing)throw new AppError('STORAGE_INCOMPLETE');if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>32)throw new AppError('INVALID');
  const registry=await this.application.registry(),page=await portabilityCollection(registry.workspace,access.candidates).page({offset,limit});
  return {id:value.id,session:access.session,revision:access.revision,items:page.items.map(item=>({relative:item.relative,name:item.relative?path.posix.basename(item.relative):path.basename(value.source),kind:item.kind,authorized:item.authorized})),next:page.next,total:access.candidates.count,authorized:access.cursor,ready:access.cursor===access.candidates.count};
 }
 async page(client,data,{check=async()=>{}}={}){
  if(!data||Object.keys(data).some(key=>!['id','session','revision','offset','limit'].includes(key))||!researchId(data.id)||!researchId(data.session))throw new AppError('INVALID');return this.scoped(client,data.id,data.session,async()=>{await check();const {value}=await this.current(client,data.id,data.session);if(data.revision!==undefined&&data.revision!==value.access.revision)throw new AppError('CONFLICT');const result=await this.response(value,data);await check();return result;});
 }
 async submit(client,data,options={}){
  if(!data||Object.keys(data).sort().join()!=='id,password,recovery,relative,revision,session,username'||!researchId(data.id)||!researchId(data.session)||!researchId(data.revision)||!relativeOK(data.relative))throw new AppError('INVALID');credential({username:data.username,password:data.password,recovery:data.recovery});
  const registry=await this.application.registry();return this.scoped(client,data.id,data.session,()=>this.locked(registry,data.id,async()=>{
   await options.check?.();const {session,value}=await this.current(client,data.id,data.session);if(value.access.revision!==data.revision)throw new AppError('CONFLICT');
   const page=await portabilityCollection(registry.workspace,value.access.candidates).page({offset:value.access.cursor,limit:1}),candidate=page.items[0];if(!candidate||candidate.relative!==data.relative||candidate.authorized)throw new AppError('CONFLICT');
   await this.acceptCredential(session,registry,value,candidate,credential({username:data.username,password:data.password,recovery:data.recovery}),options);return this.advance(session,registry,value,options);
  }));
 }
 async acceptCredential(session,registry,value,candidate,secret,options){
  const inventory=new ProjectImportInventory(this.application.deviceStore,[{relative:candidate.relative,...secret}]);
  try{const root=path.join(this.root(value,candidate),...candidate.relative.split('/')),unlocked=value.accessOnly?null:await inventory.unlock(root,candidate.relative,value.access.intent==='cancel'?{vaultId:candidate.expected.vaultId}:candidate.expected),found=value.accessOnly?await inventory.owner(root,candidate.relative,candidate.kind,candidate.kind==='lab-book'?{...candidate.expected,projectId:candidate.parentId??candidate.expected.projectId}:candidate.expected):{entry:{...candidate.expected,accessEtag:unlocked.access.etag},storage:importOwnerStorage(root,candidate.expected,unlocked.vault)};
   if(candidate.kind==='lab-book'&&found.entry.projectId!==(candidate.parentId??candidate.expected.projectId))throw new AppError('DATABASE_LOCATION');
   await this.accept(session,registry,value,candidate,found,inventory.keys.get(candidate.relative),options);
  }finally{inventory.close();}
 }
 async advance(session,registry,value,options){
  // Existing device grants need no password prompt. Bound each request while
  // retaining only one unlocked owner; the client continues another page.
  for(let count=0;count<32&&value.access.cursor<value.access.candidates.count;count++){
   const page=await portabilityCollection(registry.workspace,value.access.candidates).page({offset:value.access.cursor,limit:1});
   try{await this.acceptCredential(session,registry,value,page.items[0],{username:'',password:'',recovery:''},options);}
   catch(error){if(error.code!=='PROJECT_IMPORT_ACCESS')throw error;return this.response(value);}
  }
  const response=await this.response(value);if(!response.ready)response.automatic=true;return response;
 }
 async credentials(client,id,stamp,{check=async()=>{}}={}){
  const {session,registry,value}=await this.current(client,id,stamp);if(value.access.initializing||value.access.cursor!==value.access.candidates.count)throw new AppError('STORAGE_INCOMPLETE');
  const grants=portabilityCollection(registry.workspace,value.access.grants);
  return {verify:async entry=>{const row=await grants.get(entry.relative);if(!row||!ownerMatches(row.owner,entry))throw new AppError('DATABASE_LOCATION');},unlock:async(root,relative,access,expected)=>{
   await check();this.session(client,id,stamp);if(!relativeOK(relative))throw new AppError('INVALID');
   const row=await grants.get(relative);if(!row||row.owner.accessEtag!==access.etag)throw accessFailure(relative);if(!ownerMatches(row.owner,expected))throw new AppError('DATABASE_LOCATION');
   const source=path.join(value.source,...relative.split('/')),destination=path.join(value.destination,...relative.split('/'));if(root!==source&&(value.access.intent==='cancel'||root!==destination))throw new AppError('DATABASE_LOCATION');
   if(root===source&&!same(identity(await assertRegular(root,{directory:true})),row.identity))throw new AppError('CONFLICT');
   const vault={id:row.owner.vaultId,key:unseal(Buffer.from(row.sealed,'base64'),session.key,'Observanda/import-access/'+id+'/'+stamp+'/'+relative)};
   try{authenticateKeyring(access.value,vault);await check();this.session(client,id,stamp);return vault;}catch(error){clearVault(vault);throw error;}
  }};
 }
 async finish(client,data,options={}){
  if(!data||Object.keys(data).sort().join()!=='id,revision,session'||!researchId(data.id)||!researchId(data.session)||!researchId(data.revision))throw new AppError('INVALID');
  return this.scoped(client,data.id,data.session,async()=>{const {session,registry,value}=await this.current(client,data.id,data.session);if(value.access.revision!==data.revision)throw new AppError('CONFLICT');
  const credentialSource=await this.credentials(client,data.id,data.session,options),imports=new ProjectImports(registry,this.application.deviceStore),command={id:data.id,username:'',password:'',recovery:''};
   try{return value.access.intent==='cancel'?await imports.cancel(command,{...options,credentialSource}):await imports.run(command,{...options,credentialSource,resume:true});}
   finally{const current=await imports.header(data.id);if(current&&['complete','cancelled'].includes(current.phase)){session.key.fill(0);this.sessions.delete(data.id);if(current.access){current.access.erasing=true;try{await saveProjectImport(registry,current);}catch(error){this.cleanupQueue.set(data.id,session);throw error;}}}}
  });
 }
 async settled(id){const session=this.sessions.get(id);if(!session)return;const value=await readProjectImport(session.registry,id,{metadataOnly:true});if(value&&!['complete','cancelled'].includes(value.phase))return;session.key.fill(0);this.sessions.delete(id);await this.scheduleCleanup(id,session);}
 async release(client,data,{check=async()=>{}}={}){
  if(!data||Object.keys(data).sort().join()!=='id,session'||!researchId(data.id)||!researchId(data.session))throw new AppError('INVALID');const registry=await this.application.registry();return this.locked(registry,data.id,async()=>{
   await check();const {session,value}=await this.current(client,data.id,data.session);session.key.fill(0);this.sessions.delete(data.id);
   try{if(value.accessOnly){value.phase='cancelled';await saveProjectImport(registry,value);}else{await eraseImportAuthorization(registry,value);await saveProjectImport(registry,value);}}catch(error){this.cleanupQueue.set(data.id,session);throw error;}return {released:true};
  });
 }
}
