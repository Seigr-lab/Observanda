import {AsyncLocalStorage} from 'node:async_hooks';
import {ProjectSessionOwner} from './project-session-owner.js';
import {LabBookRegistry} from './lab-book-registry.js';
import {LabBookRouter} from './lab-book-router.js';
import {LabBookAccessSession} from './lab-book-access-session.js';
import {readAccess} from './access.js';
import {clearVault} from './encryption.js';
import {AppError} from './errors.js';
import {createCatalogueConnections} from './catalogue-connections.js';
// At most one visible owner retains a credential here. Selection comes from
// authenticated immutable query members, never from a supplied filesystem path.
export function projectCollectionReader(application,client,check){
 let current=null,tail=Promise.resolve();const guards=new Map(),active=new AsyncLocalStorage();
 let workspaceConnections=Buffer.isBuffer(application.workspace.vault?.key)?createCatalogueConnections(application.workspace):null;
 const withWorkspace=operation=>workspaceConnections?workspaceConnections.run(operation):Buffer.isBuffer(application.workspace.vault?.key)?application.workspace.withCatalogueConnections(operation):operation();
 const ordered=operation=>{
  // A callback cannot switch or close the owner that its own transaction uses.
  // Reject reentrant requests explicitly instead of waiting behind ourselves.
  if(active.getStore())return Promise.reject(new AppError('LOCKED'));
  const result=tail.then(()=>active.run(true,operation));tail=result.then(()=>{},()=>{});return result;
 };
 async function release(saved,keepParent=false){
  let failure;
  try{await saved?.connections?.close();}catch(error){failure=error;}
  finally{
   clearVault(saved?.vault);
   if(!keepParent||failure){
    try{await saved?.parentConnections?.close();}catch(error){failure??=error;}
    try{await saved?.owner?.close();}catch(error){failure??=error;}
   }
  }
  if(failure)throw failure;
 }
 async function close(){const saved=current;current=null;await release(saved);}
 async function use(target,snapshotId,consume,{prepare,storageOnly=false}={}){
   await check();const identity=JSON.stringify(target);
   if(current?.identity!==identity){
    // Adjacent books can share the same authenticated project parent. Release
    // the previous book key while retaining only that request-owned parent;
    // its original grant and every book grant still participate in verification.
    const parent=current&&current.target.projectId===target.projectId?current.owner:null,parentConnections=parent?current.parentConnections:null;
    if(parent){const previous=current;current=null;await release(previous,true);}else await close();
    const selected={identity,target,owner:parent,parentConnections,vault:null,storage:null};current=selected;
    try{
     if(!target.projectId){selected.storage=application.workspace;selected.verify=check;}
     else{
      const owner=selected.owner??new ProjectSessionOwner(application,client,target.projectId,{check,recoverRenames:false});selected.owner=owner;
      await owner.use(async project=>{
       selected.parentConnections??=createCatalogueConnections(project);
       return selected.parentConnections.run(async()=>{
       selected.storage=project;selected.verify=()=>owner.check();
       if(target.labBookId){
        const registry=new LabBookRegistry(project),access=new LabBookAccessSession(application,client,project,target.labBookId,()=>owner.check());let root,etag,entry;
        try{
         let stamp=await registry.version();
         const router=new LabBookRouter(registry,{authorize:async()=>{await access.check();return true;},unlock:async(location,saved)=>{entry=location;root=entry.root;etag=saved.etag;return selected.vault=await access.key(root);}});
         await router.withLabBook(target.labBookId,storage=>{selected.storage=storage;},{withStorage:(storage,admit)=>{
          selected.connections=createCatalogueConnections(storage);return selected.connections.run(admit);
         }});
         const withParent=async operation=>{
          // A live selected parent already owns this exact authenticated key.
          // Its directory version opens a fresh snapshot; do not authenticate
          // another parent merely to read that head. Earlier-owner guards may
          // outlive the key, so they still reopen through their original grant.
          if(!owner.closed)return selected.parentConnections.run(async()=>{const value=await operation(project);await access.check();return value;});
          const fresh=new ProjectSessionOwner(application,client,target.projectId,{check:()=>access.check(),recoverRenames:false});
          try{return await fresh.use(parent=>parent.withCatalogueConnections(()=>operation(parent)),{locationOnly:true});}finally{await fresh.close();}
         };
         selected.verify=async()=>{
          // The book check also revalidates this exact parent owner. A released
          // parent is opened only once for this complete membership check.
          await access.check();return withParent(async parent=>{
           const registry=new LabBookRegistry(parent),[directory,savedAccess]=await Promise.allSettled([registry.version(),readAccess(root)]);
           if(directory.status==='rejected')throw directory.reason;
           const currentStamp=directory.value;let currentAccess;
           if(currentStamp!==stamp){
            const current=await registry.locate(target.labBookId);
            if(['root','vaultId','namespaceId'].some(key=>current[key]!==entry[key]))throw access.error(new AppError('ACCESS_LOCKED'));
            stamp=currentStamp;currentAccess=await readAccess(root);
           }else{
            if(savedAccess.status==='rejected')throw savedAccess.reason;
            currentAccess=savedAccess.value;
           }
           if(currentAccess.etag!==etag)throw access.error(new AppError('ACCESS_LOCKED'));
          });
         };
        }catch(error){throw access.error(error);}
       }
       });
      },{locationOnly:true});
     }
     // Legacy unkeyed host storage keeps its original catalogue admission;
     // only an authenticated native owner can retain a keyed connection scope.
     if(!selected.connections&&Buffer.isBuffer(selected.storage.vault?.key))selected.connections=createCatalogueConnections(selected.storage);
    }catch(error){if(target.projectId&&['ACCESS_LOCKED','ACCESS_DENIED','ACCESS_WAIT','AUTH','DEVICE_UNKNOWN'].includes(error.code))error.projectId??=target.projectId;await close();throw error;}
   }
   const selected=current;
   const read=async()=>{await selected.verify();if(prepare){await prepare(selected.storage);await selected.verify();}
    if(storageOnly){
     // Mutation callers acquire their own short domain transaction. Never
     // retain the reader transaction across an independently owned write.
     await selected.storage.catalogue(async store=>{if((await store.snapshot()).metadata.id!==target.workspaceId)throw new AppError('DATABASE_LOCATION');});
     const value=await consume(selected.storage,{check:selected.verify});await selected.verify();return value;
    }
    return selected.storage.catalogue(async store=>{
    const revision=snapshotId??await store.head(),snapshot=await store.snapshot(revision);if(snapshot.metadata.id!==target.workspaceId)throw new AppError('DATABASE_LOCATION');
    const value=await consume(store,snapshot,{snapshotId:revision,storage:selected.storage});await selected.verify();return value;
   });};
   const result=await application.tracked(()=>selected.connections?selected.connections.run(read):read(),target.projectId,target.labBookId??undefined);
   guards.set(identity,selected.verify);return result;
 }
 return {
  useStorage(target,consume){return this.use(target,null,consume,{storageOnly:true});},
  use:(...args)=>ordered(()=>withWorkspace(()=>use(...args))),
  verify:()=>ordered(()=>withWorkspace(async()=>{for(const verify of guards.values())await verify();await check();})),
  // Jobs retain grant witnesses after releasing request-owned connections.
  // Subsequent verification uses short independent connections with those same grants.
  close:()=>ordered(async()=>{const connections=workspaceConnections;workspaceConnections=null;try{await close();}finally{await connections?.close();}})
 };
}
