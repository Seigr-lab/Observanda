import {AppError} from './errors.js';
import {ResearchMaterials} from './research-materials.js';
import {RetainedRecordDocuments} from './retained-record-documents.js';
import {materialRecordSummary} from './material-record-summary.js';
import {recordRevision} from './research.js';
import {validMaterialReference,materialReference} from './web/material-reference.js';
import {researchId} from './web/research-reference.js';

// This capability reads exact retained inputs. The result owner's materials
// remain the only writer; source discovery indexes and record pins are untouched.
export function createComparisonInputReader(localMaterials,{workspaceId,access,signal}={}){
 if(!researchId(workspaceId)||access&&['use','verify','close'].some(key=>typeof access[key]!=='function'))throw new AppError('INVALID');
 let closed=false,tail=Promise.resolve();const documents=new WeakMap();
 const check=()=>{signal?.throwIfAborted();if(closed)throw new AppError('WORKSPACE_CHANGED');};
 const qualify=(reference,namespace=workspaceId)=>{
  if(!validMaterialReference(reference)||!researchId(namespace))throw new AppError('MATERIAL_INVALID');
  return materialReference({...reference,workspaceId:reference.workspaceId??namespace});
 };
 // One authorized source context at a time, including paired expected-value
 // iterators. A page returns before its rows can enter a result transaction.
 const serial=operation=>{const task=tail.then(async()=>{check();return operation();});tail=task.catch(()=>{});return task;};
 const use=(reference,consume)=>serial(async()=>{
  const requested=qualify(reference);await access?.verify();check();
  const read=async(storage,canonical)=>{
   if(!validMaterialReference(canonical)||!researchId(canonical.workspaceId)||['kind','id','revision'].some(key=>canonical[key]!==requested[key]))throw new AppError('WORKSPACE_CHANGED');
   check();const materials=storage===localMaterials.workspace?localMaterials:new ResearchMaterials(storage);
   await materials.assertReferenceWorkspace(canonical);const result=await consume(materials,canonical);check();return result;
  };
  const result=access?await access.use(requested,read):await read(localMaterials.workspace,requested);
  await access?.verify();check();return result;
 });
 const source=doc=>{check();const ref=documents.get(doc);if(!ref||doc.kind!=='dataset')throw new AppError('MATERIAL_INVALID');return ref;};
 const reader={
  qualify,
  reference(doc){check();const reference=documents.get(doc);if(!reference)throw new AppError('MATERIAL_INVALID');return materialReference(reference);},
  async read(reference){return use(reference,async(materials,canonical)=>{
   let doc;
   if(canonical.kind==='record'&&await materials.workspace.storageKind()==='catalogue'){
    doc=await new RetainedRecordDocuments(materials.workspace).open(canonical,async document=>({kind:'record',id:canonical.id,revision:canonical.revision,title:(await document.field(['title'])).value}),{history:true,signal,legacy:value=>({kind:'record',id:canonical.id,revision:canonical.revision,title:value.title})});
   }else doc=await materials.read(canonical);
   documents.set(doc,canonical);return doc;
  });},
  datasetPageCount(doc){source(doc);return localMaterials.datasetPageCount(doc);},
  datasetColumns(doc){return use(source(doc),materials=>materials.datasetColumns(doc));},
  datasetColumn(doc,index){return use(source(doc),materials=>materials.datasetColumn(doc,index));},
  async *iterateDatasetColumns(doc){for(let offset=0;;){const page=await use(source(doc),materials=>materials.retainedSchemaPage(doc,{offset,limit:64}));yield* page.items;if(page.next===null)return;offset=page.next;}},
  retainedDatasetPage(doc,page,options){return use(source(doc),materials=>materials.retainedDatasetPage(doc,page,options));},
  async *iterateDataset(reference,options){
   if(reference?.kind!=='dataset')throw new AppError('MATERIAL_INVALID');
   const doc=await reader.read(reference);let count=0;
   for(let page=0;page<reader.datasetPageCount(doc);page++)for(const row of (await reader.retainedDatasetPage(doc,page,options)).rows){check();count++;yield row;}
   if(count!==doc.content.rowCount)throw new AppError('MATERIAL_MISSING');
  },
  current(reference,{recordHead}={}){return use(reference,async(materials,canonical)=>{
   let revision;
   if(canonical.kind!=='record'){
    const head=await materials.current(canonical.id);if(head&&head.kind!==canonical.kind)throw new AppError('MATERIAL_MISSING');revision=head?.revision??null;
   }else if(recordHead&&canonical.workspaceId===workspaceId)revision=await recordHead(canonical.id);
   else if(await materials.workspace.storageKind()==='catalogue')revision=await materials.workspace.catalogue(async store=>(await materialRecordSummary(store,await store.member(await store.snapshot(),canonical.id)))?.revision??null);
   else try{revision=recordRevision((await materials.owner(canonical.id)).entries.find(record=>record.id===canonical.id));}catch(error){if(error.code!=='MATERIAL_INVALID')throw error;revision=null;}
   return {revision,workspaceId:canonical.workspaceId,local:canonical.workspaceId===workspaceId};
  });},
  async head(reference,options){return (await reader.current(reference,options)).revision;},
  async *inputs(reference){
   const retained=await use(reference,async(materials,canonical)=>{
    await materials.assertReferenceWorkspace(canonical);
    const set=await materials.index.inputSet(canonical),qualify=async items=>{const result=[];for(const ref of items)result.push(await materials.referenceAddress(ref));return result;};
    return {reference:canonical,set:{...set,...(set.provenanceInputs?{provenanceInputs:await qualify(set.provenanceInputs)}:{}),...(!set.inputsIndex?{inputs:await qualify(set.inputs)}:{})}};
   });
   const {reference:canonical,set}=retained,namespace=canonical.workspaceId;
   const nested=ref=>{if(!validMaterialReference(ref))throw new AppError('MATERIAL_MISSING');return namespace===workspaceId?materialReference(ref):qualify(ref,namespace);};
   for(const ref of set.provenanceInputs??[]){check();yield nested(ref);}
   if(!set.inputsIndex){for(const ref of set.inputs){check();yield nested(ref);}return;}
   let offset=0;
   for(;;){
    const page=await use(canonical,async materials=>{const page=await materials.sequences.page(set.inputsIndex,{offset,limit:32}),items=[];for(const ref of page.items)items.push(await materials.referenceAddress(ref));return {...page,items};});
    for(const ref of page.items){check();yield nested(ref);}
    if(page.next===null)return;offset=page.next;
   }
  },
  verify:()=>serial(async()=>{await access?.verify();check();}),
  async close(){if(closed)return;closed=true;await tail;await access?.close();}
 };
 return reader;
}
