import path from 'node:path';
import {AppError} from './errors.js';
import {FileContent,writeContent} from './file-content.js';
import {withMutationFilesSession} from './mutation-files.js';
import {nativeMember} from './native-storage-tree.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {withScratch} from './scratch-work.js';
import {materialReferenceKey,validMaterialReference} from './web/material-reference.js';
import {datasetExchangeSelection} from './dataset-exchange-table.js';
import {datasetExchangeJSONL} from './dataset-exchange-jsonl.js';
import {exchangeDelimitedRendition,exchangeManifest} from './dataset-exchange-renditions.js';
import {zipStream} from './zip-stream.js';
import {isStorageTemporary} from './storage-temporary.js';
import {exact} from './modules/validation.js';

const names=['dataset.jsonl','dataset.csv','dataset.tsv','manifest.jsonl','source-grants.jsonl'];
const damaged=()=>{throw new AppError('MATERIAL_MISSING');};
const base=(job,attempt)=>{
 if(!researchId(job)||!researchId(attempt))throw new AppError('INVALID');
 return '.observanda/materials/exchanges/'+job+'/'+attempt;
};
const privateFile=(workspace,job,attempt,name)=>{
 if(!names.includes(name))damaged();
 return path.join(workspace.root,base(job,attempt),name);
};
const visibleNames=format=>['manifest.jsonl','dataset.jsonl','dataset.'+format];
export function validExchangeCandidate(result){
 if(!exact(result,['version','attempt','format','files'])||result.version!==1||!researchId(result.attempt)||!['csv','tsv'].includes(result.format))return false;
 const names=[...visibleNames(result.format),'source-grants.jsonl'];
 return exact(result.files,names)&&names.every(name=>{
  const descriptor=result.files[name];
  return exact(descriptor,['sha256','size'])&&Number.isSafeInteger(descriptor.size)&&descriptor.size>=0&&revisionId(descriptor.sha256);
 });
}
export function* preparedExchangeMembers(workspace,job,candidate){
 if(!validExchangeCandidate(candidate))damaged();
 for(const name of [...visibleNames(candidate.format),'source-grants.jsonl']){
  const relative=base(job,candidate.attempt)+'/'+name;
  yield {relative,content:fileContent(workspace,job,candidate.attempt,name,candidate.files[name])};
 }
}
function fileContent(workspace,job,attempt,name,descriptor){
 if(!descriptor||!Number.isSafeInteger(descriptor.size)||descriptor.size<0||!revisionId(descriptor.sha256))damaged();
 return new FileContent(workspace,privateFile(workspace,job,attempt,name),descriptor.size,descriptor.sha256);
}
// Remove only the files identified by this attempt. An unexpected member is
// left intact. Native handles keep name changes from redirecting the cleanup.
export function removeExchangeAttempt(workspace,job,attempt){
 const relative=base(job,attempt);
 return withMutationFilesSession(async service=>{
  const root=await service.open(workspace.root);
  try{
   await nativeMember(root,relative,async(parent,name)=>{
    const own=await parent?.directory(name,{missing:true});if(!own)return;
    const identity=own.identity;let unknown=false;
    try{
     for await(const member of own.entries()){
      if(member.directory||!names.includes(member.name)&&!isStorageTemporary(member.name)){unknown=true;continue;}
      const stat=await own.stat(member.name);await own.remove(member.name,{identity:stat.identity});
     }
    }finally{await own.close();}
    if(!unknown)await parent.remove(name,{folder:true,identity});
   },{missing:true});
  }finally{await root.close();}
 });
}

export async function removeEarlierExchangeAttempts(workspace,job,attempt,held){
 const relative=base(job,attempt).slice(0,-attempt.length-1);
 await withMutationFilesSession(async service=>{
  const root=await service.open(workspace.root);
  try{
   await nativeMember(root,relative,async(parent,name)=>{
    const folder=await parent?.directory(name,{missing:true});if(!folder)return;
    try{
     for await(const entry of folder.entries()){
      if(entry.directory&&researchId(entry.name)&&entry.name!==attempt){await held();await removeExchangeAttempt(workspace,job,entry.name);}
     }
    }finally{await folder.close();}
   },{missing:true});
  }finally{await root.close();}
 });
}

export async function prepareExchangeFiles(materials,doc,command,{job,attempt,signal,check,checkSource,progress}){
 const {workspace}=materials,format=command.format,selection=datasetExchangeSelection(doc,command.selection);
 if(!['csv','tsv'].includes(format)||!workspace.vault?.id)throw new AppError('INVALID');
 const descriptors={};
 const write=async(name,chunks)=>{
  const location=privateFile(workspace,job,attempt,name),descriptor=await writeContent(workspace,location,chunks,{signal,beforeCommit:check,exclusive:true});
  descriptors[name]=descriptor;return fileContent(workspace,job,attempt,name,descriptor);
 };
 try{return await withScratch(async sources=>{
  const recent=new Map();
  const remember=async ref=>{
   const requested=materialReferenceKey(ref);
   if(recent.has(requested))return recent.get(requested);
   const canonical=await checkSource(ref);
   if(!validMaterialReference(canonical)||!canonical.workspaceId)damaged();
   await sources.add(materialReferenceKey(canonical),canonical);
   if(recent.size>=256)recent.delete(recent.keys().next().value);
   recent.set(requested,canonical);return canonical;
  };
  const typed=await write('dataset.jsonl',datasetExchangeJSONL(materials,doc,command.ref,selection,{signal,check,checkSource:remember,progress:({position})=>progress?.({stage:'exporting dataset',done:position-selection.offset,total:selection.count})}));
  await check();
  const delimited=await write('dataset.'+format,exchangeDelimitedRendition(typed.readStaged({signal}),format,{signal}));
  await write('manifest.jsonl',exchangeManifest(typed.readChunks(0,typed.size-1,{signal}),{format,typed,delimited,signal}));
  async function* grants(){for await(const ref of sources.items()){signal?.throwIfAborted();yield Buffer.from(JSON.stringify(ref)+'\n');}}
  await write('source-grants.jsonl',grants());
  await check();return {version:1,attempt,format,files:descriptors};
 },{signal});}
 catch(error){await removeExchangeAttempt(workspace,job,attempt);throw error;}
}

export async function* exchangeArchive(workspace,job,result,{check,checkSource,signal}){
 if(!validExchangeCandidate(result))damaged();
 const files=visibleNames(result.format);
 await check();
 const grants=fileContent(workspace,job,result.attempt,'source-grants.jsonl',result.files['source-grants.jsonl']);
 let pending=Buffer.alloc(0),seen=0;
 for await(const chunk of grants.readStaged({signal})){
  const data=pending.length?Buffer.concat([pending,chunk]):chunk;let offset=0;
  for(;;){
   const end=data.indexOf(10,offset);if(end<0)break;
   if(end-offset>512)damaged();
   let ref;try{ref=JSON.parse(data.toString('utf8',offset,end));}catch{damaged();}
   if(!validMaterialReference(ref)||!ref.workspaceId)damaged();
   const current=await checkSource(ref);
   if(materialReferenceKey(current)!==materialReferenceKey(ref))throw new AppError('WORKSPACE_CHANGED');
   seen++;offset=end+1;
  }
  if(data.length-offset>512)damaged();
  pending=Buffer.from(data.subarray(offset));
 }
 if(!seen||pending.length)damaged();
 await check();
 async function* members(){
  for(const name of files){
   signal?.throwIfAborted();await check();
   const source=fileContent(workspace,job,result.attempt,name,result.files[name]);
   // ZIP consumes the authenticated, handle-bound stream. Hold its grants
   // through every emitted chunk and the final ZIP directory.
   const guarded=new FileContent(workspace,source.file,source.size,source.sha256);
   guarded.stream=()=>source.readStaged({signal});
   yield [name,guarded];
  }
 }
 for await(const chunk of zipStream(members())){signal?.throwIfAborted();await check();yield chunk;}
}
