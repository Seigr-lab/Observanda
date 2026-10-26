import {projectWebsiteAttachmentChoices} from './website-selection-admission.js';
import {RecordPublicationIndex,publicationReadingKey} from './record-publication-index.js';
import {readingKey} from './record-reading-index.js';
import {RetainedTableIndex} from './retained-table-index.js';
import {AppError} from './errors.js';
import {withScratch} from './scratch-work.js';
import {validPublicationSources} from './web/publication-sources-model.js';
import {validWebsiteSelection} from './web/website-selection.js';
import {validEditionSelection,editionRevisionKey,editionAvailabilityKey} from './web/publication-selection.js';
import {digest,serialize} from './storage-format.js';

export const WEBSITE_SOURCES_PATH=Object.freeze(['document','website','researchSources']);
const sourceReaders=new WeakMap(),selectionReaders=new WeakMap();
const invalid=()=>{throw new AppError('INVALID',[{field:'website sources'}]);};
const pathFor=(position,...tail)=>[...WEBSITE_SOURCES_PATH,String(position),...tail];
const kindPath={records:['selection','records'],editionRecords:['edition','records'],history:['edition','history'],availability:['edition','availability']};
const identity=(kind,value)=>kind==='history'?editionRevisionKey(value):kind==='availability'?editionAvailabilityKey(value):value.id;
export const sourceSelectionReader=selection=>selectionReaders.get(selection);
export const sourceEditionReader=source=>sourceReaders.get(source)?.edition;
export const sourceSelectionRevision=source=>sourceReaders.get(source)?.revision??digest(serialize(source));
export function preserveSourceSelection(before,after){const reader=sourceReaders.get(before);if(reader){sourceReaders.set(after,reader);selectionReaders.set(after.selection,reader.records);}return after;}
async function length(document,path){return await document.tree.select(document.root,path)?document.tree.arrayLength(document.root,path):0;}
async function names(document,path){
 const target=await document.tree.select(document.root,path);if(!target)return [];
 const node=target.inline?{type:'inline',value:target.value}:await document.tree.node(target.revision);
 if(node.type==='inline'){if(!node.value||typeof node.value!=='object'||Array.isArray(node.value))invalid();return Object.keys(node.value);}
 return document.tree.propertyNames(target.revision);
}
async function field(document,path,fallback){const value=await document.field(path);return value?.found===false||value?.value===undefined?fallback:value.value;}
export async function websiteSourceSummary(document){return {count:await length(document,WEBSITE_SOURCES_PATH),revision:await document.reference(WEBSITE_SOURCES_PATH)};}
export async function websiteSourceHeader(document,position,{signal}={}){
 signal?.throwIfAborted();const base=pathFor(position),workspaceId=await field(document,[...base,'workspaceId']),labBookId=await field(document,[...base,'labBookId']);
 const source={workspaceId,...(labBookId===undefined?{}:{labBookId}),projectIds:await field(document,[...base,'projectIds']),selection:{defaultShare:await field(document,[...base,'selection','defaultShare']),includeProjects:await field(document,[...base,'selection','includeProjects']),records:[]}};
 if(await document.tree.select(document.root,[...base,'edition']))source.edition={version:await field(document,[...base,'edition','version']),records:[]};
 const expected=['workspaceId','projectIds','selection',...(labBookId===undefined?[]:['labBookId']),...(source.edition?['edition']:[])];
 if((await names(document,base)).sort().join()!==expected.sort().join()||(await names(document,[...base,'selection'])).sort().join()!=='defaultShare,includeProjects,records')invalid();
 if(source.edition){const fields=await names(document,[...base,'edition']);if(fields.some(key=>!['version','records','history','availability'].includes(key))||!fields.includes('records'))invalid();}
 if(!validPublicationSources([source]))invalid();return source;
}
export async function websiteSourcePosition(document,workspaceId,{signal}={}){
 const count=await length(document,WEBSITE_SOURCES_PATH);for(let position=0;position<count;position++){signal?.throwIfAborted();if(await field(document,pathFor(position,'workspaceId'))===workspaceId)return position;}return null;
}
// The website remains the sole durable owner. This temporary, encrypted index
// is rebuilt from its authenticated value tree and dies with the awaited read.
// Neither editor replies nor prepared-edition commands carry its growing arrays.
export function withWebsiteSourceSelections(document,operation,{signal}={}){
 return withScratch(async proof=>{
  const summary=await websiteSourceSummary(document);let batch=[];
  const flush=async()=>{if(batch.length){await proof.putMany(batch);batch=[];}};
  for(let position=0;position<summary.count;position++){
   const source=await websiteSourceHeader(document,position,{signal}),prefix=source.workspaceId+'/',counts={};
   if(!await proof.add('owner:'+source.workspaceId,position))invalid();
   for(const [kind,tail] of Object.entries(kindPath)){
    counts[kind]=0;const path=pathFor(position,...tail);if(!await document.tree.select(document.root,path))continue;
    for await(const item of document.items(path,{signal})){
     signal?.throwIfAborted();const value=await document.tree.read(item.value);
     const valid=kind==='records'?validWebsiteSelection({defaultShare:false,includeProjects:[],records:[value]}):validEditionSelection({version:1,records:kind==='editionRecords'?[value]:[],...(kind==='history'?{history:[value]}:kind==='availability'?{availability:[value]}:{})});
     if(!valid)invalid();const key=identity(kind,value);if(!await proof.add('unique:'+prefix+kind+':'+key))invalid();
     if(kind==='history'&&!value.include)continue;
     if(kind==='editionRecords'||kind==='history')await proof.add(prefix+'required-record:'+value.id);
     batch.push([prefix+kind+':'+key,value]);counts[kind]++;if(batch.length===32)await flush();
    }
   }
   await flush();await proof.put('header:'+source.workspaceId,{source,position,counts});
  }
  const sourceAt=async workspaceId=>{
   const row=await proof.get('header:'+workspaceId);if(!row)return null;const source=row.source,prefix=workspaceId+'/';
   const readKind=kind=>({count:()=>row.counts[kind],get:id=>proof.get(prefix+kind+':'+id),async *items({backward=false}={}){
    const path=pathFor(row.position,...kindPath[kind]);if(!await document.tree.select(document.root,path))return;
    const count=await document.tree.arrayLength(document.root,path);for(let at=backward?count-1:0;backward?at>=0:at<count;at+=backward?-1:1){signal?.throwIfAborted();const value=(await document.field([...path,String(at)],{signal})).value;if(kind!=='history'||value.include)yield value;}
   }});
   const records={...readKind('records'),required:id=>proof.has(prefix+'required-record:'+id)},orders=new WeakMap();
   records.order=async(snapshot,rows,{order='position',keyOf=row=>String(row.position).padStart(16,'0')}={})=>{
    const blocks={async put(kind,value){const revision=digest(serialize(value));await proof.put(prefix+'order:'+kind+':'+revision,value);return revision;},async read(kind,revision){const value=await proof.get(prefix+'order:'+kind+':'+revision);if(!value||digest(serialize(value))!==revision)throw new AppError('CATALOGUE_DAMAGED');return value;}};
    const retained=orders.get(snapshot)??new Map();orders.set(snapshot,retained);let root=retained.get(order);
    if(root===undefined){
     const index=new RetainedTableIndex(blocks);root=null;let pending=0;
     for await(const row of rows()){
      signal?.throwIfAborted();if(!Number.isSafeInteger(row.position)||row.position<0)throw new AppError('CATALOGUE_DAMAGED');
      const key=keyOf(row);if(await index.find({root},key))throw new AppError('CATALOGUE_DAMAGED');
      await proof.put(prefix+'ordered-member:'+order+':'+row.id,row);root=await index.change(root,key,await blocks.put('member',row));if(++pending===32){await index.flush(root);pending=0;}
     }
     await index.flush(root);retained.set(order,root);
    }
    return {get:id=>proof.get(prefix+'ordered-member:'+order+':'+id),async *items({after=null,recordId=null,backward=false}={}){
     const index=new RetainedTableIndex(blocks),count=root?.count??0,point=after===null?null:typeof after==='number'?String(after).padStart(16,'0'):after,rank=point===null?0:await index.rank({root},point),exact=point!==null&&!!await index.find({root},point),start=point===null?(backward?count-1:0):backward?rank-1:rank+(exact?1:0);
     for(let position=start;backward?position>=0:position<count;position+=backward?-1:1){
      signal?.throwIfAborted();const entry=await index.entryAt({root},position),row=await blocks.read('member',entry.revision);
      if(entry.id!==keyOf(row))throw new AppError('CATALOGUE_DAMAGED');if(recordId===null||row.id===recordId)yield row;
     }
    }};
   };
   const editionKinds={records:readKind('editionRecords'),history:readKind('history'),availability:readKind('availability')};
   const edition={count:kind=>editionKinds[kind].count(),get:(kind,id)=>editionKinds[kind].get(id),items:(kind,options)=>editionKinds[kind].items(options),mapped(kind,keyOf){let ready=false;const scope=prefix+'mapped:'+kind+':';const prepare=async()=>{if(ready)return;for await(const value of editionKinds[kind].items())await proof.put(scope+keyOf(value),value);ready=true;};return {size:editionKinds[kind].count(),async get(id){await prepare();return proof.get(scope+id);},async has(id){await prepare();return !!await proof.get(scope+id);},async *entries(options){for await(const value of editionKinds[kind].items(options))yield [keyOf(value),value];},async *keys(options){for await(const value of editionKinds[kind].items(options))yield keyOf(value);}};}};
   const reader={records,edition,revision:digest(serialize({source:await document.reference(pathFor(row.position),{signal}),workspaceId}))};sourceReaders.set(source,reader);selectionReaders.set(source.selection,records);return source;
  };
  return operation({...summary,get:sourceAt,async *items(){for(let position=0;position<summary.count;position++){signal?.throwIfAborted();yield await sourceAt(await field(document,pathFor(position,'workspaceId')));}}});
 },{signal});
}

export async function sourceRecordChoice(selection,id){return sourceSelectionReader(selection)?.get(id)??selection.records.find(value=>value.id===id);}
export async function sourceRecordIncluded(selection,record,projectId){
 if(record.share!==true)return false;const choice=await sourceRecordChoice(selection,record.id);return choice?.share??(selection.includeProjects.includes(projectId)?true:selection.defaultShare??record.share);
}
export async function* sourceRecordChoices(selection){const reader=sourceSelectionReader(selection);if(reader)yield* reader.items();else yield* selection.records;}

// An excluded attachment remains excluded if its source is later restored.
// Its absent negative choice is not a request to publish unavailable material.
export function projectSourceAttachmentChoices(choices,available,savedChoices=[]){
 const present=new Set(available.map(value=>value.id));
 return projectWebsiteAttachmentChoices(choices.filter(value=>value.share!==false||present.has(value.id)),available,savedChoices);
}

export function sourceRecordOrder(selection,store,snapshot,{order='position',signal}={}){
 const reader=sourceSelectionReader(selection);if(!reader)throw new AppError('INVALID');
 const index=new RecordPublicationIndex(store),keyOf=row=>order==='publication'?publicationReadingKey(row,snapshot.metadata.id):readingKey(row,order);
 return reader.order(snapshot,async function*(){
  for await(const choice of reader.items()){
   signal?.throwIfAborted();const row=await store.member(snapshot,choice.id);if(!row){if(choice.share===false&&!await reader.required(choice.id))continue;throw new AppError('RECORD_CHANGED');}
   const [summary]=await Array.fromAsync(store.queryDocuments([row],snapshot.metadata,{signal,search:false,publication:true}));
   projectSourceAttachmentChoices(choice.attachments,summary.publication.attachments);
   if(choice.share===true){
    const member=row.position===undefined&&Array.isArray(snapshot.records)?{...row,position:snapshot.records.findIndex(value=>value.id===row.id)}:row;
    yield await index.describe(member,order!=='position');
   }
  }
 },{order,keyOf});
}
