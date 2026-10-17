// Private, paged material discovery over the shared authenticated metadata tree.
import {AppError} from './errors.js';
import {MetadataFeed} from './metadata-feed.js';
import {withScratch} from './scratch-work.js';
import {catalogueContext} from './research-catalogue.js';
import {researchId} from './web/research-reference.js';
import {MaterialIndexSegments,materialSegmentOwner} from './material-index-segments.js';
import {materialHeadVisible,materialOwnerTransfer,materialReferenceVisible,stageMaterialReturnHead,materialReturnState,materialReturnedItem,settleMaterialReturnHead} from './material-visibility.js';
import {requireRecordOwnerTransfers} from './catalogue-format.js';
import {digest} from './storage-format.js';
import {revisionText} from './web/revision-model.js';
import {withoutFigureSources} from './web/figure-provenance.js';
const root='.observanda/materials/index',marker=root+'/state.json';
const kinds=['artifact','dataset','analysis','collection'];
const invalid=()=>{throw new AppError('INVALID');};
const damaged=()=>{throw new AppError('CATALOGUE_DAMAGED');};
export class MaterialIndex{
 constructor(materials){this.materials=materials;this.workspace=materials.workspace;this.segments=new MaterialIndexSegments(materials);}
 feed(recordId=null,kind=null,pending=false){return new MetadataFeed(this.workspace,root+'/'+(pending?'pending':'heads')+'/'+(recordId??'all')+'/'+(kind??'all'));}
 async item(id){const raw=await this.workspace.readMetadata(root+'/items/'+id+'.json',2048);return materialReturnedItem(this.workspace,id,raw===null?null:JSON.parse(raw));}
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
  if(raw!==null){const item=JSON.parse(raw);if(item.id!==head.id||item.kind!==head.kind||item.recordId!==head.recordId||item.stagedBatch!==head.stagedBatch||item.ownerTransfer!==head.ownerTransfer)damaged();return;}
  const retired=materialSegmentOwner(head)?await this.segments.retired(head.id):null;
  if(retired&&(retired.kind!==head.kind||retired.recordId!==head.recordId||retired.stagedBatch!==head.stagedBatch||retired.ownerTransfer!==head.ownerTransfer))damaged();
  const item=retired??{id:head.id,createdAt:head.createdAt,kind:head.kind,recordId:head.recordId,...(head.stagedBatch?{stagedBatch:head.stagedBatch}:{}),...(head.ownerTransfer?{ownerTransfer:head.ownerTransfer}:{})};
  await this.workspace.writeMetadata(file,JSON.stringify(item));
  if(materialSegmentOwner(head)){if(head.stagedBatch&&head.ownerTransfer)damaged();await this.segments.restore(item);return;}
  for(const recordId of [null,head.recordId])for(const kind of [null,head.kind])await this.add(this.feed(recordId,kind),item);
 }
 async changed(head,doc,{stagedBatch=null}={}){
  if(stagedBatch!==null){
   if(!researchId(stagedBatch)||head.stagedBatch!==stagedBatch||head.kind!=='artifact')invalid();
  }
  await this.addHead(head);
  await this.workspace.writeMetadata(root+'/dependencies/'+doc.id+'/'+head.revision+'.json',JSON.stringify({kind:doc.kind,id:doc.id,revision:head.revision,...this.materials.referenceSet(doc.content)}));
  if(stagedBatch===null)await this.advance();
 }
 async advance(){const state=await this.state();if(!state)damaged();await this.workspace.writeMetadata(marker,JSON.stringify({...state,generation:state.generation+1}));}
 async publishBatch(command){
  await this.ensureLocked();if(await this.segments.publish(command))await this.advance();
 }
 // Transfer staging is an internal, receipt-bound write path. The destination
 // record need not be current yet; its authenticated incoming receipt owns it.
 async stageTransferHead(head,doc,{transferId}){
  const receipt=await materialOwnerTransfer(this.workspace,transferId,head?.recordId);
  if(!['copying','verified','activating'].includes(receipt.phase)||head.stagedBatch!==undefined||head.ownerTransfer!==transferId||!kinds.includes(head.kind)||doc?.format!==1||doc.kind!==head.kind||doc.id!==head.id||doc.recordId!==head.recordId||digest(revisionText(doc))!==head.revision)damaged();
  const expected={kind:doc.kind,id:doc.id,revision:head.revision,recordId:doc.recordId,title:doc.title,createdAt:doc.createdAt,...this.materials.referenceSet(doc.content),figureHash:doc.content.figure?digest(revisionText(withoutFigureSources(doc.content.figure))):null,figureId:doc.content.figure?.id??null,ownerTransfer:transferId};
  if(revisionText(head)!==revisionText(expected))damaged();
  await this.workspace.catalogue(store=>requireRecordOwnerTransfers(store.db));await this.ensureLocked();
  if(await stageMaterialReturnHead(this.materials,head)){await this.workspace.writeMetadata(root+'/dependencies/'+head.id+'/'+head.revision+'.json',JSON.stringify({kind:doc.kind,id:doc.id,revision:head.revision,...this.materials.referenceSet(doc.content)}));return;}
  const previous=await this.materials.current(head.id,{includeStaged:true});if(previous&&revisionText(previous)!==revisionText(head))throw new AppError('MATERIAL_CHANGED');
  const file=this.materials.metadataFile('objects/'+head.id+'/'+head.revision+'.json'),stored=await this.materials.json(file,{missing:true});if(stored&&revisionText(stored)!==revisionText(doc))damaged();
  if(!stored)await this.materials.put(file,doc);await this.materials.put(this.materials.metadataFile('objects/'+head.id+'/head.json'),head);
  await this.addHead(head);await this.workspace.writeMetadata(root+'/dependencies/'+head.id+'/'+head.revision+'.json',JSON.stringify({kind:doc.kind,id:doc.id,revision:head.revision,...this.materials.referenceSet(doc.content)}));
 }
 async publishTransfer(command){await this.ensureLocked();await this.workspace.catalogue(store=>requireRecordOwnerTransfers(store.db));if(await this.segments.publishTransfer(command))await this.advance();}
 // Remove only the current discovery pointer. Immutable revisions and their
 // dependency indexes remain available to historical references.
 async removeHead(head){
  await settleMaterialReturnHead(this.workspace,head.id);
  const file=root+'/items/'+head.id+'.json',raw=await this.workspace.readMetadata(file,2048);if(raw===null)damaged();
  const item=JSON.parse(raw);if(item.id!==head.id||item.kind!==head.kind||item.recordId!==head.recordId||item.stagedBatch!==head.stagedBatch||item.ownerTransfer!==head.ownerTransfer)damaged();
  if(materialSegmentOwner(item)){if(!await materialHeadVisible(this.workspace,head))damaged();await this.segments.retire(item);}
  else for(const recordId of [null,head.recordId])for(const kind of [null,head.kind]){const feed=this.feed(recordId,kind);await this.workspace.removeMetadata(feed.order+'/'+feed.key(item));}
  await this.workspace.removeMetadata(file);await this.advance();
 }
 async addImport(item){if(item.batchId)return;await this.add(this.feed(item.recordId,null,true),item);}
 async finishImport(item){if(item.batchId)return;const feed=this.feed(item.recordId,null,true);await this.workspace.removeMetadata(feed.order+'/'+feed.key(item));}
 async inputSet(ref){
  return this.workspace.catalogue(async()=>{
   const value=await this.inputSetStored(ref),head=await this.materials.current(ref.id,{includeStaged:true});
   if(!await materialReferenceVisible(this.workspace,ref,head))throw new AppError('MATERIAL_INCOMPLETE');
   return value;
  });
 }
 // Integrity verification may inspect an unpublished dependency row, but this
 // entry point never supplies an attached material to product readers.
 async inputSetStored(ref){
  const raw=await this.workspace.readMetadata(root+'/dependencies/'+ref.id+'/'+ref.revision+'.json',1024*1024);
  if(raw===null)return this.materials.referenceSet((await this.materials.readStored(ref)).content);
  const value=JSON.parse(raw);
  if(value.id!==ref.id||value.kind!==ref.kind||value.revision!==ref.revision)damaged();
  return this.materials.referenceSet(value);
 }
 async *iterInputs(ref){for await(const input of this.materials.references(await this.inputSet(ref)))yield await this.materials.referenceAddress(input);}
 async inputs(ref){const items=[];for await(const input of this.iterInputs(ref))items.push(input);return items;}
 async verify({initialize=true}={}){
  if(initialize)await this.ensureLocked();else if(!await this.state())return;
  return this.workspace.catalogue(async store=>withScratch(async expected=>{
   const checkedFeeds=new Set();
   const read=async file=>{const raw=await this.workspace.readMetadata(file,8192);if(raw===null)damaged();try{return JSON.parse(raw);}catch{damaged();}};
   const check=async(feed,item,pointer={id:item.id,createdAt:item.createdAt})=>{
    if(!checkedFeeds.has(feed.marker)){if(!await feed.initialized())damaged();if(checkedFeeds.size>=128)checkedFeeds.delete(checkedFeeds.values().next().value);checkedFeeds.add(feed.marker);}
    const file=feed.order+'/'+feed.key(item),stored=await read(file);
    if(JSON.stringify(stored)!==JSON.stringify(pointer)||!await expected.add('metadata:'+file))damaged();
   };
   for await(let head of this.materials.headEntries({includeStaged:true})){
    const returned=await materialReturnState(this.workspace,head.id);if(returned&&!returned.settled&&returned.receipt.phase!=='complete'){head=returned.previousHead;if(!head)continue;}
    const item=await this.item(head.id);if(!item)damaged();
    if(item.id!==head.id||item.kind!==head.kind||item.recordId!==head.recordId||item.stagedBatch!==head.stagedBatch||item.ownerTransfer!==head.ownerTransfer)damaged();
    if(materialSegmentOwner(item)){if(await materialHeadVisible(this.workspace,head)&&!await expected.add('batch-member:'+materialSegmentOwner(item)+':'+item.id))damaged();}
    else for(const recordId of [null,head.recordId])for(const kind of [null,head.kind])await check(this.feed(recordId,kind),item);
   }
   await withScratch(async seen=>{
    for await(const segment of this.segments.entries()){
     const pointer={id:segment.id,createdAt:segment.createdAt,batchId:segment.batchId};
     for(const recordId of [null,segment.recordId])for(const kind of this.segments.buckets(segment))await check(this.segments.feed(recordId,kind),pointer,pointer);
     for await(const ref of this.materials.sequences.items(segment.inputsIndex)){
      if(!ref||!kinds.includes(ref.kind)||segment.version===1&&ref.kind!=='artifact'||!researchId(ref.id))damaged();
      const inherited=await this.segments.inherited(segment,ref);if(!inherited&&!await seen.add(ref.id))damaged();
      if(segment.version===2&&!await expected.add('segment-kind:'+segment.batchId+':'+ref.kind+':'+ref.id+':'+ref.revision))damaged();
      const head=await this.segments.item(segment,ref),doc=await this.materials.read(ref);
      if(doc.recordId!==segment.recordId)damaged();
      if(inherited)continue;
      if(head){if(!await expected.remove('batch-member:'+segment.batchId+':'+ref.id))damaged();}
      else if(!await expected.add('retired:'+ref.id))damaged();
     }
     if(segment.version===2)for(const kind of kinds)for await(const ref of this.materials.sequences.items(segment.sequences[kind]))if(ref?.kind!==kind||!await expected.remove('segment-kind:'+segment.batchId+':'+kind+':'+ref.id+':'+ref.revision))damaged();
    }
   });
   for await(const key of store.objectIdEntries('material-return-head:')){
    const value=await materialReturnState(this.workspace,key.slice('material-return-head:'.length));
    if(!value||value.settled||value.receipt.phase!=='complete'||value.head!==null)continue;
    if(!materialSegmentOwner(value.placement)){for(const recordId of [null,value.recordId])for(const kind of [null,value.placement.kind])await check(this.feed(recordId,kind),value.placement);}
    else if(!value.previousRetired&&!await expected.remove('retired:'+value.id))damaged();
   }
   for await(const name of this.workspace.metadataNames(root+'/retired')){
    if(!/^[a-f0-9-]{36}\.json$/.test(name))damaged();const id=name.slice(0,-5);if(!await this.segments.retired(id))continue;if(!await expected.remove('retired:'+id))damaged();
   }
   for await(const id of this.materials.names('imports'))if(researchId(id)){
    const item=await this.materials.importState(id);if(!item.completed&&!item.batchId)await check(this.feed(item.recordId,null,true),item);
   }
   // Authenticate the reverse pointer set, including unknown scope/kind feeds.
   for(const family of ['heads','pending','segments']){
    const start='metadata:'+root+'/'+family+'/';
    for await(const id of store.objectIdEntries(start)){
     const parts=id.slice(start.length).split('/');
     if(parts.length===2&&parts[1].endsWith('-order.json'))continue;
     if(!await expected.remove(id))damaged();
    }
   }
   if(expected.size)damaged();
  }));
 }
 // Preview the exact discovery order of one pending segment and a bounded
 // set of final analysis heads. This internal reader never publishes pointers.
 // Call in a fixed catalogue snapshot and bind its generation at admission.
 async *projectedHeads({recordId,segment,heads,signal}){
  if(!researchId(recordId)||!Array.isArray(heads)||heads.length>32)invalid();
  const replacements=new Map(heads.map(head=>[head.id,head]));if(replacements.size!==heads.length)damaged();
  const normal=this.feed(recordId),segments=this.segments.feed(recordId),extra=[];
  for(const head of heads){
   if(head.kind!=='analysis'||head.recordId!==recordId||head.stagedBatch!==undefined)damaged();
   const current=await this.materials.current(head.id);if(!current)extra.push(head);
  }
  if(segment)extra.push({...segment,id:segment.id,batchId:segment.batchId});
  extra.sort((a,b)=>normal.key(a).localeCompare(normal.key(b)));
  const stream=async function*(feed){let cursor=null;do{const page=await feed.page({cursor,limit:32});yield* page.items;cursor=page.next;}while(cursor);};
  const sources=[stream(normal)[Symbol.asyncIterator](),stream(segments)[Symbol.asyncIterator]()],next=[await sources[0].next(),await sources[1].next()];
  try{
   while(!next[0].done||!next[1].done||extra.length){
    signal?.throwIfAborted();let selected=-1,pointer=extra[0]??null;
    for(let i=0;i<2;i++)if(!next[i].done&&(!pointer||normal.key(next[i].value)<normal.key(pointer))){selected=i;pointer=next[i].value;}
    if(selected<0)extra.shift();else next[selected]=await sources[selected].next();
    if(pointer.batchId){
     const pending=segment?.batchId===pointer.batchId,value=pending?segment:await this.segments.read(pointer.batchId);
     if(value.id!==pointer.id||value.createdAt!==pointer.createdAt||value.recordId!==recordId)damaged();
     for await(const ref of this.materials.sequences.items(value.inputsIndex)){
      signal?.throwIfAborted();const head=pending?await this.materials.current(ref.id,{includeStaged:true}):await this.segments.item(value,ref);
      if(pending&&(!head||head.kind!=='artifact'||head.recordId!==recordId||head.revision!==ref.revision||head.stagedBatch!==value.batchId))damaged();
      if(head)yield replacements.get(head.id)??head;
     }
    }else{
     const head=replacements.get(pointer.id)??await this.materials.current(pointer.id);
     if(!head){const returned=await materialReturnState(this.workspace,pointer.id);if(returned&&!returned.settled&&returned.receipt.phase==='complete'&&returned.head===null&&!materialSegmentOwner(returned.placement))continue;}
     if(!head||head.recordId!==recordId||head.stagedBatch!==undefined)damaged();yield head;
    }
   }
  }finally{await Promise.all(sources.map(source=>source.return?.()));}
 }
 async page({recordId=null,kind=null,query='',cursor=null,limit=20,pending=false,signal}={},{initialize=true}={}){
  if(recordId!==null&&!researchId(recordId)||kind!==null&&!kinds.includes(kind)||typeof query!=='string'||query.length>200||!Number.isSafeInteger(limit)||limit<1||limit>50||typeof pending!=='boolean')invalid();
  if(pending&&(!recordId||kind||query))invalid();
  if(cursor!==null&&(typeof cursor!=='string'||cursor.length>4096||!/^[A-Za-z0-9_-]+$/.test(cursor)))invalid();
  if(initialize)await this.ensure();else if(!await this.state())throw new AppError('ACCESS_UPGRADE');
  const feed=this.feed(recordId,kind,pending),segments=!pending?this.segments.feed(recordId,kind):null;
  return this.workspace.catalogue(async store=>{
   const state=await this.state(),scope=JSON.stringify({recordId,kind,query,limit,pending});if(!state)damaged();
   let anchor={scope,generation:state.generation,normal:null,segments:null,active:null};
   if(cursor){try{anchor=store.decode('material-page',scope,Buffer.from(cursor,'base64url'));}catch{invalid();}if(anchor.scope!==scope)invalid();
    // Existing cursors retain their ordinary-feed continuation. No batch was
    // visible when the old representation created such a cursor.
    if(Object.hasOwn(anchor,'after'))anchor={scope,generation:anchor.generation,normal:anchor.after,segments:null,active:null};
   }
   if(!Number.isSafeInteger(anchor.generation)||anchor.generation<0||!['normal','segments'].every(key=>anchor[key]===null||typeof anchor[key]==='string')||anchor.active!==null&&(!researchId(anchor.active?.batchId)||!researchId(anchor.active?.segmentId)||!Number.isSafeInteger(anchor.active?.offset)||anchor.active.offset<0))invalid();
   if(!segments&&(anchor.segments!==null||anchor.active!==null))invalid();
   const source=async(owner,slot)=>{
    if(!owner)return {peek:async()=>null,take:()=>{}};
    const initialized=await owner.initialized();if(!initialized){const found=await store.objectIdPage('metadata:'+owner.order+'/');if(found.items.length||anchor[slot]!==null)damaged();return {peek:async()=>null,take:()=>{}};}
    let buffer=[],done=false;
    return {async peek(){if(!buffer.length&&!done){const page=await owner.page({cursor:anchor[slot],limit:32});buffer=page.items;done=page.next===null;}return buffer[0]??null;},take(){const value=buffer.shift();anchor[slot]=owner.cursor(owner.key(value));}};
   };
   const normal=await source(feed,'normal'),batches=await source(segments,'segments'),items=[];let scanned=0;
   while(items.length<limit&&scanned<200){
    signal?.throwIfAborted();
    if(anchor.active){
     const segment=await this.segments.read(anchor.active.batchId),sequence=this.segments.sequence(segment,kind);
     if(!sequence||segment.id!==anchor.active.segmentId||recordId&&segment.recordId!==recordId||anchor.active.offset>sequence.count)damaged();
     const page=await this.materials.sequences.page(sequence,{offset:anchor.active.offset,limit:Math.min(limit-items.length,200-scanned)});
     for(const ref of page.items){signal?.throwIfAborted();scanned++;anchor.active.offset++;const item=await this.segments.item(segment,ref);if(item&&kind&&item.kind!==kind)damaged();if(item&&(!query||item.title.toLocaleLowerCase().includes(query.toLocaleLowerCase())))items.push(item);}
     if(anchor.active.offset===sequence.count)anchor.active=null;
     continue;
    }
    const a=await normal.peek(),b=await batches.peek();if(!a&&!b)break;
    if(b&&(!a||segments.key(b)<feed.key(a))){
     if(!researchId(b.batchId))damaged();const segment=await this.segments.read(b.batchId);
     if(segment.id!==b.id||segment.createdAt!==b.createdAt||recordId&&segment.recordId!==recordId)damaged();
     batches.take();scanned++;anchor.active={batchId:b.batchId,segmentId:b.id,offset:0};continue;
    }
    normal.take();scanned++;
    const item=pending?await this.materials.importState(a.id):await this.materials.current(a.id);
    if(!item&&!pending){const returned=await materialReturnState(this.workspace,a.id);if(returned&&!returned.settled&&returned.receipt.phase==='complete'&&returned.head===null&&!materialSegmentOwner(returned.placement))continue;}
    if(!item||recordId&&item.recordId!==recordId||kind&&item.kind!==kind||pending&&item.completed||!pending&&materialSegmentOwner(item)!==null)damaged();
    if(!query||item.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()))items.push(item);
   }
   const more=anchor.active!==null||!!await normal.peek()||!!await batches.peek();
   return {items,next:more?store.encode('material-page',scope,anchor).toString('base64url'):null,changed:anchor.generation!==state.generation,scanned};
  });
 }
}
