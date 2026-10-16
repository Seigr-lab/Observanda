// Private, paged material discovery over the shared authenticated metadata tree.
import {AppError} from './errors.js';
import {MetadataFeed} from './metadata-feed.js';
import {withScratch} from './scratch-work.js';
import {catalogueContext} from './research-catalogue.js';
import {researchId} from './web/research-reference.js';
const root='.observanda/materials/index',marker=root+'/state.json';
const kinds=['artifact','dataset','analysis','collection'];
const invalid=()=>{throw new AppError('INVALID');};
const damaged=()=>{throw new AppError('CATALOGUE_DAMAGED');};
export class MaterialIndex{
 constructor(materials){this.materials=materials;this.workspace=materials.workspace;}
 feed(recordId=null,kind=null,pending=false){return new MetadataFeed(this.workspace,root+'/'+(pending?'pending':'heads')+'/'+(recordId??'all')+'/'+(kind??'all'));}
 async state(){const raw=await this.workspace.readMetadata(marker,1024);if(raw===null)return null;const value=JSON.parse(raw);if(value.version!==1||!Number.isSafeInteger(value.generation)||value.generation<0)damaged();return value;}
 async write(operation){return catalogueContext.getStore()?.root===this.workspace.root?operation():this.workspace.withLock(operation);}
 async ensure(){if(!await this.state())await this.write(()=>this.ensureLocked());}
 async ensureLocked(){
  if(await this.state())return;
  for await(const head of this.materials.headEntries())await this.addHead(head);
  for await(const id of this.materials.names('imports'))if(researchId(id)){const item=await this.materials.importState(id);if(!item.completed)await this.addImport(item);}
  await this.workspace.writeMetadata(marker,JSON.stringify({version:1,generation:0}));
 }
 // Migration supplies a bounded stream of already selected owners. Initial
 // discovery does not rescan the growing shared metadata index after every page.
 async initializeLocked({heads,imports=[]}){
  if(await this.state())throw new AppError('EXISTS');
  for await(const head of heads)await this.addHead(head);
  for await(const item of imports)if(!item.completed)await this.addImport(item);
  await this.workspace.writeMetadata(marker,JSON.stringify({version:1,generation:0}));
 }
 async add(feed,item){await feed.putLocked(item);await this.workspace.writeMetadata(feed.marker,JSON.stringify({version:1}));}
 async addHead(head){
  const file=root+'/items/'+head.id+'.json',raw=await this.workspace.readMetadata(file,2048);
  if(raw!==null){const item=JSON.parse(raw);if(item.id!==head.id||item.kind!==head.kind||item.recordId!==head.recordId)damaged();return;}
  const item={id:head.id,createdAt:head.createdAt,kind:head.kind,recordId:head.recordId};
  await this.workspace.writeMetadata(file,JSON.stringify(item));
  for(const recordId of [null,head.recordId])for(const kind of [null,head.kind])await this.add(this.feed(recordId,kind),item);
 }
 async changed(head,doc){
  await this.addHead(head);
  await this.workspace.writeMetadata(root+'/dependencies/'+doc.id+'/'+head.revision+'.json',JSON.stringify({kind:doc.kind,id:doc.id,revision:head.revision,...this.materials.referenceSet(doc.content)}));
  const state=await this.state();await this.workspace.writeMetadata(marker,JSON.stringify({...state,generation:state.generation+1}));
 }
 // Remove only the current discovery pointer. Immutable revisions and their
 // dependency indexes remain available to historical references.
 async removeHead(head){
  const file=root+'/items/'+head.id+'.json',raw=await this.workspace.readMetadata(file,2048);if(raw===null)damaged();
  const item=JSON.parse(raw);if(item.id!==head.id||item.kind!==head.kind||item.recordId!==head.recordId)damaged();
  for(const recordId of [null,head.recordId])for(const kind of [null,head.kind]){const feed=this.feed(recordId,kind);await this.workspace.removeMetadata(feed.order+'/'+feed.key(item));}
  await this.workspace.removeMetadata(file);const state=await this.state();await this.workspace.writeMetadata(marker,JSON.stringify({...state,generation:state.generation+1}));
 }
 async addImport(item){if(item.batchId)return;await this.add(this.feed(item.recordId,null,true),item);}
 async finishImport(item){if(item.batchId)return;const feed=this.feed(item.recordId,null,true);await this.workspace.removeMetadata(feed.order+'/'+feed.key(item));}
 async inputSet(ref){
  const raw=await this.workspace.readMetadata(root+'/dependencies/'+ref.id+'/'+ref.revision+'.json',1024*1024);
  if(raw===null)return this.materials.referenceSet((await this.materials.read(ref)).content);
  const value=JSON.parse(raw);
  if(value.id!==ref.id||value.kind!==ref.kind||value.revision!==ref.revision)damaged();
  return this.materials.referenceSet(value);
 }
 async *iterInputs(ref){yield* this.materials.references(await this.inputSet(ref));}
 async inputs(ref){const items=[];for await(const input of this.iterInputs(ref))items.push(input);return items;}
 async verify({initialize=true}={}){
  if(initialize)await this.ensureLocked();
  else if(!await this.state())return;
  return this.workspace.catalogue(async store=>withScratch(async expected=>{
   const checkedFeeds=new Set();
   const read=async file=>{const raw=await this.workspace.readMetadata(file,8192);if(raw===null)damaged();try{return JSON.parse(raw);}catch{damaged();}};
   const check=async(feed,item)=>{
    if(!checkedFeeds.has(feed.marker)){
     if(!await feed.initialized())damaged();
     if(checkedFeeds.size>=128)checkedFeeds.delete(checkedFeeds.values().next().value);
     checkedFeeds.add(feed.marker);
    }
    const file=feed.order+'/'+feed.key(item),pointer=await read(file);
    if(JSON.stringify(pointer)!==JSON.stringify({id:item.id,createdAt:item.createdAt}))damaged();
    if(!await expected.add('metadata:'+file))damaged();
   };
   // Authenticate each expected pointer once in this catalogue snapshot. The
   // temporary ledger bounds memory while the reverse pass rejects every extra
   // pointer, including entries under unknown scopes or kinds.
   for await(const head of this.materials.headEntries()){
    const item=await read(root+'/items/'+head.id+'.json');
    if(item.id!==head.id||item.kind!==head.kind||item.recordId!==head.recordId)damaged();
    for(const recordId of [null,head.recordId])for(const kind of [null,head.kind])await check(this.feed(recordId,kind),item);
   }
   for await(const id of this.materials.names('imports'))if(researchId(id)){
    const item=await this.materials.importState(id);
    if(!item.completed&&!item.batchId)await check(this.feed(item.recordId,null,true),item);
   }
   for(const pending of [false,true]){
    const start='metadata:'+root+'/'+(pending?'pending':'heads')+'/';
    for await(const id of store.objectIdEntries(start)){
     const parts=id.slice(start.length).split('/');
     if(parts.length===2&&parts[1].endsWith('-order.json'))continue;
     if(!await expected.remove(id))damaged();
    }
   }
   if(expected.size)damaged();
  }));
 }
 async page({recordId=null,kind=null,query='',cursor=null,limit=20,pending=false,signal}={}){
  if(recordId!==null&&!researchId(recordId)||kind!==null&&!kinds.includes(kind)||typeof query!=='string'||query.length>200||!Number.isSafeInteger(limit)||limit<1||limit>50||typeof pending!=='boolean')invalid();
  if(pending&&(!recordId||kind||query))invalid();
  if(cursor!==null&&(typeof cursor!=='string'||cursor.length>4096||!/^[A-Za-z0-9_-]+$/.test(cursor)))invalid();
  await this.ensure();
  const feed=this.feed(recordId,kind,pending);
  return this.workspace.catalogue(async store=>{
   const state=await this.state(),scope=JSON.stringify({recordId,kind,query,limit,pending});if(!state)damaged();
   let anchor={scope,generation:state.generation,after:null};
   if(cursor){try{anchor=store.decode('material-page',scope,Buffer.from(cursor,'base64url'));}catch{invalid();}if(anchor.scope!==scope)invalid();}
   if(!await feed.initialized()){
    // Global initialization already indexed every source. Empty scopes require
    // no write, especially when this page belongs to a pinned read snapshot.
    const found=await store.objectIdPage('metadata:'+feed.order+'/');
    if(found.items.length||anchor.after)damaged();
    return {items:[],next:null,changed:anchor.generation!==state.generation,scanned:0};
   }
   let after=anchor.after,scanned=0;const items=[];
   do{
    signal?.throwIfAborted();
    const page=await feed.page({cursor:after,limit:Math.min(limit-items.length,200-scanned)});
    for(const pointer of page.items){
     signal?.throwIfAborted();scanned++;
     const item=pending?await this.materials.importState(pointer.id):await this.materials.current(pointer.id);
     if(!item||recordId&&item.recordId!==recordId||kind&&item.kind!==kind||pending&&item.completed)damaged();
     if(!query||item.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()))items.push(item);
    }
    after=page.next;
   }while(after&&items.length<limit&&scanned<200);
   return {items,next:after?store.encode('material-page',scope,{...anchor,after}).toString('base64url'):null,changed:anchor.generation!==state.generation,scanned};
  });
 }
}
