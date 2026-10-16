import path from 'node:path';
import {opendir} from 'node:fs/promises';
import {LabBookReparents} from './lab-book-reparent.js';
import {bookPlacementPending} from './lab-book-placement-state.js';
import {ProjectSessionOwner} from './project-session-owner.js';
import {LabBookAccessSession} from './lab-book-access-session.js';
import {LabBookRegistry} from './lab-book-registry.js';
import {projectTransferRunning,trackProjectTransfer} from './project-transfer-tasks.js';
import {assertRegular} from './storage.js';
import {withOperationProgress,operationStage} from './operation-progress.js';
import {readAccess} from './access.js';
import {clearVault} from './encryption.js';
import {researchId} from './web/research-reference.js';
import {AppError} from './errors.js';
const accessErrors=['ACCESS_LOCKED','ACCESS_DENIED','ACCESS_WAIT','AUTH','DEVICE_UNKNOWN'];
export class LabBookReparentApplication{
 constructor(application){this.application=application;}
 async status(project,labBookId){
  const registry=await this.application.registry(),command=new LabBookReparents(registry,labBookId),value=await command.read();
  if(!value||![value.sourceProjectId,value.targetProjectId].includes(project.projectId))return null;
  const target=await registry.locate(value.targetProjectId);
  return {id:value.id,labBookId,name:value.directory,sourceProjectId:value.sourceProjectId,projectId:value.targetProjectId,projectName:target.summary?.title??path.basename(target.root),phase:value.phase,running:projectTransferRunning(command.file()),canResume:!['complete','cancelled'].includes(value.phase)||!!await bookPlacementPending(project,labBookId)};
 }
 async pending(project,{after=null,limit=20}={}){
  if(after!==null&&!researchId(after)||!Number.isSafeInteger(limit)||limit<1||limit>50)throw new AppError('INVALID');
  const directory=path.join(project.root,'.observanda/lab-book-placements');if(!await assertRegular(directory,{directory:true,missing:true}))return {items:[],next:null};const ids=[];
  for await(const file of await opendir(directory)){const id=file.name.slice(0,-8);if(!file.name.endsWith('.pointer')||!researchId(id)||after!==null&&id<=after)continue;ids.push(id);ids.sort();if(ids.length>limit+1)ids.pop();}
  const more=ids.length>limit;if(more)ids.pop();const items=[];for(const id of ids){if((await bookPlacementPending(project,id))?.kind==='import')continue;const value=await this.status(project,id);if(value?.canResume)items.push(value);}return {items,next:more?ids.at(-1):null};
 }
 async root(project,labBookId){const command=new LabBookReparents(await this.application.registry(),labBookId),value=await command.read();if(!value||![value.sourceProjectId,value.targetProjectId].includes(project.projectId))throw new AppError('NOT_FOUND');return command.locate(value);}
 async run(client,projectId,labBookId,data,{resume=false,check=async()=>{},onProgress,checkpoint}={}){
  if(!data||Object.keys(data).sort().join()!==(resume?'id':'id,projectId')||!researchId(data.id)||!resume&&!researchId(data.projectId))throw new AppError('INVALID');
  const app=this.application,registry=await app.registry(),command=new LabBookReparents(registry,labBookId),previous=await command.read();let sourceId=projectId,targetId=data.projectId;
  if(resume){if(previous?.id!==data.id||![previous.sourceProjectId,previous.targetProjectId].includes(projectId))throw new AppError('NOT_FOUND');sourceId=previous.sourceProjectId;targetId=previous.targetProjectId;}
  return app.tracked(()=>trackProjectTransfer(command.file(),()=>withOperationProgress(onProgress,()=>operationStage('move-book',{},async()=>{
   const sourceOwner=new ProjectSessionOwner(app,client,sourceId,{check}),targetOwner=new ProjectSessionOwner(app,client,targetId,{check});let vault,started=false;
   const using=async(owner,operation)=>{try{return await owner.use(operation);}catch(error){if(accessErrors.includes(error.code))error.projectId??=owner.projectId;throw error;}};
   try{return await using(sourceOwner,source=>using(targetOwner,async target=>{
    const sourceAccess=new LabBookAccessSession(app,client,source,labBookId,()=>sourceOwner.check()),nextAccess=new LabBookAccessSession(app,client,target,labBookId,()=>targetOwner.check());
    const value=await command.read(),access=value?.id===data.id&&value.phase==='complete'?nextAccess:sourceAccess,root=value?.id===data.id?(value.phase==='complete'?(await new LabBookRegistry(target).locate(labBookId)).root:await command.locate(value)):(await new LabBookRegistry(source).locate(labBookId)).root;
    try{vault=await access.key(root);}catch(error){if(accessErrors.includes(error.code))error.projectId??=access===nextAccess?targetId:sourceId;throw error;}
    const current=async()=>{await sourceOwner.check();await targetOwner.check();await access.check();};await current();await app.jobs.invalidateBook(sourceId,labBookId);await app.jobs.invalidateBook(targetId,labBookId);
    started=true;const result=await command.run(source,target,vault,{id:data.id,check:current,checkpoint});await current();
    nextAccess.save(result.book.root,(await readAccess(result.book.root)).etag,vault);if(access.id!==nextAccess.id)app.forget(app.session(client),access.id);return result;
   }));}catch(error){if(!started&&accessErrors.includes(error.code))error.operationNotStarted=true;throw error;}finally{clearVault(vault);await sourceOwner.close();await targetOwner.close();}
  }))),sourceId,labBookId);
 }
}
