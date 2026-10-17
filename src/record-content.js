// Read one immutable record window. The response is a reading projection, never
// an editable record or a substitute for the original in a workspace snapshot.
import {AppError} from './errors.js';
import {withStoredRecord} from './record-storage.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {searchRecordSections} from './record-section-search.js';
import {memberStructureRevision} from './record-member-collections.js';
import {writingValueRevision} from './record-section-commands.js';
import {withRecordDocument} from './record-document.js';
import {recordReadingHeader,validHeaderWindows} from './record-reading-header.js';
import {resultAnchorId} from './record-result-document.js';
import {materialRecordSummary} from './material-record-summary.js';

const natural=v=>Number.isSafeInteger(v)&&v>=0;
const damaged=()=>{throw new AppError('CATALOGUE_DAMAGED');};
export class RecordContent {
 constructor(workspace){this.workspace=workspace;}
 async read(command,{signal}={}){
  const required=['workspaceId','recordId'],optional=['snapshotId','offset','anchor','search','after','cursor','header','pagedHeader','windows','resultFigure'];
  if(!command||typeof command!=='object'||Array.isArray(command)||required.some(k=>!Object.hasOwn(command,k))||Object.keys(command).some(k=>![...required,...optional].includes(k))||!researchId(command.workspaceId)||!researchId(command.recordId)||command.snapshotId!==undefined&&!revisionId(command.snapshotId)||command.offset!==undefined&&!natural(command.offset)||command.after!==undefined&&!natural(command.after)||command.anchor!==undefined&&(typeof command.anchor!=='string'||! /^(?:(?:record-)?result-|record-(?:section|figure|table|equation|citation|block)-)?[a-f0-9-]{36}$/.test(command.anchor))||command.search!==undefined&&(typeof command.search!=='string'||command.search.length>160))throw new AppError('INVALID');
  signal?.throwIfAborted();if(!this.workspace)throw new AppError('MISSING');
  if(command.resultFigure!==undefined&&(!command.pagedHeader||!researchId(command.resultFigure)))throw new AppError('INVALID');
  if(command.pagedHeader!==undefined&&typeof command.pagedHeader!=='boolean'||command.windows!==undefined&&(!command.pagedHeader||!validHeaderWindows(command.windows)))throw new AppError('INVALID');
  if(command.cursor!==undefined&&(typeof command.cursor!=='string'||!command.cursor.length||command.cursor.length>4096||command.search===undefined&&!command.anchor)||command.header!==undefined&&typeof command.header!=='boolean'||command.anchor&&command.search!==undefined)throw new AppError('INVALID');
  return this.workspace.catalogue(async store=>{
   const currentId=await store.head(),current=await store.snapshot(currentId),etag=command.snapshotId??currentId,snapshot=command.snapshotId?await store.snapshot(etag):current;
   if(current.metadata.id!==command.workspaceId||snapshot.metadata.id!==command.workspaceId)throw new AppError('WORKSPACE_CHANGED');
   const row=await store.member(snapshot,command.recordId);if(!row)throw new AppError('MISSING');
   if(snapshot.metadata.formatVersion!==21)throw new AppError('FORMAT');
   return withStoredRecord(store,row.id,row.revision,async({value,blocks})=>{
    const tree=blocks?.tree(),root=value.root;
    const selected=async path=>{signal?.throwIfAborted();if(tree)return (await tree.selected(root,path)).value;let result=value;for(const part of path)result=result?.[part];return structuredClone(result);};
    const page=async(offset,limit=4)=>{signal?.throwIfAborted();return tree?tree.page(root,['sections'],{offset,limit}):{offset,total:value.sections.length,values:structuredClone(value.sections.slice(offset,offset+limit))};};
    const total=tree?await tree.arrayLength(root,['sections']):value.sections.length;
    let offset=Math.min(command.offset??0,Math.max(0,total-1)),found=null;
    if(command.search!==undefined||command.anchor&&!resultAnchorId(command.anchor)){
     const search=await searchRecordSections(store,command,{etag,total,selected,page,signal});
     if(search.nextCursor)return {workspaceId:command.workspaceId,recordId:row.id,etag,search};
     found=search.found;if(found!==null)offset=found;
    }
    // The fixed record header has its own owner. Section bodies are only read
    // for the requested window; no original-record reconstruction occurs here.
    const header=command.header===false||command.pagedHeader?null:{};
    if(header){
     const names=tree?await tree.propertyNames(root):Object.keys(value);
     for(const name of names)if(name!=='sections')Object.defineProperty(header,name,{value:await selected([name]),enumerable:true});
     if(header.id!==command.recordId||header.notebookId!==row.notebookId)damaged();
    }
    const sections=await page(offset);
    const paged=command.pagedHeader?await withRecordDocument(store,row.id,row.revision,document=>recordReadingHeader(store,row,document,sections.values,{windows:command.windows,anchor:command.anchor,resultFigure:command.resultFigure,signal})):{};
    signal?.throwIfAborted();
    const {revision}=await materialRecordSummary(store,row);
    return {workspaceId:command.workspaceId,recordId:row.id,etag,revision,storageRevision:row.revision,structureRevision:memberStructureRevision(row),writingRevisions:Object.fromEntries(sections.values.map(section=>[section.id,writingValueRevision(section)])),header,sections,found,...paged};
   });
  });
 }
}
