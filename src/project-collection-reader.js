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
  async use(target,snapshotId,consume,{prepare}={}){
   await check();const identity=JSON.stringify(target);
   if(current?.identity!==identity){
    await close();const selected={identity,target,owner:null,vault:null,storage:null};current=selected;
    try{
     if(!target.projectId){selected.storage=application.workspace;selected.verify=check;}
     else{
      const owner=new ProjectSessionOwner(application,client,target.projectId,{check,recoverRenames:false});selected.owner=owner;
      await owner.use(async project=>{
       selected.storage=project;selected.verify=()=>owner.check();
       if(target.labBookId){
        const registry=new LabBookRegistry(project),access=new LabBookAccessSession(application,client,project,target.labBookId,()=>owner.check());let root,etag;
        try{
         const router=new LabBookRouter(registry,{authorize:async()=>{await access.check();return true;},unlock:async(entry,saved)=>{root=entry.root;etag=saved.etag;return selected.vault=await access.key(root);}});
         await router.withLabBook(target.labBookId,storage=>{selected.storage=storage;});const stamp=digest(await readFile(registry.file));
         selected.verify=async()=>{await owner.check();await access.check();if(digest(await readFile(registry.file))!==stamp||(await readAccess(root)).etag!==etag)throw access.error(new AppError('ACCESS_LOCKED'));};
        }catch(error){throw access.error(error);}
       }
      },{locationOnly:true});
     }
    }catch(error){if(target.projectId&&['ACCESS_LOCKED','ACCESS_DENIED','ACCESS_WAIT','AUTH','DEVICE_UNKNOWN'].includes(error.code))error.projectId??=target.projectId;await close();throw error;}
   }
   const selected=current;
   const result=await application.tracked(async()=>{await selected.verify();await prepare?.(selected.storage);await selected.verify();return selected.storage.catalogue(async store=>{
    const revision=snapshotId??await store.head(),snapshot=await store.snapshot(revision);if(snapshot.metadata.id!==target.workspaceId)throw new AppError('DATABASE_LOCATION');
    const value=await consume(store,snapshot,{snapshotId:revision,storage:selected.storage});await selected.verify();return value;
   });},target.projectId,target.labBookId??undefined);
   guards.set(identity,selected.verify);return result;
  },
  async verify(){for(const verify of guards.values())await verify();await check();},close
 };
}
