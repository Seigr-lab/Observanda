import {configurationPartName} from './configuration-transfer.js';
import path from 'node:path';
import {ResearchMaterials} from '../research-materials.js';
import {materialHeadVisible} from '../material-visibility.js';
import {withMaterialTraversal} from '../material-traversal.js';
import {recordRevision,historicalBook} from '../research.js';
import {attemptReferences} from '../web/attempt-model.js';
import {resultReferences} from '../web/result-statements.js';
import {figureReferences} from '../web/figure-provenance.js';
import {schemaReferences,measurementReferences} from '../web/measurement-model.js';
import {analysisMethodReferences} from '../web/analysis-model.js';
import {MediaStore} from '../media.js';
import {MediaImports} from '../media-imports.js';
import {AppError} from '../errors.js';
import {proseReferences} from '../web/prose-model.js';
import {WorkspaceFonts} from '../workspace-fonts.js';

const json=value=>JSON.stringify(value);
const dependency=()=>{throw new AppError('COLLABORATION_DEPENDENCY');};

// Only selected record owners seed this traversal. Following a provenance link
// never silently expands access. Immutable datasets retain their native pages,
// sequences and exact values; no recalculation or text conversion is involved.
export class ResearchTransfer{
 constructor(workspace,recordIds,notebookIds,emit){this.workspace=workspace;this.materials=new ResearchMaterials(workspace);this.recordIds=recordIds;this.notebookIds=new Set(notebookIds);this.emit=emit;this.media=new MediaStore(workspace);this.mediaIds=new Set();this.sequenceNodes=new Set();this.fonts=new Map();}
 metadata(name,value){return this.emit({kind:'metadata',name,content:json(value)});}
 async original(name,content){await content.verify();return this.emit({kind:'original',name,content});}
 async record(record,enqueue){
  if(!this.recordIds.has(record.id)||!this.notebookIds.has(record.notebookId))dependency();
  const workspaceId=await this.workspace.catalogue(async store=>(await store.snapshot()).metadata.id);
  await this.metadata('.observanda/materials/records/'+record.id+'/'+recordRevision(record)+'.json',record);
  for(const ref of [...attemptReferences(record.attempt),...resultReferences(record.results),...figureReferences(record.figures)]){
   if(ref.workspaceId&&workspaceId!==ref.workspaceId)dependency();await enqueue(ref);
  }
  for(const relation of record.relations??[])if(relation.target.kind==='record'&&relation.target.revision){
   if(relation.target.workspaceId!==workspaceId)dependency();
   await enqueue({kind:'record',id:relation.target.id,revision:relation.target.revision});
  }
  for(const attachment of record.attachments)await this.asset(attachment.id);
  for(const prose of [record.body,...record.sections.map(s=>s.body)])for(const ref of proseReferences(prose))if(ref.kind==='record'&&ref.revision){
   if(ref.workspaceId!==workspaceId)dependency();await enqueue({kind:'record',id:ref.id,revision:ref.revision});
  }
  for(const [id,font] of await new WorkspaceFonts(this.workspace).files(record)){
   if(font.restricted||!font.embed)throw new AppError('FONT_EMBED');
   if(!this.fonts.has(id)){const {bytes,...entry}=font;this.fonts.set(id,entry);await this.metadata('.observanda/fonts/'+id+'.json',{bytes:bytes.toString('base64')});}
  }
 }
 async asset(id){
  if(this.mediaIds.has(id))return;this.mediaIds.add(id);
  const {metadata,directory}=await this.media.metadata(id),display=await this.media.get(id,{streamed:true});
  await this.original(this.relative(display.bytes.file),display.bytes);
  if(metadata.storageId){
   const {session,content}=await new MediaImports(this.workspace).original(id);await this.original(this.relative(content.file),content);
   const {version,workspaceId,name,size,kind,createdAt,source}=session;
   await this.metadata('.observanda/media-imports/'+id+'.json',{version,id,workspaceId,name,size,kind,createdAt,source});await this.metadata('.observanda/media-assets/'+id+'.json',metadata);
  }else{
   const descriptor='.observanda/media-assets/'+id+'.json',indexed=await this.workspace.readMetadata(descriptor,4096);
   if(indexed!==null)await this.emit({kind:'metadata',name:descriptor,content:indexed});
   else await this.original('.observanda/media/'+id+'/asset.json',await this.jsonContent(path.join(directory,'asset.json')));
   await this.original('.observanda/media/'+id+'/original',await this.media.originalContent(id,{directory,metadata}));
  }
 }
 async jsonContent(file){const {describeContent}=await import('../file-content.js');return describeContent(this.workspace,file);}
 relative(file){return path.relative(this.workspace.root,file).split(path.sep).join('/');}
 async sequence(value){
  if(!value)return;this.materials.sequences.validate(value);const tree=this.materials.sequences.tree(),owner=this;
  async function visit(ref){
   if(!ref||owner.sequenceNodes.has(ref.hash))return;const node=await tree.node(ref);owner.sequenceNodes.add(ref.hash);await visit(node.left);await visit(node.right);
   const chunk=await owner.materials.sequences.read('chunks',node.revision);if(!chunk)throw new AppError('MATERIAL_MISSING');
   if(chunk.kind==='cells')for(const cell of chunk.items)if(cell.value?.parts)await owner.sequence(cell.value.parts);
   if(chunk.kind==='pages')for(const page of chunk.items){const rows=await owner.materials.json(owner.materials.metadataFile('tables/'+page.hash+'.json'));for(const row of rows)if(row.cellIndex)await owner.sequence(row.cellIndex);await owner.metadata('.observanda/materials/tables/'+page.hash+'.json',rows);}
   await owner.metadata('.observanda/materials/sequences/chunks/'+node.revision+'.json',chunk);await owner.metadata('.observanda/materials/sequences/nodes/'+ref.hash+'.json',node);
  }
  await visit(value.root);
 }
 async copy(currentRecords,heads){
  const materials=this.materials,owner=this;
  await withMaterialTraversal(async traversal=>{
   async function* seeds(){
    for await(const record of currentRecords)yield {kind:'record',id:record.id,revision:recordRevision(record)};
    for await(const head of heads)if(owner.recordIds.has(head.recordId)){
     if(!await materialHeadVisible(owner.workspace,head))dependency();
     // A portable packet contains published evidence, not its source owner's
     // private staging receipts. The canonical artifact document stays exact.
     const {stagedBatch,ownerTransfer,...published}=head;void stagedBatch;void ownerTransfer;
     await owner.metadata('.observanda/materials/objects/'+head.id+'/head.json',published);yield published;
    }
   }
   await traversal.walk(seeds(),async(ref,enqueue)=>{
    let doc;
    if(ref.kind==='record'){
     try{doc=await materials.read(ref);}catch(error){
      if(error.code!=='MATERIAL_MISSING')throw error;
      doc=await owner.workspace.catalogue(async store=>{
       const index=store.historyIndex(ref.id),head=await index.head();
       const found=await index.lookup(head,'view',ref.revision,{optional:true});
       if(found){const source=await store.historyItem(ref.id,found.item);return historicalBook(source.metadata,source.record).entries[0];}
       if(head.legacy)for await(const row of index.items(head)){const source=await store.historyItem(ref.id,row),record=historicalBook(source.metadata,source.record).entries[0];if(recordRevision(record)===ref.revision)return record;}
       throw new AppError('MATERIAL_MISSING');
      });
     }
     if(!owner.recordIds.has(ref.id)){
      if(!owner.notebookIds.has(doc.notebookId))dependency();
      const member=await owner.workspace.catalogue(async store=>store.member(await store.snapshot(),ref.id));
      if(member&&!owner.notebookIds.has(member.notebookId))dependency();
      // Exact links to deleted methods still belong to their selected book;
      // retaining that revision does not restore a current record membership.
      owner.recordIds.add(ref.id);
     }
     await owner.record(doc,enqueue);return;
    }
    doc=await materials.read(ref);if(!owner.recordIds.has(doc.recordId))dependency();
    if(doc.previous)await enqueue({...ref,revision:doc.previous});
    for await(const r of materials.references(doc.content))await enqueue(r);
    for await(const r of materials.references(doc.content,'outputs'))await enqueue(r);
    if(doc.content.acquisition)await enqueue(doc.content.acquisition);
    for(const slot of ['pageIndex','schemaIndex','inputsIndex','outputsIndex','aggregationMembersIndex','schemaInputsIndex','plotPointsIndex','plotMembersIndex'])await owner.sequence(doc.content[slot]);
    if(doc.content.comparison&&doc.content.summary?.version===2)for await(const part of materials.comparisons.index(doc.content.summary).metadata())await owner.metadata(part.name,part.value);
    if(doc.kind==='dataset'){
     for await(const column of materials.iterateDatasetColumns(doc))for(const r of schemaReferences(column))await enqueue(r);
     for(let i=0;i<materials.datasetPageCount(doc);i++){
      const info=[2,3].includes(doc.content.datasetFormat)?await materials.sequences.item(doc.content.pageIndex,i):doc.content.pages[i];
      const {rows}=await materials.retainedDatasetPage(doc,i,{metadataOnly:true});await owner.metadata('.observanda/materials/tables/'+info.hash+'.json',rows);
     }
    }
    await owner.metadata('.observanda/materials/objects/'+doc.id+'/'+ref.revision+'.json',doc);
    if(doc.content.measurement)for(const r of measurementReferences(doc.content.measurement))await enqueue(r);
    if(doc.content.method)for(const r of analysisMethodReferences(doc.content.method))await enqueue(r);
    if(doc.kind==='artifact'){const {content}=await materials.artifact(ref);await owner.original(owner.relative(content.file),content);}
   });
  });
  if(this.fonts.size)await this.metadata('.observanda/fonts/library.json',[...this.fonts.values()].sort((a,b)=>a.id.localeCompare(b.id)));
 }
}

// Incoming names are checked independently of the archive signature. Even a
// trusted collaborator cannot use a research packet to replace access keys,
// organization authority, publishing settings or arbitrary local paths.
const id='[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}',hash='[a-f0-9]{64}';
const metadata=new RegExp('^(?:\\.observanda/materials/(?:records/'+id+'/'+hash+'\\.json|objects/'+id+'/(?:'+hash+'|head)\\.json|sequences/(?:nodes|chunks|comparison-nodes|comparison-values|comparison-state)/'+hash+'\\.json|tables/'+hash+'\\.json)|\\.observanda/media-(?:imports|assets)/'+id+'\\.json)$');
const originals=new RegExp('^\\.observanda/(?:materials/originals/'+id+'/(?:original|'+id+'\\.original)|media/'+id+'/(?:asset\\.json|original|'+id+'\\.original|(?:'+id+'\\.)?public\\.(?:png|wav|mp4)))$');
const fonts=new RegExp('^\\.observanda/fonts/(?:library|custom-'+hash+')\\.json$');
export function validTransferPart(kind,name){return typeof name==='string'&&(kind==='metadata'?metadata.test(name)||fonts.test(name)||configurationPartName(name):kind==='original'?originals.test(name):kind==='record'?new RegExp('^'+id+'$').test(name):kind==='description'&&name==='selection');}
