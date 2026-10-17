import {requirePublicationDocuments} from './catalogue-format.js';
import {isPublicationDocumentBlockName} from './publication-document.js';
import {withScratch} from './scratch-work.js';
import {publicationResearchWorkspace} from './publication-pin.js';
// Capture immutable publication inputs in bounded commits. The lifecycle lease
// protects their folder while ordinary authoring keeps its own short writers.
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {DatabaseAdmission} from './database-admission.js';
import {AppError} from './errors.js';
import {projectDomainHandoff} from './project-domain-lock.js';
import {withWorkspaceMetadataBatch} from './metadata-batch.js';
import {researchId} from './web/research-reference.js';
import {removePublicationInput} from './publication-input.js';
import {removePublicationMedia} from './publication-input-media.js';
import {ResearchMaterials} from './research-materials.js';
import {withoutWriterWait} from './writer-wait.js';
// A capture can retain its host reader and one source reader while committing.
// Bound active captures before opening readers so a burst cannot occupy every
// database admission slot and starve the writes needed to finish those reads.
const admission=new DatabaseAdmission({limit:4});
const captures='.observanda/release-captures';
const input=id=>'.observanda/release-inputs/'+id;
const journal=id=>captures+'/'+id+'.json';
const key=(db,id)=>'Observanda/publication-capture/'+db.id+'/'+id;
async function lock(db,id){return (await db.get('SELECT pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended($1,0)) AS locked',key(db,id))).locked;}
async function transaction(workspace,operation){
 for(let attempt=0;;attempt++)try{return await workspace.withLock(()=>withWorkspaceMetadataBatch(workspace,operation));}
 catch(error){if(error.code!=='LOCKED'||attempt===4)throw error;await delay(20*(attempt+1));}
}
async function discard(workspace,id,write){
 // A lost commit acknowledgement can leave the job published already. Its
 // journal was removed atomically with admission, so that input must survive.
 if(await write(()=>workspace.readMetadata(journal(id),1024))===null)return;
 // Each committed deletion advances the next bounded page. A failed cleanup
 // retains its journal so the next preparation can finish it after a restart.
 for(;;){const removed=await write(async()=>{
  const names=[];for await(const name of workspace.metadataNames(input(id))){names.push(name);if(names.length===32)break;}
  for(const name of names){if(!isPublicationDocumentBlockName(name)&&(!/^[a-f0-9-]{36}\.json$/.test(name)||!researchId(name.slice(0,-5))))throw new AppError('JOB_DAMAGED');await workspace.removeMetadata(input(id)+'/'+name);}
  return names.length;
 });if(!removed)break;}
 await removePublicationMedia(workspace,id);
 await write(async()=>{await workspace.removeMetadata(input(id)+'.json');await workspace.removeMetadata(journal(id));});
}
async function recover(workspace,db,write){
 let after=null;
 do{
  const page=await write(()=>workspace.metadataPage(captures,{after,limit:32,localOnly:true}));
  for(const item of page.items){
   let value;try{value=JSON.parse(item.text);}catch{throw new AppError('JOB_DAMAGED');}
   if(value?.version!==1||!researchId(value.id)||item.name!==value.id+'.json')throw new AppError('JOB_DAMAGED');
   // A live capture owns its own database lease; unrelated preparations proceed.
   if(await lock(db,value.id))await discard(workspace,value.id,write);
  }
  after=page.next;
 }while(after!==null);
}
export async function withPublicationCapture(workspace,operation,options={}){
 const ticket=await admission.acquire('publication-capture',{signal:options.signal});
 try{return await capture(workspace,operation,options);}finally{ticket.release();}
}
async function capture(workspace,operation,{signal,write=fn=>transaction(workspace,fn)}={}){
 if(await workspace.storageKind()!=='catalogue')return workspace.withLock(async()=>{
  const id=randomUUID();try{return await operation(workspace,id,fn=>fn());}catch(error){await removePublicationInput(workspace,id);throw error;}
 });
 await new ResearchMaterials(publicationResearchWorkspace(workspace)).index.ensure();
 return withScratch(written=>workspace.catalogue(async store=>{
  await projectDomainHandoff(store.db,{shared:true});
  await recover(workspace,store.db,write);signal?.throwIfAborted();
  const id=randomUUID(),prefix=input(id)+'/',pending=new Map();let bytes=0,finished=false;
  if(!await lock(store.db,id))throw new AppError('LOCKED');
  await write(()=>workspace.catalogue(async writer=>{
   // Reserve an empty capture namespace before treating unseen blocks as absent.
   // A collision must never replace or clean up another retained input.
   if(await workspace.readMetadata(input(id)+'.json',16*1024*1024)!==null||await workspace.readMetadata(journal(id),1024)!==null||(await workspace.metadataPage(input(id),{limit:1})).items.length)throw new AppError('PUBLICATION_IDENTITY');
   await requirePublicationDocuments(writer.db);await workspace.writeMetadata(journal(id),JSON.stringify({version:1,id}));
  }));
  const retained=file=>file===input(id)+'.json'||typeof file==='string'&&file.startsWith(prefix)&&(isPublicationDocumentBlockName(file.slice(prefix.length))||researchId(file.slice(prefix.length,-5))&&file.endsWith('.json'));
  const flush=async()=>{
   if(!pending.size)return;
   signal?.throwIfAborted();
   await write(async()=>{signal?.throwIfAborted();for(const [file,text] of pending)await workspace.writeMetadata(file,text);});
   pending.clear();bytes=0;
  };
  const captured=new Proxy(workspace,{get(target,method){
   if(method==='writeMetadata')return async(file,text)=>{
    if(!retained(file))throw new AppError('INVALID');signal?.throwIfAborted();
    // Record and custom-page inputs share the capture's flat namespace. Even
    // a later federated identity must never replace an already pinned input.
    const node=file.startsWith(prefix)&&isPublicationDocumentBlockName(file.slice(prefix.length));
    if(!await written.add(file,node?text:null))throw new AppError('PUBLICATION_IDENTITY');
    const size=Buffer.byteLength(text);if(pending.size>=32||bytes+size>256*1024)await flush();
    bytes-=Buffer.byteLength(pending.get(file)??'');pending.set(file,text);bytes+=size;
    if(bytes>=256*1024)await flush();
   };
   if(method==='readMetadata')return async(file,limit)=>{
    if(!retained(file))return target.readMetadata(file,limit);
    if(pending.has(file)){const text=pending.get(file);if(Buffer.byteLength(text)>limit)throw new AppError('LIMIT');return text;}
    // This capture started empty. A node not authored here cannot exist, so
    // immutable-node admission needs no extra writer transaction for a miss.
    const receipt=await written.get(file);if(receipt===undefined)return null;
    // Immutable nodes are small and already authenticated by their document
    // reader. Reuse their encrypted scratch receipt after the write batch flushes.
    if(receipt!==null){if(Buffer.byteLength(receipt)>limit)throw new AppError('LIMIT');return receipt;}
    // Original record/page bodies stay only in their retained storage. The
    // research reader intentionally predates these input commits.
    return write(()=>target.readMetadata(file,limit));
   };
   const value=target[method];return typeof value==='function'?value.bind(target):value;
  }});
  try{return await operation(captured,id,async commit=>{
   await flush();signal?.throwIfAborted();
   const value=await write(async()=>{signal?.throwIfAborted();const result=await commit();await workspace.removeMetadata(journal(id));return result;});finished=true;return value;
  });}catch(error){
   pending.clear();
   if(!finished)await withoutWriterWait(()=>discard(workspace,id,fn=>transaction(workspace,fn))).catch(()=>{/* The durable journal retains interrupted cleanup. */});
   throw error;
  }
 }),{signal});
}
