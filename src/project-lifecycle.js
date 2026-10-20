import {incomingProjectMove} from './project-incoming-moves.js';
import {assertImportedProjectReady} from './project-import-state.js';
// Lifecycle operations share only the selected project's ownership lease.
// Ordinary record transactions and other projects do not enter this queue.
import path from 'node:path';
import {assertRegular,privateDirectory} from './storage.js';
import {withWriterLease} from './writer-lease.js';
import {researchId} from './web/research-reference.js';
import {AppError} from './errors.js';
const journals={'workspace-move':'project-workspace-moves',rename:'project-renames',adopt:'project-adoption-operations',copy:'project-copies',archive:'project-archives',move:'project-moves',delete:'project-deletions','retire-records':'project-record-retirements','retire-originals':'project-original-retirements','retire-metadata':'project-metadata-retirements','retire-modules':'project-module-retirements','retire-media':'project-media-retirements','retire-uploads':'project-upload-retirements','retire-intakes':'project-intake-retirements','retire-publications':'project-publication-retirements'};
export async function withProjectLifecycle(registry,projectId,kind,operation,{wait=true}={}){
 if(!researchId(projectId)||!['open',...Object.keys(journals)].includes(kind)||typeof operation!=='function')throw new AppError('INVALID');
 const directory=await privateDirectory(registry.workspace.root,'.observanda/project-lifecycle');
 return withWriterLease(path.join(directory,projectId+'.lock'),async()=>{
  await assertImportedProjectReady(registry,projectId);
  if(await incomingProjectMove(registry,projectId))throw new AppError('STORAGE_PROJECT_BUSY');
  for(const [other,folder] of Object.entries(journals)){
   if(other===kind||['copy','archive'].includes(kind)&&['copy','archive'].includes(other))continue;const file=path.join(registry.workspace.root,'.observanda',folder,projectId+'.obsv'),stat=await assertRegular(file,{missing:true});if(!stat)continue;
   if(stat.size>(['move','rename','workspace-move','delete'].includes(other)?16*1024*1024:32768))throw new AppError('STORAGE_PROJECT_BUSY');let receipt;
   try{receipt=JSON.parse(await registry.workspace.readFile(file,'utf8'));}catch{throw new AppError('STORAGE_PROJECT_BUSY');}
   if(!(other==='move'?[1,2,3]:['rename','workspace-move'].includes(other)?[1,2]:[1]).includes(receipt?.version)||receipt.projectId!==projectId||!researchId(receipt.id)||!(receipt.phase==='complete'||['copy','archive','move','rename','workspace-move'].includes(other)&&receipt.phase==='cancelled'))throw new AppError('STORAGE_PROJECT_BUSY');
  }
  return operation();
 },{wait});
}
