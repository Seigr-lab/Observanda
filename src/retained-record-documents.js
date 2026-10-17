import {assertRecordOwnerRevisionVisible} from './record-owner-read-visibility.js';
// Exact references pin an existing immutable original. They do not duplicate
// its body into a workspace-key metadata envelope or impose its JSON budget.
import {validMaterialReference} from './web/material-reference.js';
import {referenceNamespaceMatches} from './research-reference-namespace.js';
import {recordReferenceLocation} from './record-reference-location.js';
import {AppError} from './errors.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {recordRevision} from './research.js';
import {RecordDocument,withRecordDocument} from './record-document.js';
import {withRecordProjectionScratch} from './record-projection-scratch.js';
import {recordReadingHeader,validHeaderWindows} from './record-reading-header.js';
import {searchRecordSections} from './record-section-search.js';
import {catalogueFormat,requireRetainedRecordDocuments} from './catalogue-format.js';
import {RecordContent} from './record-content.js';
import {RecordValueTree} from './record-value-tree.js';
import {resultAnchorId} from './record-result-document.js';
const format='observanda-retained-record',fail=()=>{throw new AppError('MATERIAL_MISSING');};
const validRef=ref=>ref?.kind==='record'&&validMaterialReference(ref);
const file=ref=>'.observanda/materials/records/'+ref.id+'/'+ref.revision+'.json';
export const retainedRecordPointer=value=>value?.format===format;
export class RetainedRecordDocuments{
 constructor(workspace){this.workspace=workspace;}
 async pinLocked(id,expectedRevision){
  if(!researchId(id)||expectedRevision!==undefined&&!revisionId(expectedRevision))throw new AppError('MATERIAL_INVALID');
  return this.workspace.catalogue(async store=>{
   const snapshotId=await store.head(),snapshot=await store.snapshot(snapshotId),row=await store.member(snapshot,id);if(!row)throw new AppError('MATERIAL_INVALID');
   if(snapshot.metadata.formatVersion!==21)return null;
   const history=store.historyIndex(id),found=await history.lookup(await history.head(),'version',row.revision),view=await history.display(found.item);
   if(expectedRevision!==undefined&&view.revision!==expectedRevision)throw new AppError('RECORD_CHANGED');
   const ref={kind:'record',id,revision:view.revision,workspaceId:snapshot.metadata.id};
   const prior=await this.workspace.readMetadata(file(ref),16*1024*1024);
   if(prior!==null){await this.open(ref,()=>{}, {legacy:()=>{}});return ref;}
   await requireRetainedRecordDocuments(store.db);
   await this.workspace.writeMetadata(file(ref),JSON.stringify({format,version:1,id,revision:view.revision,storageRevision:row.revision,snapshotId})+'\n');return ref;
  });
 }
 async check(ref,{signal,raw=false}={}){return this.open(ref,()=>{}, {verify:true,signal,raw,legacy:()=>{}});}
 async value(ref,{raw=false}={}){return this.open(ref,document=>document.tree.read(document.root),{verify:true,raw,legacy:value=>value});}
 async summary(ref){return this.open(ref,async document=>({title:(await document.field(['title'])).value}),{legacy:value=>({title:value.title})});}
 async withDocument(ref,consume,options){return this.open(ref,consume,options);}
 async open(ref,consume,{verify=false,signal,legacy,history=false,raw:unpublished=false}={}){
  if(!validRef(ref))throw new AppError('MATERIAL_INVALID');signal?.throwIfAborted();
  return this.workspace.catalogue(async store=>{
   const current=await store.snapshot();if(!await referenceNamespaceMatches(store,ref))throw new AppError('WORKSPACE_CHANGED');
   if(!unpublished)await assertRecordOwnerRevisionVisible(store,ref.id,ref.revision);
   const raw=await this.workspace.readMetadata(file(ref),16*1024*1024);let value;
   if(raw===null&&history){
    let located;try{located=await recordReferenceLocation(store,ref.id,ref.revision,{raw:true});}catch(error){if(error.code==='NOT_FOUND')fail();throw error;}
    const {snapshot,row}=located;
    if(snapshot.metadata.id!==current.metadata.id||snapshot.metadata.formatVersion!==21)fail();
    return withRecordDocument(store,ref.id,row.revision,document=>consume(document,row,store));
   }
   if(raw===null)fail();try{value=JSON.parse(raw);}catch{fail();}
   const use=async(document,row)=>{
    if(verify){const encoding=await document.encoding({signal});if(encoding.contentRevision!==ref.revision||row.revision&&encoding.revision!==row.revision)fail();}
    return consume(document,row,store);
   };
   if(retainedRecordPointer(value)){
    if(Object.keys(value).sort().join()!=='format,id,revision,snapshotId,storageRevision,version'||value.version!==1||value.id!==ref.id||value.revision!==ref.revision||![value.snapshotId,value.storageRevision].every(revisionId)||await catalogueFormat(store.db)<8)fail();
    const snapshot=await store.recordSnapshot(value.snapshotId,ref.id),row=await store.member(snapshot,ref.id);
    if(snapshot.metadata.id!==current.metadata.id||snapshot.metadata.formatVersion!==21||row?.revision!==value.storageRevision)fail();
    const history=store.historyIndex(ref.id),found=await history.lookup(await history.head(),'version',value.storageRevision),view=await history.display(found.item);if(view.revision!==ref.revision)fail();
    return withRecordDocument(store,ref.id,row.revision,document=>use(document,row));
   }
   if(value?.id!==ref.id||recordRevision(value)!==ref.revision)fail();
   // Existing bounded envelopes have already been authenticated and hashed.
   // Checking or returning them needs no scratch decomposition/reassembly.
   if(legacy)return legacy(value);
   // A legacy reference may be outside saved history. Scratch decomposition
   // leaves that original untouched and writes no derived data into its backup.
   const missing={read:async()=>{throw new AppError('CATALOGUE_DAMAGED');},tree(){return new RecordValueTree(this);}};
   return withRecordProjectionScratch(new RecordDocument(missing,null),async scratch=>{
    const root=await scratch.tree.retain(value);return use(new RecordDocument(scratch.blocks,root),{id:value.id,notebookId:value.notebookId});
   },{signal});
  });
 }
 async read(command,{signal}={}){
  const {ref,offset=0,windows={},anchor,cursor,compare=false,currentSnapshotId,resultFigure}=command??{};
  if(!validRef(ref)||!Number.isSafeInteger(offset)||offset<0||!validHeaderWindows(windows)||resultFigure!==undefined&&!researchId(resultFigure)||typeof compare!=='boolean'||anchor!==undefined&&(typeof anchor!=='string'||! /^(?:(?:record-)?result-|record-(?:section|figure|table|equation|citation|block)-)?[a-f0-9-]{36}$/.test(anchor))||cursor!==undefined&&(typeof cursor!=='string'||!cursor.length||cursor.length>4096||!anchor)||currentSnapshotId!==undefined&&!revisionId(currentSnapshotId))throw new AppError('INVALID');
  return this.withDocument(ref,async(document,row,store)=>{
   const workspaceId=(await store.snapshot()).metadata.id,total=await document.tree.arrayLength(document.root,['sections']);let at=Math.min(offset,Math.max(0,total-1)),found=null;
   const resultAnchor=resultAnchorId(anchor),figureId=resultAnchor?undefined:resultFigure;
   if(anchor&&!resultAnchor){
    const search=await searchRecordSections(store,{workspaceId,recordId:ref.id,anchor,cursor},{etag:ref.revision,total,signal,selected:async path=>(await document.field(path,{signal})).value,page:(offset,limit)=>document.tree.page(document.root,['sections'],{offset,limit})});
    if(search.nextCursor)return {ref,search};found=search.found;if(found!==null)at=found;
   }
   const sections=await document.tree.page(document.root,['sections'],{offset:at,limit:4}),header=await recordReadingHeader(store,row,document,sections.values,{windows,anchor,resultFigure:figureId,signal});
   const previous={...header,sections,record:{...header.header,sections:sections.values}};
   const etag=currentSnapshotId??await store.head(),snapshot=await store.snapshot(etag);if(snapshot.metadata.id!==workspaceId)throw new AppError('WORKSPACE_CHANGED');
   const latest=compare?await store.member(snapshot,ref.id):null;
   const requestedOffset=anchor&&!resultAnchor?at:offset,current=latest?await new RecordContent(this.workspace).read({workspaceId,recordId:ref.id,snapshotId:etag,offset:requestedOffset,pagedHeader:true,windows,...(resultAnchor?{anchor}:{}),...(figureId?{resultFigure:figureId}:{})},{signal}):null;
   signal?.throwIfAborted();return {ref,previous,current:current?{...current,record:{...current.header,sections:current.sections.values}}:null,currentSnapshotId:etag,offset:requestedOffset,found};
  },{signal,history:true});
 }
}
