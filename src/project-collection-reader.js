import {readFile} from 'node:fs/promises';
import {digest} from './storage-format.js';
import {ProjectSessionOwner} from './project-session-owner.js';
import {LabBookRegistry} from './lab-book-registry.js';
import {LabBookRouter} from './lab-book-router.js';
import {LabBookAccessSession} from './lab-book-access-session.js';
import {readAccess} from './access.js';
import {clearVault} from './encryption.js';
import {AppError} from './errors.js';
// At most one visible owner retains a credential here. Selection comes from
// authenticated immutable query members, never from a supplied filesystem path.
export function projectCollectionReader(application,client,check){
 let current=null;const guards=new Map();
 async function close(){const saved=current;current=null;clearVault(saved?.vault);await saved?.owner?.close();}
 return {
  useStorage(target,consume){return this.use(target,null,consume,{storageOnly:true});},
  async use(target,snapshotId,consume,{prepare,storageOnly=false}={}){
   await check();const identity=JSON.stringify(target);
   if(current?.identity!==identity){
    // Adjacent books can share the same authenticated project parent. Release
    // the previous book key while retaining only that request-owned parent;
    // its original grant and every book grant still participate in verification.
    const parent=current&&current.target.projectId===target.projectId?current.owner:null;
    if(parent){clearVault(current.vault);current=null;}else await close();
    const selected={identity,target,owner:parent,vault:null,storage:null};current=selected;
    try{
     if(!target.projectId){selected.storage=application.workspace;selected.verify=check;}
     else{
      const owner=selected.owner??new ProjectSessionOwner(application,client,target.projectId,{check,recoverRenames:false});selected.owner=owner;
      await owner.use(async project=>{
       selected.storage=project;selected.verify=()=>owner.check();
       if(target.labBookId){
        const registry=new LabBookRegistry(project),access=new LabBookAccessSession(application,client,project,target.labBookId,()=>owner.check());let root,etag,entry;
        try{
         let stamp=digest(await readFile(registry.file));
         const router=new LabBookRouter(registry,{authorize:async()=>{await access.check();return true;},unlock:async(location,saved)=>{entry=location;root=entry.root;etag=saved.etag;return selected.vault=await access.key(root);}});
         await router.withLabBook(target.labBookId,storage=>{selected.storage=storage;});
         selected.verify=async()=>{
          await owner.check();await access.check();const currentStamp=digest(await readFile(registry.file));
          if(currentStamp!==stamp){
           // Directory changes may concern a sibling. Reopen only the parent
           // with the original grants; previous reader keys may be cleared.
           const fresh=new ProjectSessionOwner(application,client,target.projectId,{check:async()=>{await owner.check();await access.check();},recoverRenames:false});
           try{await fresh.use(async project=>{
            const current=await new LabBookRegistry(project).locate(target.labBookId);
            if(['root','vaultId','namespaceId'].some(key=>current[key]!==entry[key]))throw access.error(new AppError('ACCESS_LOCKED'));
           },{locationOnly:true});}finally{await fresh.close();}
           stamp=currentStamp;
          }
          if((await readAccess(root)).etag!==etag)throw access.error(new AppError('ACCESS_LOCKED'));
         };
        }catch(error){throw access.error(error);}
       }
      },{locationOnly:true});
     }
    }catch(error){if(target.projectId&&['ACCESS_LOCKED','ACCESS_DENIED','ACCESS_WAIT','AUTH','DEVICE_UNKNOWN'].includes(error.code))error.projectId??=target.projectId;await close();throw error;}
   }
   const selected=current;
   const result=await application.tracked(async()=>{await selected.verify();await prepare?.(selected.storage);await selected.verify();
    if(storageOnly){
     // Mutation callers acquire their own short domain transaction. Never
     // retain the reader transaction across an independently owned write.
     await selected.storage.catalogue(async store=>{if((await store.snapshot()).metadata.id!==target.workspaceId)throw new AppError('DATABASE_LOCATION');});
     const value=await consume(selected.storage,{check:selected.verify});await selected.verify();return value;
    }
    return selected.storage.catalogue(async store=>{
    const revision=snapshotId??await store.head(),snapshot=await store.snapshot(revision);if(snapshot.metadata.id!==target.workspaceId)throw new AppError('DATABASE_LOCATION');
    const value=await consume(store,snapshot,{snapshotId:revision,storage:selected.storage});await selected.verify();return value;
   });},target.projectId,target.labBookId??undefined);
   guards.set(identity,selected.verify);return result;
  },
  async verify(){for(const verify of guards.values())await verify();await check();},close
 };
}
