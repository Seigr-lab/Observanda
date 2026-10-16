import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {Client} from 'pg';
import {Workspace} from '../../src/storage.js';
import {CATALOGUE_ARCHIVE} from '../../src/postgres.js';
import {CATALOGUE_ACTIVATION} from '../../src/postgres-activation.js';
import {ResearchCatalogue} from '../../src/research-catalogue.js';
import {PublicationJobs} from '../../src/publication-jobs.js';
import {workspaceJobs} from '../../src/workspace-jobs.js';
import {websiteWorkspace,websiteJobQueue} from '../../src/website-workspace.js';
import {ResearchMaterials} from '../../src/research-materials.js';

// Only a synthetic fixture is passed over this private IPC channel. The parent
// kills this process at an actual persistence boundary, without running cleanup.
process.once('message',async({root,vault,point,upload,record,websiteId})=>{
 try{
  let schema,catalogueClient;
  const pause=async()=>{process.send({type:'checkpoint',schema});await new Promise(()=>{});};
  const query=Client.prototype.query;
  Client.prototype.query=async function(sql,...args){
   if(point==='before-commit'&&sql==='COMMIT'&&this===catalogueClient)await pause();
   const result=await query.call(this,sql,...args);
   if(typeof sql==='string'&&sql.startsWith('CREATE SCHEMA ')){schema=/"([^"]+)"/.exec(sql)[1];catalogueClient=this;}
   if(point==='commit'&&sql==='COMMIT'&&this===catalogueClient)await pause();
   return result;
  };
  const unlink=fs.unlink;
  fs.unlink=async function(file,...args){
   if(point==='retire'&&String(file).replaceAll('\\','/').endsWith('/'+CATALOGUE_ARCHIVE))await pause();
   if(point==='checkpoint'&&String(file).replaceAll('\\','/').endsWith('/'+CATALOGUE_ACTIVATION))await pause();
   return unlink.call(this,file,...args);
  };
  syncBuiltinESMExports();
  const workspace=new Workspace(root,{...vault,key:Buffer.from(vault.key,'base64')});
  if(point==='publication-capture'){
   let count=0;const read=ResearchCatalogue.prototype.record,storage=websiteWorkspace(workspace,websiteId);
   ResearchCatalogue.prototype.record=async function(...args){const value=await read.apply(this,args);if(++count===40)await pause();return value;};
   await new PublicationJobs(storage).start({etag:(await storage.outline()).etag},websiteJobQueue(workspaceJobs(workspace).queue,websiteId));
  }else if(point==='upload-stream'){
   async function* bytes(){yield Buffer.alloc(4096,0x5a);await pause();}
   await new ResearchMaterials(workspace).appendImport(upload.id,upload.index,bytes());
  }else if(point==='record-block-write'){
   await workspace.withLock(()=>workspace.catalogue(async store=>{await store.putRecord(record);await pause();}));
  }else await workspace.read();
  process.send({type:'unexpected-completion'});
 }catch(error){process.send({type:'error',message:error.code??error.message});}
});
