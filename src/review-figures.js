import {validReviewFigureParts} from './review-contract.js';
import {createHash} from 'node:crypto';
import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {contentBuffer} from './file-content.js';
import {verifyOrganizationCommand,identityHash} from './collaboration/identity.js';
import {reviewHash} from './security/review-exchange.js';
import {manifestEntry} from './collaboration/exchange-stream.js';
import {RetainedFigureDocuments} from './retained-figure-document.js';
import {validateRetainedFigureSource,dispatchRetainedFigure} from './retained-figures.js';
import {ResearchMaterials} from './research-materials.js';
import {allFigurePlots} from './web/figure-provenance.js';
import {withScratch} from './scratch-work.js';
const fail=()=>{throw new AppError('REVIEW_INVALID');};
const block=/^\.observanda\/materials\/figures\/(value|index)\/([a-f0-9]{64})\.json$/;
const chunk=/^\.observanda\/reviews\/figure-chunks\/([a-f0-9]{64})\.json$/;
const exact=(v,names)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join()===names.sort().join();
export const hasReviewFigures=records=>records.some(({record})=>allFigurePlots(record.figures).some(figure=>figure.kind==='retained'));
const alias=(parts,kind,revision)=>parts.prefix+'/blocks/'+kind+'/'+revision+'.json';
async function readPack(parts,entry,{signal}={}){
 signal?.throwIfAborted();const match=chunk.exec(entry.name);if(entry.kind!=='metadata'||!match||entry.size>262144||entry.sha256!==match[1])fail();const bytes=await contentBuffer(parts.content(entry),{signal}),value=JSON.parse(bytes.toString('utf8'));if(serialize(value)!==bytes.toString('utf8')||!exact(value,['format','version','items'])||value.format!=='review-figure-blocks'||value.version!==1||!Array.isArray(value.items)||!value.items.length||value.items.length>32)fail();
 for(const item of value.items)if(!exact(item,['kind','revision','node'])||!['value','index'].includes(item.kind)||!/^[a-f0-9]{64}$/.test(item.revision)||Buffer.byteLength(serialize(item.node))>65536||digest(serialize(item.node))!==item.revision)fail();return value;
}
export async function indexReviewFigurePart(parts,entry,options={}){
 const value=await readPack(parts,entry,options);
 await parts.write(async()=>{for(const [position,item]of value.items.entries()){options.signal?.throwIfAborted();const file=alias(parts,item.kind,item.revision);if(await parts.workspace.readMetadata(file,1024)!==null)fail();await parts.workspace.writeMetadata(file,serialize({name:entry.name,position}));}});return value.items.length;
}
export async function captureReviewFigures(workspace,parts,records,{signal}={}){
 return withScratch(async seen=>{
  const materials=new ResearchMaterials(workspace),hash=createHash('sha256');let items=[],blocks=0,packCount=0,totalBytes=0;
  const flush=async()=>{if(!items.length)return;const content=serialize({format:'review-figure-blocks',version:1,items}),name='.observanda/reviews/figure-chunks/'+digest(content)+'.json',entry=await parts.add({kind:'metadata',name,content});hash.update(manifestEntry(entry));blocks+=await indexReviewFigurePart(parts,entry,{signal});packCount++;totalBytes+=entry.size;items=[];};
  for(const selected of records)for(const figure of allFigurePlots(selected.record.figures))if(figure.kind==='retained'){
   signal?.throwIfAborted();const {reader}=await validateRetainedFigureSource(materials,figure,{signal,verify:true});for await(const part of reader.blocks({signal})){
    if(!await seen.add(part.path))continue;const item={kind:part.kind,revision:part.revision,node:part.node};const encoded=values=>Buffer.byteLength(serialize({format:'review-figure-blocks',version:1,items:values}));if(items.length&&(items.length===32||encoded([...items,item])>262144))await flush();if(encoded([item])>262144)fail();items.push(item);
   }
  }
  await flush();if(!blocks)fail();return {version:1,parts:packCount,blocks,bytes:totalBytes,manifestHash:hash.digest('hex')};
 });
}
export function reviewFigureWorkspace(parts,{signal}={}){
 const cache=new Map();let cachedBytes=0;
 return {async readMetadata(name,max=65536){
  signal?.throwIfAborted();const match=block.exec(name);if(!match)return null;const raw=await parts.workspace.readMetadata(alias(parts,match[1],match[2]),1024);if(raw===null)return null;const address=JSON.parse(raw);if(!exact(address,['name','position'])||!chunk.test(address.name)||!Number.isInteger(address.position)||address.position<0||address.position>=32)fail();
  let pack=cache.get(address.name);if(!pack){const entry=await parts.descriptor('metadata',address.name);if(!entry||entry.size>262144||entry.sha256!==chunk.exec(entry.name)[1])fail();const bytes=await contentBuffer(parts.content(entry),{signal});pack={value:JSON.parse(bytes.toString('utf8')),bytes:bytes.length};while(cache.size>=4||cachedBytes+pack.bytes>1048576){const key=cache.keys().next().value;if(key===undefined)break;cachedBytes-=cache.get(key).bytes;cache.delete(key);}cache.set(address.name,pack);cachedBytes+=pack.bytes;}
  const item=pack.value.items?.[address.position];if(item?.kind!==match[1]||item?.revision!==match[2])fail();const text=serialize(item.node);if(Buffer.byteLength(text)>max||digest(text)!==match[2])fail();return text;
 }};
}
export async function verifyReviewFigures(parts,request,{signal}={}){
 if(!validReviewFigureParts(request.figureParts)||!hasReviewFigures(request.records))fail();const workspace=reviewFigureWorkspace(parts,{signal}),hash=createHash('sha256');let count=0,bytes=0,blocks=0;
 await withScratch(async used=>{
  for(const selected of request.records)for(const figure of allFigurePlots(selected.record.figures))if(figure.kind==='retained'){
   const reader=await new RetainedFigureDocuments(workspace,{readOnly:true,signal}).open(figure);await reader.verify({signal});for await(const part of reader.blocks({signal}))await used.add(part.path);
  }
  for await(const entry of parts.items())if(entry.kind!=='description'){
   signal?.throwIfAborted();if(!chunk.test(entry.name)||entry.size>262144)fail();hash.update(manifestEntry(entry));count++;bytes+=entry.size;const value=await readPack(parts,entry,{signal});for(const [position,item] of value.items.entries()){const pointer=await parts.workspace.readMetadata(alias(parts,item.kind,item.revision),1024);if(pointer!==serialize({name:entry.name,position}))fail();blocks++;if(!await used.has('.observanda/materials/figures/'+item.kind+'/'+item.revision+'.json'))fail();}
  }
 });
 if(count!==request.figureParts.parts||bytes!==request.figureParts.bytes||blocks!==request.figureParts.blocks||hash.digest('hex')!==request.figureParts.manifestHash)fail();
}
export async function readReviewFigure(parts,request,command,options={}){
 const selected=request.records.find(row=>row.id===command.recordId&&row.revision===command.recordRevision);if(!selected)fail();const figure=allFigurePlots(selected.record.figures).find(value=>value.id===command.figureId&&value.kind==='retained');if(!figure)fail();
 const reader=await new RetainedFigureDocuments(reviewFigureWorkspace(parts,options),{readOnly:true,signal:options.signal}).open(figure);return dispatchRetainedFigure(reader,selected.revision,command,options);
}

// Reverse verification is offline: trust revocation changes serving permission,
// not the validity of an already authenticated immutable historical packet.
export async function verifyReviewFigurePacket(parts,packet,{signal}={}){
 const head=await parts.open();if(head.requestId!==packet.request.value.id||head.direction!==packet.direction||head.selectionHash!==reviewHash(packet.request)||reviewHash(await parts.value('description','selection'))!==head.selectionHash)fail();
 const description=await parts.descriptor('description','selection'),manifest=createHash('sha256');if(!description||description.size>750000)fail();manifest.update(manifestEntry(description));let count=1;for await(const entry of parts.items())if(entry.kind!=='description'){manifest.update(manifestEntry(entry));count++;const pointer=await parts.descriptor(entry.kind,entry.name);if(identityHash(pointer)!==identityHash(entry))fail();}
 if(count!==parts.count)fail();if(packet.direction==='incoming'){const signed=verifyOrganizationCommand(head.attestation);if(signed.kind!=='collaboration.package'||head.attestation.identity.id!==packet.request.value.sender.signing.id||signed.entries!==parts.count||signed.manifestHash!==manifest.digest('hex'))fail();}
 await verifyReviewFigures(parts,packet.request.value,{signal});
}
