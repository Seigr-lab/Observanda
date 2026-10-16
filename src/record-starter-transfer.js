import {createHash} from 'node:crypto';
import {PassThrough,Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {RecordStarterEditing} from './record-starter-editing.js';
import {STARTER_ROOT} from './record-starters.js';
import {RecordDraftChunks} from './record-draft-chunks.js';
import {RecordDocument} from './record-document.js';
import {RecordContainerBuilder} from './record-tree-values.js';
import {StarterValueBlocks,retainStarterDocument,starterFingerprint} from './record-starter-documents.js';
import {openStarterStream,sealStarterStream,starterBlocks,validateStarterRelease} from './record-starter-stream.js';
import {openStarter,packageDigest} from './record-starter-package.js';
import {requireStarterDocuments} from './catalogue-format.js';
import {starterKeys,STARTER_PACKAGE_BYTES} from './web/record-starter-model.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {RECORD_DRAFT_CHUNK_BYTES as SIZE} from './web/record-draft-protocol.js';
import {AppError} from './errors.js';
const fail=()=>{throw new AppError('INVALID');},natural=n=>Number.isSafeInteger(n)&&n>=0;
const uploadRoot='.observanda/record-starter-uploads';
export class RecordStarterTransfer extends RecordStarterEditing{
 check(c,keys){if(!starterKeys(c,['workspaceId','uploadId',...keys])||!researchId(c.workspaceId)||!researchId(c.uploadId))fail();}
 async upload(c){
  this.check(c,['bytes','sha256']);if(!natural(c.bytes)||!c.bytes||!revisionId(c.sha256))fail();
  return this.workspace.withLock(async()=>{await this.context(c.workspaceId);await this.workspace.catalogue(store=>requireStarterDocuments(store.db));
   const aliasFile=uploadRoot+'/by-file/'+c.sha256+'.json',alias=await this.object(aliasFile),uploadId=alias?.id??c.uploadId;if(!researchId(uploadId))fail();
   const file=uploadRoot+'/'+uploadId+'.json',prior=await this.object(file);if(prior&&(prior.bytes!==c.bytes||prior.sha256!==c.sha256))throw new AppError('STARTER_CHANGED');
   const value=prior??{bytes:c.bytes,sha256:c.sha256,root:null};if(!prior)await this.workspace.writeMetadata(file,JSON.stringify(value));await this.workspace.writeMetadata(aliasFile,JSON.stringify({id:uploadId}));const receipt=await this.object(STARTER_ROOT+'/package-uses/'+uploadId+'.json');return {uploadId,received:value.root?.count??0,chunkBytes:SIZE,accepted:receipt?.id??null};
  });
 }
 async uploadPart(c){
  this.check(c,['index','encoded']);if(!natural(c.index)||typeof c.encoded!=='string'||c.encoded.length>Math.ceil(SIZE/3)*4)fail();const bytes=Buffer.from(c.encoded,'base64');if(bytes.toString('base64')!==c.encoded)fail();
  return this.workspace.withLock(async()=>{await this.context(c.workspaceId);const file=uploadRoot+'/'+c.uploadId+'.json',prior=await this.object(file);if(!prior)throw new AppError('NOT_FOUND');
   const chunks=new RecordDraftChunks(this.workspace,c.uploadId,{starter:true}),next=await chunks.add(prior,c.index,bytes);await this.workspace.writeMetadata(file,JSON.stringify(next));return {received:next.root.count};
  });
 }
 async staged(c){
  await this.context(c.workspaceId);const value=await this.object(STARTER_ROOT+'/packages/'+c.uploadId+'.json');if(!value)throw new AppError('NOT_FOUND');
  return {...value,document:new RecordDocument(new StarterValueBlocks(this.workspace,{staging:c.uploadId}),value.root)};
 }
 async review(c,{signal}={}){
  this.check(c,['password']);
  return this.workspace.withLock(async()=>{
   await this.context(c.workspaceId);const content=await this.object(uploadRoot+'/'+c.uploadId+'.json'),chunks=new RecordDraftChunks(this.workspace,c.uploadId,{starter:true});if(!chunks.valid(content))fail();
   const hash=createHash('sha256');async function* input(){for await(const bytes of chunks.chunks(content,{signal})){hash.update(bytes);yield bytes;}}
   const blocks=new StarterValueBlocks(this.workspace,{staging:c.uploadId}),first=await chunks.part(content,0);let value;
   if(first.subarray(0,9).toString()==='OBSSTART1'){
    if(content.bytes>STARTER_PACKAGE_BYTES)throw new AppError('STARTER_PACKAGE');const parts=[];for await(const bytes of input())parts.push(bytes);
    const old=await openStarter(Buffer.concat(parts).toString('base64'),c.password),release={version:1,number:old.sourceNumber,...old.releaseMetadata,blueprint:old.blueprint};
    const builder=new RecordContainerBuilder(blocks,'object');for(const [name,item] of Object.entries(release))await builder.add({name,value:await blocks.tree().retain(item)});
    value={document:new RecordDocument(blocks,await builder.finish()),fingerprint:old.sourceRelease};
   }else value=await openStarterStream(input(),c.password,blocks,{signal});
   if(hash.digest('hex')!==content.sha256)throw new AppError('STARTER_PACKAGE');
   const metadata=await validateStarterRelease(value.document,{signal}),result={root:value.document.root,fingerprint:value.fingerprint,sha256:content.sha256,...metadata};
   await this.workspace.writeMetadata(STARTER_ROOT+'/packages/'+c.uploadId+'.json',JSON.stringify(result));return {fingerprint:result.fingerprint,number:result.number,note:result.note};
  });
 }
 async packageView(c){
  this.check(c,['offset']);if(!natural(c.offset))fail();return this.workspace.catalogue(async()=>{
   const source=await this.staged(c),document=new RecordDocument(source.document.blocks,await source.document.reference(['blueprint']));return this.describe(document,{release:{revision:source.fingerprint,number:source.number,note:source.note}},c.offset);
  });
 }
 async packageField(c){
  this.check(c,['field','position']);return this.workspace.catalogue(async()=>{const source=await this.staged(c),document=new RecordDocument(source.document.blocks,await source.document.reference(['blueprint']));return this.selectedField(document,c);});
 }
 async accept(c){
  this.check(c,['id','fingerprint']);if(!researchId(c.id)||!revisionId(c.fingerprint))fail();
  return this.workspace.withLock(async()=>{
   await this.context(c.workspaceId);const receiptFile=STARTER_ROOT+'/package-uses/'+c.uploadId+'.json',receipt=await this.object(receiptFile);if(receipt){if(receipt.id!==c.id||receipt.fingerprint!==c.fingerprint)throw new AppError('STARTER_CHANGED');return {header:await this.header(c.id)};}
   if(await this.object(STARTER_ROOT+'/headers/'+c.id+'.json'))throw new AppError('STARTER_CHANGED');
   const source=await this.staged(c);if(source.fingerprint!==c.fingerprint||await starterFingerprint(source.document)!==c.fingerprint)throw new AppError('STARTER_CHANGED');await validateStarterRelease(source.document);
   const blueprint=new RecordDocument(source.document.blocks,await source.document.reference(['blueprint'])),blocks=new StarterValueBlocks(this.workspace);
   for await(const block of starterBlocks(blueprint))await blocks.put(block.kind,block.value);
   const pointer=await retainStarterDocument(blueprint),header={version:1,id:c.id,createdAt:new Date().toISOString(),status:'active',sequence:0,latest:null,name:(await blueprint.field(['name'])).value,draftHash:pointer.fingerprint,origin:{packageDigest:source.sha256,release:source.fingerprint,number:source.number}};
   await this.feed.ensureLocked();await this.workspace.writeMetadata(STARTER_ROOT+'/drafts/'+c.id+'.json',JSON.stringify(pointer));await this.workspace.writeMetadata(STARTER_ROOT+'/headers/'+c.id+'.json',JSON.stringify(header));await this.feed.putLocked(header);await this.workspace.writeMetadata(receiptFile,JSON.stringify({id:c.id,fingerprint:c.fingerprint}));
   return {header:{...header,revision:packageDigest(header)}};
  });
 }
 async discard(c){
  this.check(c,[]);return this.workspace.withLock(async()=>{await this.context(c.workspaceId);const content=await this.object(uploadRoot+'/'+c.uploadId+'.json');await new RecordDraftChunks(this.workspace,c.uploadId,{starter:true}).clear();
   if(content){const aliasFile=uploadRoot+'/by-file/'+content.sha256+'.json';if((await this.object(aliasFile))?.id===c.uploadId)await this.workspace.removeMetadata(aliasFile);}
   for(const kind of ['value','index'])for await(const name of this.workspace.metadataNames('.observanda/record-starter-staging/'+c.uploadId+'/'+kind)){if(!/^[a-f0-9]{64}\.json$/.test(name))fail();await this.workspace.removeMetadata('.observanda/record-starter-staging/'+c.uploadId+'/'+kind+'/'+name);}
   try{await this.workspace.removeMetadata(STARTER_ROOT+'/packages/'+c.uploadId+'.json');}catch(error){if(error.code!=='ENOENT')throw error;}return {discarded:true};
  });
 }
 async *download(c,{signal}={}){
  if(!starterKeys(c,['workspaceId','id','release','password']))fail();
  const output=new PassThrough({highWaterMark:128*1024}),controller=new AbortController(),combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
  // The entire producer owns one fixed read transaction. A lazy iterator
  // outside that context would reopen the catalogue for every small block.
  const finished=this.workspace.catalogue(async()=>{const document=await this.releaseDocument({workspaceId:c.workspaceId,id:c.id,release:c.release});await pipeline(Readable.from(sealStarterStream(document,c.release,c.password,{signal:combined})),output,{signal:combined});}).catch(error=>{output.destroy(error);});
  try{for await(const bytes of output)yield bytes;}finally{controller.abort();output.destroy();await finished;}
 }
}
