import {createHash} from 'node:crypto';
import {AppError} from './errors.js';
import {exact,object} from './modules/validation.js';
import {datasetExchangeSelection} from './dataset-exchange-table.js';
import {exchangeSequenceKind} from './dataset-exchange-metadata.js';
import {exchangeLineFrames} from './dataset-exchange-lines.js';
import {DATASET_TEXT_CHARS} from './dataset-cell-storage.js';
import {DATASET_LIMITS} from './dataset-reader.js';
import {validMaterialReference} from './web/material-reference.js';
import {revisionId} from './web/revision-model.js';
import {validDomainDefinition} from './web/measurement-domain-model.js';

const invalid=()=>{throw new AppError('MATERIAL_INVALID');};
const count=value=>Number.isSafeInteger(value)&&value>=0;
const pinned=ref=>validMaterialReference(ref)&&exact(ref,['kind','id','revision','workspaceId']);
const kinds=new Set(['string','number','boolean','object','array','absent','null']);
function allowed(frame,mandatory,optional=[]){
 return mandatory.every(k=>Object.hasOwn(frame,k))&&Object.keys(frame).every(k=>mandatory.includes(k)||optional.includes(k));
}
function columnCursor(ranges){
 let range=0,index=ranges[0].offset;
 return {take(actual){
  if(range===ranges.length||actual!==index)invalid();
  if(++index===ranges[range].offset+ranges[range].count){range++;index=ranges[range]?.offset;}
 },get complete(){return range===ranges.length;}};
}

// Each attachment immediately follows its parent frame, including attachments
// within an item. Consume the series with an ancestry stack, never a list of
// all of the sequence entries.
function attachments(){
 const stack=[];
 function next(){
  while(stack.length){
   const state=stack.at(-1);
   if(state.item<state.definitions[state.sequence].count)return state;
   state.item=0;
   if(++state.sequence===state.definitions.length)stack.pop();
  }
 }
 return {accept(frame){
  const state=next();
  if(!!state!==(frame.type==='sequence-item'))invalid();
  if(state){
   if(!allowed(frame,['type','sequence','index','value'],['sequences'])||frame.sequence!==state.sequence||frame.index!==state.item++)invalid();
  }
  if(!Object.hasOwn(frame,'sequences'))return !!state;
  if(!Array.isArray(frame.sequences)||!frame.sequences.length||frame.sequences.length>DATASET_LIMITS.keys||stack.length>=DATASET_LIMITS.depth)invalid();
  const used=new Set();
  for(const descriptor of frame.sequences){
   if(!exact(descriptor,['path','kind','count'])||!exchangeSequenceKind(descriptor.kind)||!count(descriptor.count)||!Array.isArray(descriptor.path)||!descriptor.path.length||descriptor.path.length>DATASET_LIMITS.depth)invalid();
   const key=JSON.stringify(descriptor.path);
   if(used.has(key)||descriptor.path[0]==='sequences')invalid();
   used.add(key);
   let value=frame;
   for(const field of descriptor.path){
    if((Array.isArray(value)?!count(field):!object(value)||typeof field!=='string')||!Object.hasOwn(value,field))invalid();
    value=value[field];
   }
   if(value!==null)invalid();
  }
  stack.push({definitions:frame.sequences.map(({count})=>({count})),sequence:0,item:0});
  return !!state;
 },finish(){if(next())invalid();}};
}
function validDomain(domain){
 return domain===null||object(domain)&&allowed(domain,['version','definition','complete','identity'],['count'])&&[1,2,3,4,5].includes(domain.version)&&validDomainDefinition(domain.definition)&&typeof domain.complete==='boolean'&&(domain.identity===null?!domain.complete:revisionId(domain.identity))&&(domain.count===undefined||count(domain.count));
}

export async function* validatedExchangeFrames(chunks,{signal}={}){
 const nested=attachments();
 let header,selection,schema,row,cell,previous=-1,interpreted=false,rows=0;
 function finishCell(){
  if(!cell)return;
  if(cell.seen!==cell.parts.characters||cell.hash.digest('hex')!==cell.parts.sha256)invalid();
  cell=null;
 }
 function finishRow(){
  if(row&&(!row.columns.complete||row.members!==row.memberCount))invalid();
  row=null;
 }
 for await(const frame of exchangeLineFrames(chunks,{signal})){
  if(frame.type==='complete'){
   nested.finish();finishCell();finishRow();
   if(!interpreted||!schema.complete||selection.includeExcluded&&rows!==selection.count)invalid();
   yield frame;continue;
  }
  if(nested.accept(frame)){yield frame;continue;}
  if(frame.type!=='text')finishCell();
  if(!header){
   if(!exact(frame,['type','format','version','ref','title','selection','sourceRows','sourceColumns'])||frame.type!=='dataset'||frame.format!=='observanda-dataset-exchange'||frame.version!==1||!pinned(frame.ref)||frame.ref.kind!=='dataset'||typeof frame.title!=='string'||!frame.title.trim()||frame.title.length>300||!count(frame.sourceRows)||!count(frame.sourceColumns)||!frame.sourceColumns)invalid();
   header=frame;
   selection=datasetExchangeSelection({kind:'dataset',content:{rowCount:frame.sourceRows,schemaIndex:{count:frame.sourceColumns}}},frame.selection);
   if(!Array.isArray(frame.selection.columns)||frame.selection.count===null)invalid();
   schema=columnCursor(selection.columns);
  }else if(!interpreted){
   if(frame.type!=='interpretation'||!object(frame.value)||!allowed(frame,['type','value'],['sequences']))invalid();
   interpreted=true;
  }else if(frame.type==='source'){
   if(rows||!pinned(frame.ref)||!exact(frame,['type','ref']))invalid();
  }else if(frame.type==='column'){
   if(rows||!object(frame.column)||!allowed(frame,['type','index','column'],['sequences']))invalid();
   schema.take(frame.index);
  }else if(frame.type==='row'){
   finishRow();
   if(!schema.complete||!allowed(frame,['type','index','metadata','memberCount'],['sequences'])||!count(frame.memberCount)||!count(frame.index)||frame.index<=previous||frame.index<selection.offset||frame.index>=selection.offset+selection.count||selection.includeExcluded&&frame.index!==selection.offset+rows)invalid();
   if(!object(frame.metadata)||typeof frame.metadata.id!=='string'||!frame.metadata.id||!Object.hasOwn(frame.metadata,'excluded')||(frame.metadata.excluded!==null&&(typeof frame.metadata.excluded!=='string'||!selection.includeExcluded)))invalid();
   for(const field of ['line','order'])if(frame.metadata[field]!==undefined&&(!count(frame.metadata[field])||frame.metadata[field]<1))invalid();
   previous=frame.index;rows++;
   row={columns:columnCursor(selection.columns),members:0,memberCount:frame.memberCount,cellsStarted:false};
  }else if(frame.type==='member'){
   if(!row||row.cellsStarted||row.members>=row.memberCount||!exact(frame,['type','index','page','row','id'])||frame.index!==row.members++||!count(frame.page)||!count(frame.row)||typeof frame.id!=='string'||!frame.id)invalid();
  }else if(frame.type==='cell'){
   if(!row||row.members!==row.memberCount||!object(frame.properties)||!kinds.has(frame.properties.kind)||!validDomain(frame.domain)||Object.hasOwn(frame,'text')===Object.hasOwn(frame,'parts')||!allowed(frame,['type','index','properties','domain'],['text','parts','sequences']))invalid();
   row.columns.take(frame.index);row.cellsStarted=true;
   if(['absent','null'].includes(frame.properties.kind)&&(frame.text!==''||frame.domain!==null))invalid();
   if(Object.hasOwn(frame,'parts')){
    if(!exact(frame.parts,['characters','sha256'])||!count(frame.parts.characters)||!frame.parts.characters||!revisionId(frame.parts.sha256))invalid();
    cell={parts:frame.parts,seen:0,hash:createHash('sha256')};
   }else if(typeof frame.text!=='string')invalid();
  }else if(frame.type==='text'){
   if(!cell||!exact(frame,['type','text'])||typeof frame.text!=='string'||!frame.text.length||frame.text.length>DATASET_TEXT_CHARS+1||frame.text.length>cell.parts.characters-cell.seen)invalid();
   cell.hash.update(Buffer.from(frame.text,'utf16le'));cell.seen+=frame.text.length;
  }else invalid();
  yield frame;
 }
}

export async function readDatasetExchange(chunks,stage,options){
 let receipt;
 for await(const frame of validatedExchangeFrames(chunks,options)){
  if(frame.type==='complete')receipt=frame;else await stage(frame);
 }
 return receipt;
}
