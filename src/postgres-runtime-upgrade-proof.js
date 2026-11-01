import {createHash} from 'node:crypto';
import {seal,unseal} from './encryption.js';
import {nativeMember,nativeMemberCursor} from './native-storage-tree.js';
import {diskCapacity} from './disk-capacity.js';
import {writeFilePart} from './segmented-file-io.js';
import {temporaryWriteName} from './storage-temporary.js';
import {runtimeUpgradeError,replacementRuntimeControl,runtimeConfigurationFiles,supportedRuntimeMember} from './postgres-runtime-upgrade-config.js';

export const proofDirectory='.runtime-migration-proof';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function writeUpgradeFile(parent,name,bytes){
 const temporary=temporaryWriteName();let file,identity;
 try{file=await parent.file(temporary,{mode:'exclusive'});identity=file.identity;await writeFilePart(file,bytes,0);await file.sync();await file.close();file=null;await parent.rename(temporary,parent,name,{identity,replace:true});identity=null;}
 finally{await file?.close();if(identity)await parent.remove(temporary,{identity}).catch(()=>{});}
}
const same=(actual,expected)=>actual?.bytes===expected.bytes&&actual.sha256===expected.sha256;
const fail=()=>{throw runtimeUpgradeError('source-or-copy-changed');};
function accumulator(){let sum=0n,count=0;return {add(value){sum=(sum+BigInt('0x'+digest(Buffer.from(JSON.stringify(value)))))% (1n<<256n);count++;},value:()=>({count,digest:sum.toString(16).padStart(64,'0')})};}
function sourceProof(entry){return entry.directory?{path:entry.path,directory:true,identity:entry.identity}:{path:entry.path,directory:false,identity:entry.identity,bytes:entry.bytes,sha256:entry.sha256};}
async function *walk(root,prefix=''){
 for await(const item of root.entries()){
  if(!prefix&&item.name==='owner.lock')continue;
  const relative=prefix+item.name;supportedRuntimeMember(relative,item.directory);
  if(item.directory){const child=await root.directory(item.name);try{yield {path:relative,directory:true,identity:child.identity};yield* walk(child,relative+'/');}finally{await child.close();}}
  else yield {path:relative,directory:false,...await root.hash(item.name)};
 }
}
export async function copyRuntimeWithProof(source,target,journal,{signal,directory,onProgress=()=>{},capacity=diskCapacity,reserveBytes=256*1024*1024}={}){
 const proof=await target.directory(proofDirectory,{create:true,exclusive:true}),key=Buffer.from(journal.key,'hex');let page=[],pageNumber=0,total=0,reservation,metadata,input,output;const aggregate=accumulator();
 const flush=async()=>{if(!page.length)return;const bytes=Buffer.from(JSON.stringify(page)),index=pageNumber++;try{const stored=seal(bytes,key,'Observanda/runtime-copy/v1/'+journal.id+'/'+index);await metadata.write(stored.length,()=>writeUpgradeFile(proof,'page-'+index,stored));}finally{bytes.fill(0);}page=[];};
 try{
  metadata=await capacity.reserve(directory,0,{reserveBytes,signal});
  for await(const entry of walk(source)){
   signal?.throwIfAborted();aggregate.add(sourceProof(entry));
   if(!entry.directory){
    entry.target={bytes:entry.bytes,sha256:entry.sha256};
    if(runtimeConfigurationFiles.has(entry.path))await nativeMember(source,entry.path,async(parent,name)=>{const bytes=(await parent.read(name,{limit:65536})).bytes;let replacement;try{if(digest(bytes)!==entry.sha256)fail();replacement=replacementRuntimeControl(entry.path,bytes);entry.target={bytes:replacement.length,sha256:digest(replacement)};entry.replacement=replacement.toString('base64');}finally{bytes.fill(0);replacement?.fill(0);}});
    total+=entry.target.bytes;if(!Number.isSafeInteger(total))throw runtimeUpgradeError('source-size-unrepresentable');
   }
   onProgress({stage:'upgrade',phase:'inventory',files:aggregate.value().count,bytes:total});
   page.push(entry);if(page.length>=32||Buffer.byteLength(JSON.stringify(page))>24576)await flush();
  }
  await flush();journal.pages=pageNumber;journal.sourceProof=aggregate.value();metadata.release();metadata=null;
  reservation=await capacity.reserve(directory,total,{reserveBytes,signal,refreshBytes:8*1024*1024});input=nativeMemberCursor(source);output=nativeMemberCursor(target);let completed=0,files=0;
  for await(const entry of runtimeProofEntries(target,journal)){
   signal?.throwIfAborted();const destination=await output.member(entry.path);
   if(entry.directory){const child=await destination.directory.directory(destination.name,{create:true,exclusive:true});await child.close();continue;}
   const origin=await input.member(entry.path);
   await reservation.write(entry.target.bytes,async()=>{
    if(entry.replacement){const bytes=Buffer.from(entry.replacement,'base64');try{await destination.directory.write(destination.name,[bytes],entry.target);}finally{bytes.fill(0);}}
    else await destination.directory.copy(origin.directory,origin.name,destination.name,{bytes:entry.bytes,sha256:entry.sha256,signal,onProgress:bytes=>onProgress({stage:'upgrade',phase:'copy',bytes:completed+bytes,total,percent:total?Math.floor(100*(completed+bytes)/total):100})});
   });
   // Publication performs the complete target readback once, after every
   // durable copy has finished. Re-reading each file here would duplicate it.
   completed+=entry.target.bytes;files++;onProgress({stage:'upgrade',phase:'copy',bytes:completed,total,files,percent:total?Math.floor(100*completed/total):100});
  }
 }finally{metadata?.release();reservation?.release();await input?.close();await output?.close();key.fill(0);await proof.close();}
}
export async function *runtimeProofEntries(target,journal){
 const root=await target.directory(proofDirectory),key=Buffer.from(journal.key,'hex');
 try{for(let page=0;page<journal.pages;page++){const bytes=unseal((await root.read('page-'+page,{limit:65536})).bytes,key,'Observanda/runtime-copy/v1/'+journal.id+'/'+page);let entries;try{entries=JSON.parse(bytes.toString('utf8'));}finally{bytes.fill(0);}if(!Array.isArray(entries)||!entries.length||entries.length>32)fail();for(const entry of entries)yield entry;}}
 finally{key.fill(0);await root.close();}
}
export async function verifyRuntimeProof(source,target,journal,{targetFiles=true,signal}={}){
 const actual=accumulator(),expected=accumulator();
 for await(const entry of walk(source)){signal?.throwIfAborted();actual.add(sourceProof(entry));}
 for await(const entry of runtimeProofEntries(target,journal)){
  signal?.throwIfAborted();expected.add(sourceProof(entry));
  if(targetFiles)await nativeMember(target,entry.path,async(parent,name)=>{if(entry.directory){const directory=await parent.directory(name);await directory.close();}else if(!same(await parent.hash(name),entry.target))fail();});
 }
 if(JSON.stringify(actual.value())!==JSON.stringify(journal.sourceProof)||JSON.stringify(expected.value())!==JSON.stringify(journal.sourceProof))fail();
}
export async function retireRuntimeFromProof(source,target,journal,signal){
 for await(const entry of runtimeProofEntries(target,journal)){
  signal?.throwIfAborted();if(entry.directory)continue;
  await nativeMember(source,entry.path,async(parent,name)=>{const value=await parent?.hash(name,{missing:true});if(!value)return;if(value.identity!==entry.identity||!same(value,entry)){const error=runtimeUpgradeError('source-or-copy-changed');error.diagnostic=JSON.stringify({phase:'retire-file',relative:entry.path,identityChanged:value.identity!==entry.identity,bytesChanged:value.bytes!==entry.bytes,hashChanged:value.sha256!==entry.sha256});throw error;}await parent.remove(name,{identity:value.identity});},{missing:true});
 }
 async function empty(root,top=false){for await(const item of root.entries()){
  if(!item.directory){if(!top||item.name!=='owner.lock')fail();continue;}
  const child=await root.directory(item.name);try{await empty(child);}finally{await child.close();}await root.remove(item.name,{folder:true,identity:child.identity});
 }}
 await empty(source,true);
}
