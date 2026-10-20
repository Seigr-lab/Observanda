// Edition choices are immutable indexed values within the website's encrypted
// metadata owner. Checkpoints publish only small roots, never a corpus-sized list.
import {randomUUID} from 'node:crypto';
import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {RetainedTableIndex,validTableRef} from './retained-table-index.js';
import {RecordValueTree} from './record-value-tree.js';
import {withWorkspaceMetadataBatch} from './metadata-batch.js';
import {publicationWorkspace} from './publication-pin.js';
import {publicationSource} from './publication-source.js';
import {researchId,parseResearchReference} from './web/research-reference.js';
import {canonicalValue,revisionId} from './web/revision-model.js';
import {validWebsitePin} from './web/website-pin.js';
import {validWebsiteDraftPin} from './web/website-draft-pin.js';
import {validRetainedEditionSelection,validEditionSelection,validEditionRecord,editionRevisionKey,editionAvailabilityKey,emptyEditionSelection} from './web/publication-selection.js';
const collections=['records','history','availability'],natural=value=>Number.isSafeInteger(value)&&value>=0;
const invalid=()=>{throw new AppError('INVALID');},damaged=()=>{throw new AppError('JOB_DAMAGED');};
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join()===keys.slice().sort().join();
const hash=value=>digest(serialize(canonicalValue(value)));
const key=(kind,value)=>kind==='records'?value.id:kind==='history'?editionRevisionKey(value):editionAvailabilityKey(value);
const validValue=(kind,value)=>kind==='availability'?validEditionSelection({version:1,records:[],availability:[value]}):validEditionRecord(value)&&(kind!=='history'||value.include);
const validKey=(kind,value)=>typeof value==='string'&&(kind==='records'?researchId(value):kind==='history'?/^[a-f0-9-]{36}:[a-f0-9]{64}$/.test(value)&&researchId(value.slice(0,36)):researchId(value.slice(0,36))&&value[36]===':'&&!!parseResearchReference(value.slice(37)));
const headFile=identity=>'.observanda/publication-selections/'+identity+'.json';
const blockPrefix=id=>'.observanda/publication-selection-blocks/'+id;
const discardFile=id=>'.observanda/publication-selection-discard/'+id+'.json';
const receiptFile=(id,commandId)=>'.observanda/publication-selection-receipts/'+id+'/'+commandId+'.json';
export function editionSelectionSource(source){
 if(!source||!researchId(source.workspaceId)||!revisionId(source.etag)||!validWebsitePin(source.websitePin)||source.websitePin.websiteRevision===null||source.websitePin.researchSnapshotId!==source.etag||source.websiteDraft!==undefined&&!validWebsiteDraftPin(source.websiteDraft)||source.book!==undefined||source.draft!==undefined)invalid();
 return {workspaceId:source.workspaceId,etag:source.etag,websitePin:source.websitePin,...(source.websiteDraft===undefined?{}:{websiteDraft:source.websiteDraft})};
}
export {validRetainedEditionSelection} from './web/publication-selection.js';
class SelectionBlocks{
 constructor(workspace,id,{signal}={}){this.workspace=workspace;this.prefix=blockPrefix(id);this.signal=signal;}
 async read(kind,revision){
  this.signal?.throwIfAborted();if(!['value','index'].includes(kind)||!revisionId(revision))damaged();
  const raw=await this.workspace.readMetadata(this.prefix+'/'+kind+'-'+revision+'.json',65536);if(raw===null||digest(raw)!==revision)damaged();
  let value;try{value=JSON.parse(raw);}catch{damaged();}if(serialize(value)!==raw)damaged();return value;
 }
 async put(kind,value){
  this.signal?.throwIfAborted();if(!['value','index'].includes(kind))invalid();const raw=serialize(value);if(Buffer.byteLength(raw)>65536)throw new AppError('LIMIT');
  const revision=digest(raw),file=this.prefix+'/'+kind+'-'+revision+'.json',prior=await this.workspace.readMetadata(file,65536);
  if(prior===null)await this.workspace.writeMetadata(file,raw);else if(prior!==raw)damaged();return revision;
 }
}
class SelectionReader{
 constructor(workspace,head,{signal}={}){this.head=head;this.signal=signal;this.blocks=new SelectionBlocks(workspace,head.id,{signal});this.tree=new RecordValueTree(this.blocks);this.index=new RetainedTableIndex(this.blocks,{namespace:'index',allowSparseBranches:true});}
 count(kind){if(!collections.includes(kind))invalid();return this.head.roots[kind]?.count??0;}
 async decode(kind,row){if(!row)return null;this.signal?.throwIfAborted();const value=await this.tree.read(row.revision);if(!validValue(kind,value)||key(kind,value)!==row.id)damaged();return value;}
 async get(kind,id){if(!validKey(kind,id))invalid();return this.decode(kind,await this.index.find({root:this.head.roots[kind]},id));}
 async *items(kind){if(!collections.includes(kind))invalid();for await(const row of this.index.entries({root:this.head.roots[kind]}))yield await this.decode(kind,row);}
 async window(kind,offset,limit){if(!collections.includes(kind)||!natural(offset)||!Number.isSafeInteger(limit)||limit<1||limit>32)invalid();const items=[],total=this.count(kind);for(let at=offset;at<Math.min(total,offset+limit);at++)items.push(await this.decode(kind,await this.index.entryAt({root:this.head.roots[kind]},at)));return {items,total,offset,next:offset+items.length<total?offset+items.length:null};}
}
function validateHead(head,source){
 if(!exact(head,['version','id','source','workspaceId','websiteId','generation','roots'])||head.version!==1||!researchId(head.id)||head.source!==source||!researchId(head.workspaceId)||head.websiteId!==null&&!researchId(head.websiteId)||!natural(head.generation)||!exact(head.roots,collections)||collections.some(kind=>!validTableRef(head.roots[kind])))damaged();return head;
}
const pin=head=>({version:2,id:head.id,source:head.source,revision:hash(head)});
export class PublicationEditionSelections{
 constructor(workspace){this.workspace=publicationWorkspace(workspace);}
 async readHead(source){const raw=await this.workspace.readMetadata(headFile(source),8192);if(raw===null)return null;try{return validateHead(JSON.parse(raw),source);}catch(error){if(error.code)throw error;damaged();}}
 async bound(selection,{source,signal}={}){
  if(!validRetainedEditionSelection(selection))invalid();const head=await this.readHead(selection.source);
  if(!head||head.id!==selection.id||hash(head)!==selection.revision)throw new AppError('CONFLICT');
  if(head.websiteId!==(this.workspace.websiteId??null)||source&&hash(editionSelectionSource(source))!==head.source)throw new AppError('WORKSPACE_CHANGED');
  return new SelectionReader(this.workspace,head,{signal});
 }
 async operate(operation,data,{signal}={}){
  if(!data||typeof data!=='object'||Array.isArray(data))invalid();
  if(await this.workspace.storageKind()!=='catalogue')throw new AppError('STORAGE_UPGRADE_REQUIRED');
  if(operation==='open')await this.recover({signal});
  const work=async()=>{
   signal?.throwIfAborted();
   if(operation==='open'){
    const source=editionSelectionSource(data.source);if(source.websitePin.websiteId!==(this.workspace.websiteId??null))throw new AppError('WORKSPACE_CHANGED');
    await publicationSource(this.workspace,source,{signal,inventory:true,page:{offset:0,limit:1},consume:async metadata=>{if(metadata.id!==source.workspaceId)throw new AppError('WORKSPACE_CHANGED');}});
    const identity=hash(source),previous=await this.readHead(identity),head=previous??{version:1,id:randomUUID(),source:identity,workspaceId:source.workspaceId,websiteId:this.workspace.websiteId??null,generation:0,roots:{records:null,history:null,availability:null}};
    if(!previous)await this.workspace.writeMetadata(headFile(identity),serialize(head));return {selection:pin(head),resumed:!!previous,counts:Object.fromEntries(collections.map(kind=>[kind,head.roots[kind]?.count??0]))};
   }
   if(operation==='checkpoint'){
    if(!researchId(data.commandId)||!validRetainedEditionSelection(data.selection)||!Array.isArray(data.changes)||data.changes.length<1||data.changes.length>32||Buffer.byteLength(JSON.stringify(data.changes))>1024*1024)invalid();
    const request=hash(data),receipt=await this.workspace.readMetadata(receiptFile(data.selection.id,data.commandId),2048);
    if(receipt!==null){const saved=JSON.parse(receipt);if(saved.request!==request)throw new AppError('CONFLICT');const current=await this.readHead(data.selection.source);if(!current||current.id!==data.selection.id)throw new AppError('CONFLICT');return saved.result;}
    const reader=await this.bound(data.selection,{signal}),head=structuredClone(reader.head),seen=new Set();
    for(const change of data.changes){
     const {collection,id,value}=change;if(!exact(change,['collection','id','value'])||!collections.includes(collection)||!validKey(collection,id)||value!==null&&(!validValue(collection,value)||key(collection,value)!==id)||seen.has(collection+':'+id))invalid();seen.add(collection+':'+id);
     head.roots[collection]=value===null?await reader.index.remove(head.roots[collection],id):await reader.index.change(head.roots[collection],id,await reader.tree.retain(value));
    }
    await reader.index.flushRoots(Object.values(head.roots),{signal});head.generation++;signal?.throwIfAborted();
    const result={selection:pin(head),counts:Object.fromEntries(collections.map(kind=>[kind,head.roots[kind]?.count??0]))};
    await this.workspace.writeMetadata(headFile(head.source),serialize(head));await this.workspace.writeMetadata(receiptFile(head.id,data.commandId),serialize({request,result}));return result;
   }
   if(operation==='discard'&&validRetainedEditionSelection(data.selection)&&!await this.readHead(data.selection.source))return {discarded:true,cleanup:data.selection.id};
   const reader=await this.bound(data.selection,{signal});
   if(operation==='read'){
    if(!Array.isArray(data.keys)||data.keys.length>64)invalid();const items=[];for(const item of data.keys){if(!exact(item,['collection','id'])||!collections.includes(item.collection)||!validKey(item.collection,item.id))invalid();items.push({...item,value:await reader.get(item.collection,item.id)});}return {selection:pin(reader.head),items};
   }
   if(operation==='window')return {selection:pin(reader.head),...await reader.window(data.collection,data.offset??0,data.limit??20)};
   if(operation==='discard'){await this.workspace.writeMetadata(discardFile(reader.head.id),serialize({version:1,id:reader.head.id,source:reader.head.source}));await this.workspace.removeMetadata(headFile(reader.head.source));return {discarded:true,cleanup:reader.head.id};}
   invalid();
  };
  const result=await (['open','checkpoint','discard'].includes(operation)?this.workspace.withLock(()=>withWorkspaceMetadataBatch(this.workspace,work)):this.workspace.catalogue(work));
  if(result.cleanup){await this.cleanup(result.cleanup,{signal});return {discarded:true};}return result;
 }
 async cleanup(id,{signal}={}){
  if(!researchId(id))invalid();
  for(;;){signal?.throwIfAborted();const done=await this.workspace.withLock(()=>withWorkspaceMetadataBatch(this.workspace,async()=>{
   const raw=await this.workspace.readMetadata(discardFile(id),1024);if(raw===null)return true;let journal;try{journal=JSON.parse(raw);}catch{damaged();}
   if(!exact(journal,['version','id','source'])||journal.version!==1||journal.id!==id||!revisionId(journal.source)||(await this.readHead(journal.source))?.id===id)damaged();
   let removed=0;for(const [prefix,valid] of [[blockPrefix(id),name=>/^(value|index)-[a-f0-9]{64}\.json$/.test(name)],['.observanda/publication-selection-receipts/'+id,name=>name.endsWith('.json')&&researchId(name.slice(0,-5))]]){
    const page=await this.workspace.metadataPage(prefix,{limit:64});for(const row of page.items){signal?.throwIfAborted();if(!valid(row.name))damaged();await this.workspace.removeMetadata(prefix+'/'+row.name);removed++;}
   }
   if(!removed)await this.workspace.removeMetadata(discardFile(id));return !removed;
  }));if(done)return;}
 }
 async recover({signal}={}){
  for(;;){const page=await this.workspace.metadataPage('.observanda/publication-selection-discard',{limit:32});if(!page.items.length)return;for(const row of page.items){if(!row.name.endsWith('.json')||!researchId(row.name.slice(0,-5)))damaged();await this.cleanup(row.name.slice(0,-5),{signal});}}
 }
 async verify(){
  for await(const name of this.workspace.metadataNames('.observanda/publication-selection-discard')){
   if(!name.endsWith('.json')||!researchId(name.slice(0,-5)))damaged();let value;try{value=JSON.parse(await this.workspace.readMetadata(discardFile(name.slice(0,-5)),1024));}catch{damaged();}
   if(!exact(value,['version','id','source'])||value.version!==1||value.id!==name.slice(0,-5)||!revisionId(value.source)||(await this.readHead(value.source))?.id===value.id)damaged();
  }
  for await(const name of this.workspace.metadataNames('.observanda/publication-selections')){
   if(!/^[a-f0-9]{64}\.json$/.test(name))damaged();const head=await this.readHead(name.slice(0,-5));if(!head||head.websiteId!==(this.workspace.websiteId??null))damaged();
   const reader=new SelectionReader(this.workspace,head);for(const kind of collections){let count=0;for await(const value of reader.items(kind)){void value;count++;}if(count!==reader.count(kind))damaged();}
  }
 }
}
export async function publicationEditionChoices(workspace,edition=emptyEditionSelection(),{source,signal}={}){
 if(validRetainedEditionSelection(edition))return new PublicationEditionSelections(workspace).bound(edition,{source,signal});
 if(!validEditionSelection(edition))invalid();const rows={records:edition.records,history:(edition.history??[]).filter(value=>value.include),availability:edition.availability??[]},maps=Object.fromEntries(collections.map(kind=>[kind,new Map(rows[kind].map(value=>[key(kind,value),value]))]));
 return {count:kind=>maps[kind].size,get:async(kind,id)=>maps[kind].get(id)??null,async *items(kind){yield* rows[kind];}};
}
export const editionSelectionValueKey=key;
