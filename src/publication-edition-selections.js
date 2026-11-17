// Edition choices are immutable indexed values within the website's encrypted
// metadata owner. Checkpoints publish only small roots, never a corpus-sized list.
import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {RetainedTableIndex,validTableRef} from './retained-table-index.js';
import {RecordValueTree} from './record-value-tree.js';
import {publicationWorkspace} from './publication-pin.js';
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
export class PublicationEditionSelections{
 constructor(workspace){this.workspace=publicationWorkspace(workspace);}
 async readHead(source){const raw=await this.workspace.readMetadata(headFile(source),8192);if(raw===null)return null;try{return validateHead(JSON.parse(raw),source);}catch(error){if(error.code)throw error;damaged();}}
 async bound(selection,{source,signal}={}){
  if(!validRetainedEditionSelection(selection))invalid();const head=await this.readHead(selection.source);
  if(!head||head.id!==selection.id||hash(head)!==selection.revision)throw new AppError('CONFLICT');
  if(head.websiteId!==(this.workspace.websiteId??null)||source&&hash(editionSelectionSource(source))!==head.source)throw new AppError('WORKSPACE_CHANGED');
  return new SelectionReader(this.workspace,head,{signal});
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
