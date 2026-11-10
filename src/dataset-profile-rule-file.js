import {createHash} from 'node:crypto';
import {AppError} from './errors.js';
import {revisionText,revisionId} from './web/revision-model.js';
import {exact} from './modules/validation.js';
import {digest} from './storage-format.js';
import {FILE_CHUNK} from './web/evidence-fingerprint.js';
import {MAX_RECORD_COMMAND_BYTES} from './web/research-capacity.js';

const damaged=()=>{throw new AppError('MATERIAL_MISSING');};
const conflict=()=>{throw new AppError('MATERIAL_CHANGED');};
const encoded=rule=>Buffer.from(revisionText(rule)+'\n','utf8');
const filename='interpretation-rules.ndjson';
const provenance='Observanda dataset interpretation profile rules v1';

// Large, sparsely authored rule sets travel as an ordinary pinned original.
// Existing owner moves, backups and collaboration exports already carry it.
export function describeRuleFile(rules){
 const hash=createHash('sha256');let bytes=0;
 for(const rule of rules){
  const line=encoded(rule);bytes+=line.length;
  if(bytes>MAX_RECORD_COMMAND_BYTES)throw new AppError('LIMIT');
  hash.update(line);
 }
 return {sha256:hash.digest('hex'),count:rules.length,bytes};
}
export function validRuleFile(value){
 return exact(value,['sha256','count','bytes'])&&revisionId(value.sha256)&&
  Number.isSafeInteger(value.count)&&value.count>0&&Number.isSafeInteger(value.bytes)&&value.bytes>0&&value.bytes<=MAX_RECORD_COMMAND_BYTES;
}
async function* encodedChunks(rules){
 let buffer=Buffer.allocUnsafe(FILE_CHUNK),used=0;
 for(const rule of rules){
  const line=encoded(rule);
  for(let start=0;start<line.length;){
   const take=Math.min(line.length-start,buffer.length-used);
   line.copy(buffer,used,start,start+take);start+=take;used+=take;
   if(used===buffer.length){yield buffer;buffer=Buffer.allocUnsafe(FILE_CHUNK);used=0;}
  }
 }
 if(used)yield buffer.subarray(0,used);
}
export async function retainRuleFileLocked(materials,{recordId,id:profileId,inputs},rules,file,{signal,verify}){
 const key=digest(revisionText(['interpretation-rules-v1',recordId,profileId,inputs[0],file.sha256]));
 const id=[key.slice(0,8),key.slice(8,12),'4'+key.slice(13,16),'8'+key.slice(17,20),key.slice(20,32)].join('-');
 const prior=await materials.json(materials.metadataFile('imports/'+id+'/session.json'),{missing:true});
 if(prior&&(prior.recordId!==recordId||prior.name!==filename||prior.provenance!==provenance||
  prior.size!==file.bytes||revisionText(prior.derivesFrom)!==revisionText(inputs.slice(0,1))))conflict();
 if(!prior&&await materials.current(id,{includeStaged:true}))conflict();
 const state=prior?await materials.importState(id):await materials.startImportLocked({
  recordId,name:filename,size:file.bytes,provenance,derivesFrom:inputs.slice(0,1)
 },{},id);
 if(state.completed){
  const doc=await materials.read(state.completed);
  if(doc.kind!=='artifact'||doc.recordId!==recordId||doc.content.sha256!==file.sha256)damaged();
  return state.completed;
 }
 const received=materials.uploads.count(state);let index=0;
 for await(const chunk of encodedChunks(rules)){
  signal?.throwIfAborted();await verify?.();
  if(index>=received)await materials.appendImportLocked(id,index,[chunk],{signal});
  index++;
 }
 const prepared=await materials.prepareImport(id,{signal});
 if(prepared.sha256!==file.sha256)damaged();
 await verify?.();return materials.commitImport(id,prepared);
}
export async function readRuleFile(materials,ref,file,{recordId,width,template},{signal,check,verify}){
 if(!validRuleFile(file)||file.count>width||ref?.kind!=='artifact')damaged();
 await check?.(ref);
 const {doc,content}=await materials.artifact(ref,{verification:'descriptor',signal});
 if(doc.recordId!==recordId||doc.content.name!==filename||doc.content.provenance!==provenance||
  revisionText(doc.content.inputs)!==revisionText([template])||doc.content.sha256!==file.sha256||content.size!==file.bytes)damaged();
 const hash=createHash('sha256'),decoder=new TextDecoder('utf-8',{fatal:true}),rules=[];
 let carry='';
 for await(const chunk of content.readChunks(0,content.size-1,{signal})){
  signal?.throwIfAborted();await verify?.();hash.update(chunk);
  let text;try{text=carry+decoder.decode(chunk,{stream:true});}catch{damaged();}
  const lines=text.split('\n');carry=lines.pop();
  // One rule, including bounded aliases and accepted source spellings, fits
  // in one upload chunk even when the strings require JSON escapes.
  if(carry.length>FILE_CHUNK)damaged();
  for(const line of lines){
   if(!line.length||line.length>FILE_CHUNK||rules.length>=file.count)damaged();
   try{rules.push(JSON.parse(line));}catch{damaged();}
  }
 }
 let last;try{last=decoder.decode();}catch{damaged();}
 if(last||carry||rules.length!==file.count||hash.digest('hex')!==file.sha256)damaged();
 return rules;
}
