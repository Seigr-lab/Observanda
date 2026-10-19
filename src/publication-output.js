// A preparation owns an indexed output inventory and numbered immutable blobs.
// Only bounded metadata batches hold the website writer; rendering and file
// streaming run outside that writer, including nested media retention.
import path from 'node:path';
import {PublicationOutputFinalization} from './publication-output-finalization.js';
import {readdir} from 'node:fs/promises';
import {withScratch} from './scratch-work.js';
import {publicationResearchWorkspace} from './publication-pin.js';
import {createHash} from 'node:crypto';
import {PublicationDocument,PublicationDocumentBuilder,isPublicationDocumentBlockPath,publicationDocumentPrefix} from './publication-document.js';
import {AppError} from './errors.js';
import {serialize} from './storage-format.js';
import {FileContent,writeContent,contentStream,contentHash,contentSize} from './file-content.js';
import {assertPublicFiles,admitRetainedPublicFile} from './privacy.js';
import {isDownloadPath} from './web/website-file.js';
import {withWorkspaceMetadataBatch} from './metadata-batch.js';
import {assertPublicationDocumentStorage} from './publication-document-storage.js';
const collections=Object.fromEntries(['files','blobIndexes','pages','entries','projects','styles'].map(name=>[name,{indexes:[]} ]));
const choiceKinds=new Set(['pages','entries','projects','styles']);
const generator='Observanda 0.3.0-dev';
const freshBlocks=Symbol('fresh publication output blocks');
const streamed=value=>value!==null&&typeof value==='object'&&typeof value[Symbol.asyncIterator]==='function'&&!(value instanceof FileContent);
const stale=()=>{throw new AppError('STALE');};
const htmlChunkBytes=64*1024;
// Durable metadata commits coalesce tiny nodes; the SQL writer independently
// retains its 32-row batches and this writer keeps its 256 KiB byte bound.
const outputObjects=512,outputBytes=256*1024;
// Preserve fragment encoding while avoiding a filesystem write for every text
// fragment, including manifest rows and stylesheet rules. Yielded buffers are
// never reused, and upstream is closed on cancellation.
export async function* publicationOutputChunks(source,{signal}={}){
 signal?.throwIfAborted();let buffer=null,used=0;
 for await(const chunk of source){
  signal?.throwIfAborted();const bytes=Buffer.from(chunk);
  for(let offset=0;offset<bytes.length;){
   signal?.throwIfAborted();buffer??=Buffer.allocUnsafe(htmlChunkBytes);
   const count=Math.min(htmlChunkBytes-used,bytes.length-offset);bytes.copy(buffer,used,offset,offset+count);offset+=count;used+=count;
   if(used===htmlChunkBytes){yield buffer;signal?.throwIfAborted();buffer=null;used=0;}
  }
 }
 signal?.throwIfAborted();if(used)yield buffer.subarray(0,used);
}
export const publicationOutputOwner=(source,job)=>({kind:'output',workspaceId:source.workspaceId??source.metadata.id,websiteId:source.websiteId??null,jobId:job.id,attemptId:job.lease.token});
export async function openPublicationOutput(workspace,stored,{signal}={}){
 const owner={kind:'output',workspaceId:stored.workspaceId,websiteId:stored.websiteId??null,jobId:stored.jobId,attemptId:stored.attempt};
 const output=await PublicationDocument.open(workspace,stored.output,{owner,signal}),header=await output.header({signal});
 if(output.collectionNames().sort().join()!==Object.keys(collections).sort().join()||output.collectionNames().some(name=>Object.keys(output.collection(name).indexes).length)||Object.keys(header).sort().join()!=='defaultPage,generator,releaseId,version'||header.version!==1||header.releaseId!==stored.id||header.defaultPage!==stored.defaultPage||header.generator!==generator||output.count('files')!==output.count('blobIndexes'))throw new AppError('JOB_DAMAGED');
 return output;
}
// A new attempt owns an empty namespace. Its immutable node receipts live in
// bounded encrypted scratch storage until preparation completes or fails.
export function withPublicationOutputWriter(workspace,source,job,options,operation){
 return publicationResearchWorkspace(workspace).withCatalogueConnections(()=>withScratch(async blocks=>{
  const db=await publicationResearchWorkspace(workspace).openCatalogue({signal:options?.signal});let failure,writer;
  try{
   await db.run('BEGIN');
   const key='Observanda/publication-output/'+db.id+'/'+JSON.stringify(publicationOutputOwner(source,job));
   if(!(await db.get('SELECT pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended($1,0)) AS locked',key)).locked)throw new AppError('LOCKED');
   writer=new PublicationOutputWriter(workspace,source,job,{...options,[freshBlocks]:blocks});return await operation(writer);
  }catch(error){failure=error;throw error;}
  finally{
   try{await writer?.drain();}catch(error){if(!failure){failure=error;throw error;}}
   finally{try{await db.close();}catch(error){if(!failure)throw error;}}
  }
 },{signal:options?.signal}));
}
export class PublicationOutputWriter{
 constructor(workspace,source,job,{directory,signal,blockedValues=[],[freshBlocks]:blocks}={}){
  this.workspace=workspace;this.source=source;this.job=job;this.directory=directory;this.signal=signal;this.blockedValues=blockedValues;this.owner=publicationOutputOwner(source,job);this.nextBlob=0;this.pendingNames=new Set();this.finalization=new PublicationOutputFinalization({signal});
  let admission;this.ready=()=>admission??=(blocks?workspace.withLock(async()=>{
   await assertPublicationDocumentStorage(workspace,{signal});signal?.throwIfAborted();
   if((await workspace.metadataPage(publicationDocumentPrefix(this.owner),{limit:1})).items.length||(await readdir(directory)).length)throw new AppError('PUBLICATION_IDENTITY');
  }):assertPublicationDocumentStorage(workspace,{signal}));
  const pending=new Map();let bytes=0;
  this.flush=async()=>{
   if(!pending.size)return;await this.ready();signal?.throwIfAborted();
   await workspace.withLock(()=>withWorkspaceMetadataBatch(workspace,async()=>{signal?.throwIfAborted();for(const [file,text] of pending)await workspace.writeMetadata(file,text);}));
   pending.clear();bytes=0;
  };
  const scope=this,retained=new Proxy(workspace,{get(target,method){
   if(method==='readMetadata')return async(file,limit)=>{
    if(blocks&&isPublicationDocumentBlockPath(scope.owner,file)){
     await scope.ready();const text=await blocks.get(file);if(text===undefined)return null;if(Buffer.byteLength(text)>limit)throw new AppError('LIMIT');return text;
    }
    if(pending.has(file)){const text=pending.get(file);if(Buffer.byteLength(text)>limit)throw new AppError('LIMIT');return text;}return target.readMetadata(file,limit);
   };
   if(method==='writeMetadata')return async(file,text)=>{
    signal?.throwIfAborted();if(!isPublicationDocumentBlockPath(scope.owner,file))throw new AppError('INVALID');
    if(blocks){await scope.ready();if(!await blocks.add(file,text)&&await blocks.get(file)!==text)stale();}
    const size=Buffer.byteLength(text);if(pending.size>=outputObjects||bytes+size>outputBytes)await scope.flush();
    if(pending.has(file)&&pending.get(file)!==text)stale();bytes-=Buffer.byteLength(pending.get(file)??'');pending.set(file,text);bytes+=size;
    if(bytes>=outputBytes)await scope.flush();
   };
   const value=target[method];return typeof value==='function'?value.bind(target):value;
  }});
  this.builder=new PublicationDocumentBuilder(retained,{owner:this.owner,collections,signal});
 }
 drain(){return this.finalization.drain();}
 count(kind='files'){return this.builder.count(kind);}
 async getFile(name){const value=await this.builder.get('files',name);return value?{path:value.name,bytes:value.size,sha256:value.sha256}:null;}
 async *files(){for await(const {value} of this.builder.items('files'))yield {path:value.name,bytes:value.size,sha256:value.sha256};}
 async *choices(kind){if(!choiceKinds.has(kind))throw new AppError('INVALID');for await(const {value} of this.builder.items(kind))yield value;}
 async addChoice(kind,key,value){
  this.finalization.check();if(!choiceKinds.has(kind))throw new AppError('INVALID');await this.ready();this.signal?.throwIfAborted();const prior=await this.builder.get(kind,key);
  if(prior!==null){if(serialize(prior)!==serialize(value))stale();return;}
  await this.builder.append(kind,key,value);
 }
 async retain(name,content){
  this.finalization.check();await this.ready();this.signal?.throwIfAborted();const streaming=streamed(content),type=streaming?'text':content instanceof FileContent?(isDownloadPath(name)?'binary':'media'):typeof content==='string'?'text':'binary';
  if(!streaming)assertPublicFiles(new Map([[name,content]]),this.blockedValues);
  const prior=await this.builder.get('files',name);
  if(prior!==null){
   let size=0,sha256;
   if(streaming){const hash=createHash('sha256');for await(const chunk of content){this.signal?.throwIfAborted();const bytes=Buffer.from(chunk);size+=bytes.length;hash.update(bytes);}sha256=hash.digest('hex');}
   else{size=contentSize(content);sha256=contentHash(content);}
   if(size!==prior.size||sha256!==prior.sha256)stale();return {path:name,bytes:size,sha256};
  }
  if(this.pendingNames.has(name))throw new AppError('PUBLICATION_IDENTITY');this.pendingNames.add(name);
  const index=this.nextBlob++,file=path.join(this.directory,index+'.blob');
  try{
   const chunks=streaming?publicationOutputChunks(content,{signal:this.signal}):contentStream(content);
   const expected=streaming?null:{size:contentSize(content),sha256:contentHash(content)},workspace=this.workspace,signal=this.signal,blockedValues=this.blockedValues;
   const saved=await this.finalization.write(beforeCommit=>writeContent(workspace,file,chunks,{signal,beforeCommit:saved=>{
    if(expected&&(saved.size!==expected.size||saved.sha256!==expected.sha256))stale();return beforeCommit(saved);
   }}),streaming?saved=>admitRetainedPublicFile(name,new FileContent(workspace,file,saved.size,saved.sha256),{type,blockedValues}):undefined);
   const descriptor={name,index,...saved,type,...(type==='media'?{header:content.header.toString('hex')}: {})};
   await this.builder.append('files',name,descriptor);await this.builder.append('blobIndexes',String(index),{name});
   return {path:name,bytes:saved.size,sha256:saved.sha256};
  }finally{this.pendingNames.delete(name);}
 }
 async finish({defaultPage}){
  await this.ready();await this.drain();
  if(this.pendingNames.size||this.nextBlob!==this.count()||!await this.builder.get('files',defaultPage)||!await this.builder.get('pages',defaultPage))throw new AppError('JOB_DAMAGED');
  const hash=createHash('sha256');for await(const text of publicationReleaseIdentity(this))hash.update(text);const id=hash.digest('hex');
  await this.retain('publication.json',publicationManifest(this,id));await this.drain();
  const output=await this.builder.finish({header:{version:1,generator,releaseId:id,defaultPage}});await this.flush();return {id,defaultPage,output};
 }
}
export async function* publicationReleaseIdentity(reader){
 yield '{"generator":'+JSON.stringify(generator)+',"files":[';let first=true;
 for await(const row of reader.files()){if(row.path==='publication.json')continue;yield (first?'':',')+JSON.stringify(row);first=false;}yield ']}';
}
// Preserve the existing public manifest spelling while enumerating its rows.
export async function* publicationManifest(reader,id){
 yield '{\n  "formatVersion": 2,\n  "generator": '+JSON.stringify(generator)+',\n  "releaseId": '+JSON.stringify(id)+',\n  "projects": [';
 let first=true;for await(const row of reader.choices('projects')){yield (first?'\n':',\n')+'    '+JSON.stringify(row.id);first=false;}yield (first?'':'\n  ')+'],\n  "entries": [';
 first=true;for await(const row of reader.choices('entries')){yield (first?'\n':',\n')+'    '+JSON.stringify(row.id);first=false;}yield (first?'':'\n  ')+'],\n  "files": [';
 first=true;for await(const row of reader.files()){if(row.path==='publication.json')continue;yield (first?'\n':',\n')+JSON.stringify(row,null,2).split('\n').map(line=>'    '+line).join('\n');first=false;}
 yield (first?'':'\n  ')+']\n}\n';
}
export function outputManifestReader(output){return {
 async *files(){for await(const {value} of output.items('files'))yield {path:value.name,bytes:value.size,sha256:value.sha256};},
 async *choices(kind){for await(const {value} of output.items(kind))yield value;}
};}
export async function verifyOutputManifest(output,stored,{signal}={}){
 const reader=outputManifestReader(output),hash=createHash('sha256');for await(const text of publicationReleaseIdentity(reader)){signal?.throwIfAborted();hash.update(text);}if(hash.digest('hex')!==stored.id)stale();
 let bytes=0;const manifestHash=createHash('sha256');for await(const text of publicationManifest(reader,stored.id)){signal?.throwIfAborted();bytes+=Buffer.byteLength(text);manifestHash.update(text);}
 const manifest=await output.get('files','publication.json');if(!manifest||manifest.size!==bytes||manifest.sha256!==manifestHash.digest('hex'))stale();
}
