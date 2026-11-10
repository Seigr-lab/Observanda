import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {MaterialSequence} from './material-sequence.js';
import {withScratch} from './scratch-work.js';
import {datasetMapping} from './dataset-reader.js';
import {readPagedDataset} from './dataset-paged-reader.js';
import {compareProfileColumns,compileProfileColumns} from './dataset-profile-matching.js';
import {profileExpectedFields} from './dataset-interpretation-profile.js';
import {interpretDatasetCell} from './dataset-cell-interpretation.js';
import {defaultColumn} from './web/dataset-schema.js';
import {schemaReferences} from './web/measurement-model.js';
import {materialReference} from './web/material-reference.js';
import {revisionText} from './web/revision-model.js';

const invalid=()=>{throw new AppError('MATERIAL_INVALID');};
const blocking=new Set(['missing-required','ambiguous-rule','duplicate-source','multiple-sources']);
const valueErrors=new Set(['MATERIAL_INVALID','MATERIAL_DATASET_LIMIT','MEASUREMENT_DOMAIN_INVALID','MEASUREMENT_SEQUENCE_INPUT','MEASUREMENT_TOPOLOGY_INPUT','DATASET_CALCULATION_RESOURCE']);
const direct=operation=>operation();
export const profileReviewReceipt=(profile,artifact,signature)=>digest(revisionText({version:1,profile,artifact:materialReference(artifact),signature}));

// A failed or cancelled review must never write a native cell, derivative or
// fresh dataset revision. Existing references still read through their owner.
export function scratchInterpretations(materials,work){
 class ReviewSequences extends MaterialSequence{
  async read(kind,id,limit){
   const value=await work.get('value:'+kind+':'+id);
   if(value===undefined)return materials.sequences.read(kind,id,limit);
   if(limit&&Buffer.byteLength(serialize(value))>limit)throw new AppError('LIMIT');
   return value;
  }
  async put(kind,value){
   const id=digest(serialize(value));await work.put('value:'+kind+':'+id,value);return id;
  }
 }
 const review=Object.create(materials);review.sequences=new ReviewSequences(materials.workspace);return review;
}

function profileMapping(source,input){
 if(input===undefined)return source.mapping;
 return datasetMapping(input);
}
async function* sourceFields(source){
 for await(const field of source.fields())yield field.sourceField;
}
function origin(row,column,cell){
 const locator=row.locator??{format:'delimited',line:row.line};
 return {...locator,column,...(cell.pointer!==null&&cell.pointer!==undefined?{cellPointer:cell.pointer}:{})};
}
async function snippet(cell){
 const result={kind:cell.kind,characters:cell.length??cell.value?.length??0};
 if(cell.value!==undefined&&typeof cell.value==='string')result.spelling=cell.value.slice(0,160);
 else if(cell.read){let spelling='';for await(const part of cell.read()){spelling+=part.slice(0,160-spelling.length);if(spelling.length===160)break;}result.spelling=spelling;}
 return result;
}
function cellIssue(error){
 if(valueErrors.has(error.code)||error instanceof RangeError)return error.code??'MATERIAL_INVALID';
 throw error;
}
export async function expectedSourceValue(cell,{kinds,tokens}){
 if(kinds&&!kinds.includes(cell.kind))return 'unexpected-kind';
 if(!tokens||['absent','null'].includes(cell.kind))return null;
 let value=cell.value;
 if(value===undefined&&cell.read){
  const longest=tokens.reduce((length,text)=>Math.max(length,text.length),0);
  if(cell.length>longest)return 'unexpected-token';
  value='';
  for await(const part of cell.read()){if(value.length+part.length>longest)return 'unexpected-token';value+=part;}
 }
 return tokens.includes(value)?null:'unexpected-token';
}
function windowOf({offset=0,limit=32}){
 if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>64)invalid();
 let count=0;const items=[];
 return {get wanted(){return count>=offset&&items.length<limit;},
  append(value){if(count>=offset&&items.length<limit)items.push(value);count++;},
  finish(){return {items,offset,total:count,next:offset+items.length<count?offset+items.length:null};}};
}
function ruleAt(rules,index){
 let low=0,high=rules.length;
 while(low<high){const mid=low+Math.floor((high-low)/2);if(rules[mid].index<index)low=mid+1;else high=mid;}
 return rules[low]?.index===index?rules[low]:null;
}

function cachedRules(scratch,width){
 const pages=new Map();let bytes=0;
 return async index=>{
  const start=index-index%16;let page=pages.get(start);
  if(!page){
   const keys=Array.from({length:Math.min(16,width-start)},(_,n)=>'effective:'+(start+n));
   const items=await scratch.getMany(keys);
   if(items.size!==keys.length)throw new AppError('MATERIAL_MISSING');
   page={items,bytes:keys.reduce((size,key)=>size+Buffer.byteLength(JSON.stringify(items.get(key))),0)};
   if(page.bytes<=512*1024){
    while(pages.size>=32||bytes+page.bytes>512*1024){const first=pages.keys().next().value;bytes-=pages.get(first).bytes;pages.delete(first);}
    bytes+=page.bytes;pages.set(start,page);
   }
  }else{pages.delete(start);pages.set(start,page);}
  return page.items.get('effective:'+index);
 };
}

// Binding and value checking are scoped to the exact profile and original
// revision. Supplied declarations may be wider than a viewport or request.
export async function withProfileSource(materials,profile,artifact,{mapping:input,signal,check,verify},consume){
 const source=profile.source,mapping=profileMapping(source,input);
 await check?.(artifact);
 const evidence=await materials.artifact(artifact,{verification:'descriptor',signal});
 await materials.assertOwner(evidence.doc.recordId);
 const options={signal,sourceIdentities:true,size:evidence.content.size};
 if(source.mapping.format!=='delimited'&&mapping.format===source.mapping.format&&mapping.fields==='all')options.profileFields=sourceFields(source);
 const rows=readPagedDataset(evidence.content.readChunks(0,evidence.content.size-1,{signal}),mapping,options)[Symbol.asyncIterator]();
 try{
  const header=(await rows.next()).value;
  if(!header?.columns)invalid();
  return await withScratch(async scratch=>{
   const matches=await compareProfileColumns(scratch,{template:profileExpectedFields(source,profile.rules),source:header.columns(),
    expectedMapping:source.mapping,actualMapping:header.sourceMapping,signal,compiled:profile.compiled});
   if(profile.signature!==matches.expectedSignature)throw new AppError('MATERIAL_MISSING');
   let failures=matches.sameMapping?0:1,index=0;
   for await(const field of header.columns()){
    const match=await matches.sourceAt(index);
    if(blocking.has(match.status))failures++;
    let column=defaultColumn({label:field.name}),kinds=null,tokens=null;
    if(match.profileIndex!==null&&!blocking.has(match.status)){
     const retained=await source.column(match.profileIndex);column={...retained};
     // Source selection is owned by the new file, even on a renamed column.
     delete column.sourceField;
     if(field.sourceField)column.sourceField=field.sourceField;
     const rule=ruleAt(profile.rules,match.profileIndex);kinds=rule?.kinds??null;tokens=rule?.tokens??null;
     for(const ref of schemaReferences(column))await check?.(ref);
    }
    if(index%32===0)await verify?.();
    await scratch.put('effective:'+index++,{column,kinds,tokens});
   }
   for(let i=0;i<matches.expectedCount;i++)if((await matches.missingAt(i))?.status==='missing-required')failures++;
   return consume({header,rows,matches,failures,evidence,rule:cachedRules(scratch,matches.sourceCount)});
  },{signal});
 }finally{await rows.return?.();}
}

export async function withBatchProfile(profile,{signal,verify},consume){
 return withScratch(async scratch=>{
  const compiled=await compileProfileColumns(scratch,profileExpectedFields(profile.source,profile.rules),profile.source.mapping,signal);
  if(compiled.expectedSignature!==profile.signature)throw new AppError('MATERIAL_MISSING');
  let count=0;
  for await(const column of profile.source.fields()){
   signal?.throwIfAborted();if(count%32===0)await verify?.();
   await scratch.put('column:'+count++,column);
  }
  if(count!==profile.source.width)throw new AppError('MATERIAL_MISSING');
  const source={...profile.source,column:index=>scratch.get('column:'+index),fields:async function*(){
   for(let start=0;start<count;start+=32){
    signal?.throwIfAborted();const keys=Array.from({length:Math.min(32,count-start)},(_,n)=>'column:'+(start+n)),page=await scratch.getMany(keys);
    for(const key of keys)yield page.get(key);
   }
  }};
  return consume({...profile,compiled,source});
 },{signal});
}

export async function reviewProfileSource(materials,profile,artifact,options={}){
 const {signal,check,verify,summaryOnly=false}=options;
 const columns=windowOf(options.columns??{}),issues=windowOf(options.issues??{}),examples=windowOf(options.examples??{});
 return withProfileSource(materials,profile,artifact,options,async({header,rows,matches,failures,rule})=>{
  if(!summaryOnly){
   for(let i=0;i<matches.sourceCount;i++)columns.append(columns.wanted?{...await matches.sourceAt(i),locator:{...header.locator,column:i}}:null);
   for(let i=0;i<matches.expectedCount;i++){const missing=await matches.missingAt(i);if(missing)columns.append({...missing,locator:header.locator??{rowsPath:profile.source.mapping.rowsPath}});}
  }
  let rowCount=0;
  await withScratch(async work=>{
   const review=scratchInterpretations(materials,work);
   for await(const row of rows){
    signal?.throwIfAborted();
    if(rowCount%64===0){await verify?.();await check?.(artifact);}
    let index=0;
    for await(const cell of row.cells()){
     const expected=await rule(index),{column}=expected,locator=origin(row,index,cell);
     let reason=await expectedSourceValue(cell,expected);
     if(!reason)try{await interpretDatasetCell(review,cell,column,direct,{signal});}catch(error){reason=cellIssue(error);}
     if(reason){
      failures++;
      if(!summaryOnly)issues.append(issues.wanted?{reason,locator,name:column.name,value:await snippet(cell)}:null);
     }else if(!summaryOnly&&rowCount===0)examples.append(examples.wanted?{locator,name:column.name,representation:column.representation,radix:column.radix,unit:column.unit,value:await snippet(cell)}:null);
     if(work.size>=128)await work.clear();
     index++;
    }
    if(index!==matches.sourceCount)throw new AppError('MATERIAL_MISSING');
    rowCount++;
   }
  },{signal});
  await check?.(artifact);
  const summary={review:failures===0?profileReviewReceipt(profile.ref,artifact,matches.sourceSignature):null,failures,rowCount};
  return summaryOnly?summary:{...summary,sourceSignature:matches.sourceSignature,expectedSignature:matches.expectedSignature,
   sameMapping:matches.sameMapping,columns:columns.finish(),issues:issues.finish(),examples:examples.finish()};
 });
}
