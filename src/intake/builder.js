import path from 'node:path';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {AppError} from '../errors.js';
import {exact,text} from '../modules/validation.js';
import {digest} from '../storage-format.js';
import {researchId} from '../web/research-reference.js';
import {revisionId,revisionText} from '../web/revision-model.js';
import {nativeMember,withNativeTree} from '../native-storage-tree.js';
import {sourceChunks} from '../migration/source-files.js';
import {intakePath,INTAKE_MANIFEST,validateIntake,intakeHash,intakePreview} from './contract.js';
import {intakeSourceFile} from './source.js';
import {withProfileAccess} from '../dataset-profile-requests.js';
import {readDatasetProfile} from '../dataset-interpretation-profile.js';
import {loadAdapter} from './adapter.js';

const invalid=()=>{throw new AppError('INTAKE_INVALID');};
const external=(parent,child)=>{const relative=path.relative(parent,child);return relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative);};
const available=relative=>intakePath(relative)&&relative!==INTAKE_MANIFEST;
const supported=new Map([['.csv','delimited'],['.tsv','delimited'],['.json','json'],['.jsonl','jsonl'],['.ndjson','jsonl']]);
const formatOf=name=>supported.get(path.posix.extname(name).toLowerCase())??'original';
const version='1',builderName='Observanda local intake builder';
let verifier;
const verificationDigest=()=>verifier??=readFile(new URL('./builder.js',import.meta.url)).then(digest).catch(error=>{verifier=undefined;throw error;});
const reviewScope=(manifest,pin,root)=>revisionText([manifest.workspaceId,manifest.recordId,pin,path.resolve(root)]);
export async function checkedReview(service,manifest,root,pin,token){
 if(token===undefined)return undefined;
 if(typeof token!=='string'||token.length>1024*1024||!/^[A-Za-z0-9_-]+$/u.test(token))invalid();
 const scope=reviewScope(manifest,pin,root);
 let stamps;try{stamps=await service.workspace.catalogue(store=>store.decode('intake-builder-review',scope,Buffer.from(token,'base64url')));}
 catch{throw new AppError('INTAKE_CHANGED');}
 if(!Array.isArray(stamps)||stamps.length!==manifest.files.length||!stamps.every(value=>typeof value==='string'))throw new AppError('INTAKE_CHANGED');
 return {pin,manifestStamp:'authored:'+pin,files:manifest.files.map(({id,path,size,sha256},index)=>({id,path,size,sha256,stamp:stamps[index]}))};
}
const fileId=(id,name)=>{
 const key=intakeHash(['intake-builder-member-v1',id,name]);
 return [key.slice(0,8),key.slice(8,12),'4'+key.slice(13,16),'8'+key.slice(17,20),key.slice(20,32)].join('-');
};

function sourceRoot(materials,source){
 if(!text(source,4096,true)||!path.isAbsolute(source))invalid();
 const root=path.resolve(source);
 if(root===path.parse(root).root||!external(materials.workspace.root,root)||!external(root,materials.workspace.root))invalid();
 return root;
}
async function withFolder(root,relative,consume){
 return withNativeTree(root,directory=>relative?nativeMember(directory,relative,async(parent,name)=>{
  const child=await parent.directory(name);try{return await consume(child);}finally{await child.close();}
 }):consume(directory));
}
export async function builderFiles(service,command,{signal}={}){
 const {workspaceId,recordId,source,relative,after}=command;
 if(!exact(command,['workspaceId','recordId','source','relative','after'])||
  relative!==''&&!available(relative)||after!==null&&!available(after))invalid();
 await service.bind({workspaceId,recordId},{checkRevision:false});
 const root=sourceRoot(service.materials,source),limit=48,items=[];let matched=0;
 await withFolder(root,relative,async directory=>{
  for await(const entry of directory.entries()){
   signal?.throwIfAborted();const member=relative?relative+'/'+entry.name:entry.name;
   if(!available(member)||after!==null&&member<=after)continue;
   matched++;
   if(items.length===limit&&member>=items.at(-1).path)continue;
   const row={path:member,directory:entry.directory,format:entry.directory?null:formatOf(member)};
   const index=items.findIndex(item=>item.path>member);
   if(index===-1)items.push(row);else items.splice(index,0,row);
   if(items.length>limit)items.pop();
  }
 });
 return {items,next:matched>limit?items.at(-1).path:null};
}

export async function builderFolder(service,command,{signal}={}){
 if(!exact(command,['workspaceId','recordId','source','relative','extensions'])||command.relative!==''&&!available(command.relative)||
  !Array.isArray(command.extensions)||command.extensions.length>1000||command.extensions.some(extension=>typeof extension!=='string'||extension.length>40))invalid();
 await service.bind(command,{checkRevision:false});
 const root=sourceRoot(service.materials,command.source),allowed=new Set(command.extensions),paths=[];
 async function walk(directory,parent){
  for await(const entry of directory.entries()){
   signal?.throwIfAborted();const name=parent?parent+'/'+entry.name:entry.name;
   if(!available(name))continue;
   if(entry.directory){
    const child=await directory.directory(entry.name);try{await walk(child,name);}finally{await child.close();}
   }else if(!allowed.size||allowed.has(path.posix.extname(name).toLowerCase())){
    if(paths.length===1000)throw new AppError('INTAKE_INVALID',[{reason:'package-files',limit:1000}]);
    paths.push(name);
   }
  }
 }
 await withFolder(root,command.relative,directory=>walk(directory,command.relative));
 return {paths:paths.sort()};
}

export async function buildIntake(service,command,options={}){
 const {signal}=options;
 const prior=command.amends??null;
 if(!exact(command,['id','workspaceId','recordId','expectedRevision','source','paths','purpose','title','method','tool','toolVersion','sourceRevision','profile','adapter',...(Object.hasOwn(command,'amends')?['amends']:[])])||
  prior!==null&&(command.purpose!=='amendment'||!exact(prior,['id','pin'])||!researchId(prior.id)||!revisionId(prior.pin)||prior.id===command.id)||
  !researchId(command.id)||!revisionId(command.expectedRevision)||!['preparation','evidence','analysis','amendment'].includes(command.purpose)||
  !text(command.title,300,true)||!text(command.method,3000)||!text(command.tool,200)||!text(command.toolVersion,200)||
  !text(command.sourceRevision,500)||!Array.isArray(command.paths)||!command.paths.length||
  command.paths.length>1000||command.paths.some(name=>typeof name!=='string'||!available(name))||
  new Set(command.paths.map(name=>name.toLowerCase())).size!==command.paths.length)invalid();
 const root=sourceRoot(service.materials,command.source);
 const {record}=await service.bind(command);
 return withProfileAccess(service.materials,{...options,recordId:record.id,write:true},async grants=>{
 let antecedent=null;
 if(prior){
  const accepted=await service.bound({workspaceId:command.workspaceId,recordId:record.id,id:prior.id});
  if(accepted.state!=='completed'||accepted.pin!==prior.pin)throw new AppError('INTAKE_CHANGED');
  antecedent=accepted.receipt.analyses[0]??accepted.receipt.files[0]??null;
  if(antecedent)await grants.check(antecedent);
 }
 if(command.adapter!==null)await loadAdapter(service.materials,command.adapter,grants);
 if(command.profile!==null)await readDatasetProfile(service.materials,command.profile,grants);
 const formats=[],files=[],known=[],order=command.paths.toSorted(),provenance=revisionText({method:command.method,tool:command.tool,version:command.toolVersion});
 for(const name of order){
  signal?.throwIfAborted();await grants.verify();const stat=await intakeSourceFile(root,name),hash=createHash('sha256');
  for await(const chunk of sourceChunks(root,name,stat,{signal}))hash.update(chunk);
  files.push({id:fileId(command.id,name),path:name,size:stat.size,sha256:hash.digest('hex'),provenance});
  known.push(stat.stamp);formats.push({path:name,format:formatOf(name)});
 }
 for(const [index,name] of order.entries()){
  signal?.throwIfAborted();if((await intakeSourceFile(root,name)).stamp!==known[index])throw new AppError('INTAKE_CHANGED',[{path:name,reason:'changed'}]);
 }
 const {id,workspaceId,recordId,expectedRevision,purpose,title}=command;
 const exactSource=intakeHash(files.map(({path,size,sha256})=>({path,size,sha256})));
 const declared=[command.profile,command.adapter,antecedent].filter(Boolean),analyses=[];
 if(declared.length||prior){
  const batchSize=64-declared.length;
  for(let offset=0;offset<files.length;offset+=batchSize){
   analyses.push({id:fileId(id,'adapter:'+offset),expectedRevision:null,title:(title+' · '+(offset+1)+'–'+Math.min(offset+batchSize,files.length)).slice(0,300),
    tool:builderName,version,toolSha256:await verificationDigest(),parameters:revisionText({version:1,profile:!!command.profile,adapter:!!command.adapter,...(prior?{amends:prior}:{})}),
    inputs:[...declared,...files.slice(offset,offset+batchSize).map(file=>({file:file.id}))],outputs:[]});
  }
 }
 const manifest=validateIntake({version:1,id,workspaceId,recordId,expectedRevision,purpose,title,files,analyses,
  source:{revision:command.sourceRevision.trim()||'sha256:'+exactSource,sha256:exactSource},
  verification:{tool:builderName,version,sha256:await verificationDigest(),statement:'The selected source files were read and their byte counts and SHA-256 digests were recorded.'}});
 await service.validateTargets(manifest,{signal});
 const pin=intakeHash(manifest),scope=reviewScope(manifest,pin,root);
 const proof=await service.workspace.catalogue(store=>store.encode('intake-builder-review',scope,known).toString('base64url'));
 return {manifest,preview:intakePreview(manifest,pin),targetTitle:record.title,formats,proof};
 });
}

export function intakeInterpretation(manifest,receipt){
 if(!receipt)return null;
 for(const analysis of manifest.analyses){
  if(analysis.tool!==builderName||analysis.version!==version)continue;
  let settings;try{settings=JSON.parse(analysis.parameters);}catch{continue;}
  const ref=analysis.inputs[0];
  if(!exact(settings,['version','profile','adapter',...(settings&&Object.hasOwn(settings,'amends')?['amends']:[])])||settings.version!==1||settings.profile!==true||ref?.kind!=='analysis')continue;
  const names=new Map(manifest.files.map(file=>[file.id,file.path]));
  return {profile:ref,files:receipt.files.filter(file=>names.has(file.id)&&formatOf(names.get(file.id))!=='original').map(file=>({...file,title:names.get(file.id)}))};
 }
 return null;
}
