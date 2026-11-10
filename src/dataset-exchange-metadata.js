import {AppError} from './errors.js';
import {materialReference,validMaterialReference} from './web/material-reference.js';
import {DATASET_LIMITS} from './dataset-reader.js';

// Selected scientific metadata can contain immutable sequences, e.g. the leaves
// of a calculation or the axes of a coordinate frame. Write their logical
// entries so an independent reader never needs a private object-store key.
const metadataKinds=new Set(['references','coordinate-frame-axes','calculation-lineage','calculation-row-bindings','calculation-source-locators','domain-components','cell-text','coordinate-alignment-contexts','coordinate-alignment-decisions','coordinate-alignment-evidence','clock-sync-segments','clock-sync-anchors','uncertainty-inputs','uncertainty-covariance','topology-vertices','topology-edges']);
export const exchangeSequenceKind=kind=>metadataKinds.has(kind);
const missing=()=>{throw new AppError('MATERIAL_MISSING');};

export async function* exchangeMetadata(materials,frame,options,depth=0){
 const sequences=[],sources=[];
 function replace(value,path){
  if(value===null||typeof value!=='object')return value;
  if(path.length>DATASET_LIMITS.depth)missing();
  if(Object.hasOwn(value,'root')&&Object.hasOwn(value,'chunkSize')){
   materials.sequences.validate(value);
   if(!metadataKinds.has(value.kind)||sequences.length>=DATASET_LIMITS.keys||depth>=DATASET_LIMITS.depth)missing();
   sequences.push({path,descriptor:value});
   return null;
  }
  if(Array.isArray(value))return value.map((item,i)=>replace(item,[...path,i]));
  const copy=Object.fromEntries(Object.entries(value).map(([key,item])=>[key,replace(item,[...path,key])]));
  if(validMaterialReference(value))sources.push({value,copy});
  return copy;
 }
 const body=replace(frame,[]);
 for(const {value,copy} of sources){
  options.signal?.throwIfAborted();
  const address=await options.checkSource(value)??materialReference({...value,workspaceId:value.workspaceId??options.namespace});
  if(!validMaterialReference(address)||!address.workspaceId||['id','kind','revision'].some(key=>address[key]!==value[key]))missing();
  Object.assign(copy,materialReference(address));
 }
 if(sequences.length)body.sequences=sequences.map(({path,descriptor})=>({path,kind:descriptor.kind,count:descriptor.count}));
 yield body;
 for(let sequence=0;sequence<sequences.length;sequence++){
  const {descriptor}=sequences[sequence];
  for(let offset=0;offset<descriptor.count;){
   options.signal?.throwIfAborted();await options.check();
   const {items}=await materials.sequences.page(descriptor,{offset,limit:Math.min(64,descriptor.count-offset)});
   if(!items.length||items.length>descriptor.count-offset)missing();
   for(const value of items){
    // Analysis bindings retain private copies of upstream cells for native
    // graph replay. Their pinned binding and source row identify the evidence.
    let exported=value;
    if(descriptor.kind==='calculation-row-bindings'&&value?.location?.kind==='analysis'){
     exported={...value,location:{kind:'analysis',row:value.location.row}};
    }
    yield* exchangeMetadata(materials,{type:'sequence-item',sequence,index:offset++,value:exported},options,depth+1);
   }
  }
 }
}
