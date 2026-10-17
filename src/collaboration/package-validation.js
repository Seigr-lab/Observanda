import {configurationBootstrap} from './configuration-transfer.js';
import {mkdtemp,rm,realpath} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {Workspace,privateDirectory} from '../storage.js';
import {clearVault} from '../encryption.js';
import {openCatalogue,ResearchCatalogue,catalogueContext} from '../research-catalogue.js';
import {packageSelection,populateSharedWorkspace} from './research-package.js';

// Incoming research is checked with the ordinary native catalogue, material,
// media and record validators before the owner is offered an acceptance action.
// The detached schema is dropped on close; temporary bytes are encrypted with
// a one-use key, including on verification failure.
export async function validateResearchPackage(parts){
 const selection=await packageSelection(parts),directory=await realpath(await mkdtemp(path.join(os.tmpdir(),'observanda-collaboration-validation-'))),vault={id:randomUUID(),key:randomBytes(32)};
 let db;
 try{
  const workspace=new Workspace(directory,vault);await privateDirectory(directory,'.observanda');db=await openCatalogue(directory,{create:true,detached:true});await db.run('BEGIN');
  await catalogueContext.run({root:directory,db,afterCommit:[]},async()=>{await new ResearchCatalogue(workspace,db).put(configurationBootstrap(selection.metadata));await populateSharedWorkspace(workspace,parts);});
 }finally{
  try{await db?.close();}finally{clearVault(vault);if(path.dirname(directory)===await realpath(os.tmpdir())&&path.basename(directory).startsWith('observanda-collaboration-validation-'))await rm(directory,{recursive:true,force:true,maxRetries:5});}
 }
}
