import path from 'node:path';
import {lstat,opendir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {AppError} from '../errors.js';
import {INVENTORY_FORMAT,INVENTORY_VERSION,inventoryLimits,relativeSourcePath,sourceKey,validateInventoryManifest} from './adapters.js';

import {sourceStamp as stamp,unsafeSource as unsafe,checkSourceSignal as check,checkedSourcePath as checkedPath,sourceChunks} from './source-files.js';
import {verifySourceSelectors} from './selectors.js';
import {selectorKey,selectorLimits} from './selector-contract.js';
import {propagateInventoryFailures} from './dependencies.js';
import {migrationMessage} from './messages.js';

const hash=value=>createHash('sha256').update(value).digest('hex');
const compare=(a,b)=>a<b?-1:a>b?1:0;
async function tree(root,signal){
 const files=new Map();let entries=0;
 async function walk(relative,depth){
  check(signal);if(depth>inventoryLimits.depth)throw new AppError('INVENTORY_LIMIT');
  const absolute=await checkedPath(root,relative),handle=await opendir(absolute);
  for await(const entry of handle){
   check(signal);if(++entries>inventoryLimits.files)throw new AppError('INVENTORY_LIMIT');
   const name=relative?relative+'/'+entry.name:entry.name,s=await lstat(path.join(root,name),{bigint:true});
   const kind=unsafe(s)||!relativeSourcePath(name)?'unsafe':s.isDirectory()?'directory':'file';
   files.set(name,{kind,stamp:stamp(s),size:Number(s.size)});
   if(kind==='directory')await walk(name,depth+1);
  }
 }
 await walk('',0);return files;
}
async function readOriginal(root,name,known,{signal,onBytes,collect=false}){
 const sha=createHash('sha256'),chunks=[];let bytes=0;
 for await(const chunk of sourceChunks(root,name,known,{signal})){
  bytes+=chunk.length;sha.update(chunk);if(collect)chunks.push(chunk);await onBytes?.(chunk.length);
 }
 return {bytes,sha256:sha.digest('hex'),...(collect?{content:Buffer.concat(chunks)}:{})};
}
function overlap(a,b,verified){
 if(a.kind==='whole'||b.kind==='whole')return true;
 if(a.kind==='bytes'&&b.kind==='bytes')return a.offset<b.offset+b.length&&b.offset<a.offset+a.length;
 // Different selector languages cannot establish disjoint boundaries.
 if(a.kind!==b.kind)return true;
 if(a.kind==='anchor'){
  const first=verified?.get(selectorKey(a))?.range,second=verified?.get(selectorKey(b))?.range;
  return a.value===b.value||!!(first&&second&&first.start<second.end&&second.start<first.end);
 }
 return a.value===b.value||a.kind==='json-pointer'&&(a.value.startsWith(b.value+'/')||b.value.startsWith(a.value+'/'));
}
export async function inventorySource({source,manifest='inventory.observanda-source.json',expectedPin}={}, {signal,onProgress=()=>{}}={}){
 if(typeof source!=='string'||!path.isAbsolute(source)||source.length>4096||/[\x00-\x1f]/.test(source)||/^\\\\[?.]\\/.test(source)||!relativeSourcePath(manifest)||expectedPin!==undefined&&!/^[a-f0-9]{64}$/.test(expectedPin))throw new AppError('INVENTORY_INVALID');
 const root=path.resolve(source);await checkedPath(root);
 let control;
 try{const s=await lstat(await checkedPath(root,manifest),{bigint:true});control={kind:s.isFile()?'file':'unsafe',stamp:stamp(s),size:Number(s.size)};}catch(error){if(error.code!=='ENOENT')throw error;}
 if(!control||control.kind!=='file')throw new AppError('INVENTORY_INVALID',[{field:'manifest',message:migrationMessage('chooseManifest')}]);
 if(control.size>inventoryLimits.manifestBytes)throw new AppError('INVENTORY_LIMIT');
 const original=await readOriginal(root,manifest,control,{signal,collect:true});let declaration;
 try{declaration=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(original.content));}catch{throw new AppError('INVENTORY_INVALID',[{field:'manifest',message:migrationMessage('invalidManifest')}]);}
 const invalid=validateInventoryManifest(declaration);if(invalid.length)throw new AppError('INVENTORY_INVALID',invalid);
 const initial=await tree(root,signal);if(initial.get(manifest)?.stamp!==control.stamp)throw new AppError('INVENTORY_CHANGED');
 let totalBytes=0;
 for(const f of initial.values())if(f.kind==='file'){totalBytes+=f.size;if(!Number.isSafeInteger(f.size)||totalBytes>inventoryLimits.totalBytes)throw new AppError('INVENTORY_LIMIT');}
 const results=new Map(),paths=[...initial.keys()].sort(compare);let bytesRead=original.bytes,filesRead=1;
 await onProgress({phase:'hashing',filesRead,totalFiles:paths.filter(p=>initial.get(p).kind!=='directory').length,bytesRead,totalBytes});
 for(const name of paths){
  const f=initial.get(name);if(f.kind==='directory')continue;
  if(f.kind==='unsafe'){results.set(name,{path:name,status:'unsafe',bytes:null,sha256:null});continue;}
  const verified=name===manifest?original:await readOriginal(root,name,f,{signal,onBytes:async amount=>{bytesRead+=amount;await onProgress({phase:'hashing',filesRead,bytesRead,totalBytes});}});
  if(name!==manifest)filesRead++;
  results.set(name,{path:name,status:name===manifest?'manifest':'unaccounted',bytes:verified.bytes,sha256:verified.sha256,objects:[]});
 }
 const selections=new Map(),verifiedSelectors=new Map();
 for(const object of declaration.objects)for(const file of object.files){
  const group=selections.get(file.path)??[];group.push(file.selector);
  if(group.length>selectorLimits.perFile)throw new AppError('INVENTORY_LIMIT');
  selections.set(file.path,group);
 }
 for(const [name,selectors] of selections){
  const actual=results.get(name);if(!actual||actual.status==='unsafe'||name===manifest)continue;
  await onProgress({phase:'selectors',filesRead,bytesRead,totalBytes});
  verifiedSelectors.set(name,await verifySourceSelectors(root,name,initial.get(name),selectors,{signal}));
 }
 const objects=declaration.objects.map(o=>({...o,status:o.disposition==='map'?'mapped':o.disposition==='exclude'?'excluded':'unsupported',issues:[]}));
 const byKey=new Map(),issues=[];
 function objectIssue(o,code,message,status='conflict'){
  if(!o.issues.some(i=>i.code===code&&i.message===message))o.issues.push({code,message});
  if(o.status!=='missing'||status==='missing')o.status=status;
 }
 for(const o of objects){
  const key=sourceKey(o);
  if(byKey.has(key)){objectIssue(o,'duplicate-identity',migrationMessage('duplicateIdentity'));objectIssue(byKey.get(key),'duplicate-identity',migrationMessage('duplicateIdentity'));}else byKey.set(key,o);
  if(o.disposition==='unsupported')o.issues.push({code:'unsupported',message:o.reason});
  if(o.audience==='undecided'&&o.disposition==='map')objectIssue(o,'audience',migrationMessage('chooseAudience'));
  for(const f of o.files){
   const actual=results.get(f.path);
   if(!actual){objectIssue(o,'missing-file',migrationMessage('missingOriginal',{path:f.path}),'missing');continue;}
   actual.objects??=[];actual.objects.push(key);
   if(actual.status==='unsafe'||f.path===manifest){objectIssue(o,'unsafe-file',migrationMessage('unsafeOriginal',{path:f.path}));continue;}
   actual.status='accounted';
   if(actual.sha256!==f.sha256||actual.bytes!==f.bytes)objectIssue(o,'byte-mismatch',migrationMessage('changedOriginal',{path:f.path}));
   f.verification=actual.sha256!==f.sha256||actual.bytes!==f.bytes?{status:'blocked',code:'byte-mismatch'}:verifiedSelectors.get(f.path)?.get(selectorKey(f.selector))??{status:'blocked',code:'selector-format'};
   if(f.verification.status==='blocked'&&f.verification.code!=='byte-mismatch')objectIssue(o,f.verification.code,migrationMessage(f.verification.code,{path:f.path,value:f.selector.value??''}));
  }
 }
 // Shared artifacts are valid. Multiple logical records in one source need distinct boundaries.
 const boundaries=new Map();
 for(const o of objects.filter(o=>o.disposition==='map'&&o.mapping.kind!=='artifact'))for(const f of o.files){
  const prior=boundaries.get(f.path)??[];
  if(prior.length>=1000)throw new AppError('INVENTORY_LIMIT');
  for(const p of prior)if(p.object.id!==o.id&&overlap(p.selector,f.selector,verifiedSelectors.get(f.path))){objectIssue(o,'ambiguous-boundary',migrationMessage('overlapping',{path:f.path}));objectIssue(p.object,'ambiguous-boundary',migrationMessage('overlapping',{path:f.path}));}
  prior.push({object:o,selector:f.selector});boundaries.set(f.path,prior);
 }
 for(const o of objects)for(const link of o.links){
  const target=byKey.get(sourceKey(link));
  if(o.disposition==='map'&&link.required&&(!target||target.disposition!=='map'))objectIssue(o,'dependency',migrationMessage('requiredTarget',link));
  if(!target&&!link.required){const warning={code:'optional-link-missing',severity:'warning',message:migrationMessage('optionalTarget',link)};o.issues.push(warning);issues.push({...warning,object:sourceKey(o),link});}
 }
 propagateInventoryFailures(objects,objectIssue,{signal});
 await onProgress({phase:'verifying',filesRead,bytesRead,totalBytes});
 const final=await tree(root,signal);
 if(initial.size!==final.size||[...initial].some(([name,f])=>final.get(name)?.stamp!==f.stamp||final.get(name)?.kind!==f.kind))throw new AppError('INVENTORY_CHANGED');
 const files=[...results.values()],counts={objects:objects.length,files:files.length,bytes:totalBytes,mapped:0,excluded:0,unsupported:0,missing:0,conflict:0,unaccountedFiles:0,unsafeFiles:0,relationships:0};
 for(const o of objects){counts[o.status]++;counts.relationships+=o.links.length;}
 for(const f of files){if(f.status==='unaccounted')counts.unaccountedFiles++;if(f.status==='unsafe')counts.unsafeFiles++;}
 const pin=hash(JSON.stringify({format:INVENTORY_FORMAT,version:INVENTORY_VERSION,manifest:original.sha256,files:files.map(({path,sha256,bytes,status})=>({path,sha256,bytes,unsafe:status==='unsafe'}))}));
 if(expectedPin&&expectedPin!==pin)throw new AppError('INVENTORY_CHANGED');
 const complete=counts.unsupported+counts.missing+counts.conflict+counts.unaccountedFiles+counts.unsafeFiles===0;
 return {format:'observanda-source-inventory-report',version:1,adapter:declaration.adapter,source:{...declaration.source,pin,manifestSha256:original.sha256},capturedAt:new Date().toISOString(),readOnly:true,complete,counts,objects,files,issues,limits:{...inventoryLimits,selectors:selectorLimits},
  qualification:migrationMessage('qualification')};
}
