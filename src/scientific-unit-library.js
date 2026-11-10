import {AppError} from './errors.js';
import {exact,text} from './modules/validation.js';
import {researchId} from './web/research-reference.js';
import {revisionId,revisionText} from './web/revision-model.js';
import {materialReference,validMaterialReference} from './web/material-reference.js';
import {validateUnitDefinition} from './web/measurement-unit-model.js';
import {resolveScalarDefinitions} from './measurement-scalar-storage.js';
import {catalogueUnit} from './web/measurement-unit-catalogue.js';
import {validQuantityChoice} from './quantity-favorites.js';

const tool='Observanda unit definition';
const directory='.observanda/materials/index/unit-definitions';
const invalid=()=>{throw new AppError('MATERIAL_INVALID');};
const damaged=()=>{throw new AppError('MATERIAL_MISSING');};
const label=(value,limit)=>text(value,limit,true)&&value.trim()===value;
const normalized=value=>value.normalize('NFKC').toLowerCase();
const pointer=doc=>({recordId:doc.recordId,id:doc.id});
export const isScientificUnit=doc=>doc?.kind==='analysis'&&doc.content?.tool===tool;

function validateEntry(value){
 if(!exact(value,['quantity','symbol','aliases','definition'])||!label(value.quantity,120)||!label(value.symbol,100)||!Array.isArray(value.aliases)||value.aliases.length>32||value.aliases.some(alias=>!label(alias,100))||new Set(value.aliases.map(normalized)).size!==value.aliases.length)invalid();
 if(value.definition?.source!==undefined||typeof value.definition?.scale?.spelling!=='string'||typeof value.definition?.offset?.spelling!=='string')invalid();
 try{validateUnitDefinition(value.definition);}catch{invalid();}
 return value;
}
function entryOf(doc){
 if(!isScientificUnit(doc)||!exact(doc.content,['tool','version','unit','inputs'])||doc.content.version!==1||!Array.isArray(doc.content.inputs)||doc.content.inputs.length)damaged();
 try{return validateEntry(doc.content.unit);}catch{damaged();}
}

// Index the stable material identity. Book moves, revisions and display
// labels all resolve through the ordinary material visibility boundary.
export async function indexScientificUnit(workspace,doc){
 if(!isScientificUnit(doc))return;
 entryOf(doc);
 const file=directory+'/'+doc.id+'.json',line=JSON.stringify(pointer(doc));
 const previous=await workspace.readMetadata(file,2048);
 if(previous===null)await workspace.writeMetadata(file,line);
 else if(previous!==line)damaged();
}

async function selectedUnit(materials,ref,namespace){
 if(!validMaterialReference(ref)||ref.kind!=='analysis')invalid();
 await materials.assertReferenceWorkspace(ref);
 const line=await materials.workspace.readMetadata(directory+'/'+ref.id+'.json',2048);
 if(line===null)throw new AppError('NOT_FOUND');
 let row;try{row=JSON.parse(line);}catch{damaged();}
 if(!exact(row,['id','recordId'])||row.id!==ref.id||!researchId(row.recordId))damaged();
 const head=await materials.current(row.id);
 if(!head)throw new AppError('NOT_FOUND');
 if(head.recordId!==row.recordId||head.kind!=='analysis')damaged();
 await materials.assertOwner(row.recordId);
 const doc=await materials.read(ref);
 if(doc.recordId!==row.recordId)damaged();
 return {title:doc.title,recordId:row.recordId,ref:materialReference({...ref,workspaceId:ref.workspaceId??namespace}),unit:entryOf(doc)};
}

export async function scientificUnitRequest(materials,operation,data,{signal,check=async()=>{},quantityFavorites}={}){
 const workspace=materials.workspace;
 const guard=async()=>{signal?.throwIfAborted();await check();};
 if(operation==='unit-definition-save'){
  if(!exact(data,['recordId','id','expectedRevision','title','unit'])||!researchId(data.recordId)||!researchId(data.id)||data.expectedRevision!==null&&!revisionId(data.expectedRevision)||!label(data.title,300))invalid();
  const unit=validateEntry(data.unit);
  return workspace.withLock(async()=>{
   await guard();await materials.assertOwner(data.recordId,{write:true});
   if(data.expectedRevision!==null){
    const previous=await materials.read({kind:'analysis',id:data.id,revision:data.expectedRevision});
    if(!isScientificUnit(previous)||previous.recordId!==data.recordId)invalid();
   }
   return {ref:await materials.commit({kind:'analysis',id:data.id,recordId:data.recordId,expectedRevision:data.expectedRevision,title:data.title,content:{tool,version:1,unit,inputs:[]}})};
  });
 }
 return workspace.catalogue(async()=>{
  await guard();
  const namespace=(await workspace.outline()).metadata.id;
  if(operation==='unit-definition-read'){
   if(!exact(data,['ref'])||!validMaterialReference(data.ref)||data.ref.kind!=='analysis')invalid();
   return selectedUnit(materials,data.ref,namespace);
  }
  if(operation==='unit-favorites-list'){
   if(!quantityFavorites||!exact(data,['after'])||data.after!==null&&!revisionId(data.after))invalid();
   const page=await quantityFavorites.list(namespace,data.after),items=[];
   for(const {key,choice} of page.items){
    await guard();
    if(choice.catalogue){if(catalogueUnit(choice.id,choice.revision))items.push({key,standard:choice});else items.push({key,unavailable:true});continue;}
    try{const saved=await selectedUnit(materials,choice,namespace);items.push({key,ref:saved.ref,title:saved.title,quantity:saved.unit.quantity,symbol:saved.unit.symbol});}
    catch(error){if(!['NOT_FOUND','ACCESS_DENIED','ACCESS_LOCKED'].includes(error.code))throw error;await guard();items.push({key,unavailable:true});}
   }
   return {items,next:page.next};
  }
  if(operation==='unit-favorite-set'){
   if(!quantityFavorites)invalid();
   if(exact(data,['remove'])&&revisionId(data.remove)){await guard();return quantityFavorites.remove(namespace,data.remove);}
   if(!exact(data,['choice'])||!validQuantityChoice(data.choice,namespace))invalid();
   if(data.choice.catalogue){if(!catalogueUnit(data.choice.id,data.choice.revision))invalid();}
   else await selectedUnit(materials,data.choice,namespace);
   await guard();
   return quantityFavorites.add(namespace,data.choice);
  }
  if(operation!=='unit-definition-list'||!exact(data,['query','after'])||!text(data.query,200)||data.after!==null&&!researchId(data.after))invalid();
  const query=normalized(data.query.trim()),items=[];
  const page=await workspace.metadataPage(directory,{after:data.after?data.after+'.json':null,limit:32});
  for(const {name,text:raw} of page.items){
   await guard();let record;
   try{record=JSON.parse(raw);}catch{damaged();}
   if(!exact(record,['id','recordId'])||!researchId(record.recordId)||!researchId(record.id)||name!==record.id+'.json')damaged();
   const head=await materials.current(record.id);
   if(!head)continue;
   if(head.recordId!==record.recordId||head.kind!=='analysis')damaged();
   await materials.assertOwner(record.recordId);
   const ref=materialReference({...head,workspaceId:namespace}),doc=await materials.read(ref),unit=entryOf(doc);
   if(!query||[doc.title,unit.symbol,unit.quantity,...unit.aliases].some(item=>normalized(item).includes(query)))items.push({ref,recordId:record.recordId,title:doc.title,symbol:unit.symbol,quantity:unit.quantity,kind:unit.definition.kind});
  }
  return {items,next:page.next?page.next.slice(0,-5):null};
 });
}

export async function verifyScientificUnitSource(materials,quantity,{signal,cache}={}){
 const ref=quantity?.unitSource;
 if(!ref)return;
 signal?.throwIfAborted();
 const key=ref.workspaceId+':'+ref.id+':'+ref.revision;
 let expected=cache?.get(key);
 if(expected===undefined){
  const {unit}=await selectedUnit(materials,ref,ref.workspaceId);
  expected=revisionText(unit.definition);
  if(cache){if(cache.size>=16)cache.delete(cache.keys().next().value);cache.set(key,expected);}
 }
 const declared=quantity.unitDefinition;
 const resolved=declared?.version===2?await resolveScalarDefinitions(materials,declared,{signal}):declared;
 if(revisionText(resolved)!==expected)invalid();
}
