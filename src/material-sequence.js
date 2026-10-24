// Bounded immutable sequences for dataset manifests and schemas. The shared
// authenticated tree pins encrypted chunks; no growing array enters a revision.
import {ObjectIndex,validIndexRef} from './object-index.js';
import {digest,serialize} from './storage-format.js';
import {retainRecordOwnerResource,recordOwnerMetadataDependencies,recordOwnerResourcesTracking} from './record-owner-resources.js';
import {catalogueContext} from './research-catalogue.js';
import {AppError} from './errors.js';
const prefix='.observanda/materials/sequences';
const hash=value=>digest(serialize(value));
const fail=()=>{throw new AppError('MATERIAL_MISSING');};
const chunkSizeFor=kind=>kind==='columns-policy'?4:['plot-points','calculation-lineage','uncertainty-inputs','uncertainty-covariance','clock-sync-segments','clock-sync-anchors'].includes(kind)?1:kind==='calculation-nodes'?8:['columns','cells','cell-text','domain-components'].includes(kind)?16:64;
const key=page=>'chunk:'+String(page).padStart(16,'0');
export class MaterialSequence{
 constructor(workspace){this.workspace=workspace;}
 async read(kind,id,limit=1048576){const raw=await this.workspace.readMetadata(prefix+'/'+kind+'/'+id+'.json',limit);if(raw===null)return null;let value;try{value=JSON.parse(raw);}catch{fail();}if(hash(value)!==id)fail();return value;}
 async put(kind,value){if(kind==='chunks'&&['plot-points','plot-members'].includes(value.kind)&&typeof this.workspace.catalogue==='function')await this.workspace.catalogue(async store=>{const {requireNativeNumericalModels}=await import('./catalogue-format.js');await requireNativeNumericalModels(store.db);});const id=hash(value),prior=await this.read(kind,id),relative=prefix+'/'+kind+'/'+id+'.json',text=serialize(value);if(catalogueContext.getStore()&&(typeof this.workspace.catalogue==='function'||this.workspace.root!==undefined)){if(typeof this.workspace.catalogue!=='function')throw new AppError('INVALID');await this.workspace.catalogue(async store=>{if(!await recordOwnerResourcesTracking(store))return;const dependencies=await recordOwnerMetadataDependencies(store,relative,text);await retainRecordOwnerResource(store,{kind:'object',key:'metadata:'+relative,revision:hash({text})},{present:prior!==null,dependencies});});}if(prior===null)await this.workspace.writeMetadata(relative,text);return id;}
 tree(){return new ObjectIndex(null,{immutable:true,nodeStorage:{read:ref=>this.read('nodes',ref.hash,8192),write:(ref,node)=>this.put('nodes',node)}});}
 validate(value){
  if(!value||value.format!==1||!['pages','columns','columns-policy','references','files','upload-chunks','aggregation-members','cells','cell-text','domain-components','plot-points','plot-members','calculation-bindings','calculation-nodes','calculation-outputs','calculation-edges','calculation-lineage','calculation-row-bindings','calculation-source-locators','uncertainty-inputs','uncertainty-covariance','clock-sync-segments','clock-sync-anchors'].includes(value.kind)||!Number.isSafeInteger(value.count)||value.count<0||value.chunkSize!==chunkSizeFor(value.kind)||!validIndexRef(value.root)||(value.root?.count??0)!==Math.ceil(value.count/value.chunkSize))fail();
  return value;
 }
 builder(kind,write){
  if(kind==='calculation-lineage')throw new AppError('INVALID');
  let root=null,count=0,buffer=[];const owner=this,chunkSize=chunkSizeFor(kind);
  const flush=async()=>{
   if(!buffer.length)return;
   const chunk={kind,offset:count-buffer.length,items:buffer},index=Math.floor(chunk.offset/chunkSize);
   let next;await write(async()=>{const version=await owner.put('chunks',chunk),tree=owner.tree();next=await tree.change(root,key(index),version);await tree.flush(next);});root=next;
   buffer=[];
  };
  return {get count(){return count;},async append(item){if(!Number.isSafeInteger(count+1))throw new AppError('MATERIAL_DATASET_LIMIT');buffer.push(item);count++;if(buffer.length===chunkSize)await flush();},
   async finish(){await flush();return owner.validate({format:1,kind,root,count,chunkSize});}};
 }
 async page(value,{offset=0,limit=16}={}){
  this.validate(value);
  if(!Number.isSafeInteger(offset)||offset<0||offset>value.count||!Number.isSafeInteger(limit)||limit<1||limit>256)throw new AppError('INVALID');
  const tree=this.tree(),items=[],chunkSize=value.chunkSize;
  if(value.kind==='calculation-lineage'){for(let at=offset;at<Math.min(offset+limit,value.count);at++){const entry=await tree.entryAt({root:value.root},at),chunk=entry&&await this.read('chunks',entry.revision);if(!chunk||chunk.kind!==value.kind||chunk.key!==entry.id||!Array.isArray(chunk.items)||chunk.items.length!==1)fail();items.push(chunk.items[0]);}return {items,offset,total:value.count,next:offset+items.length<value.count?offset+items.length:null};}
  while(offset+items.length<Math.min(offset+limit,value.count)){
   const at=offset+items.length,index=Math.floor(at/chunkSize),entry=await tree.find({root:value.root},key(index));if(!entry)fail();
   const chunk=await this.read('chunks',entry.revision);
   if(!chunk||chunk.kind!==value.kind||chunk.offset!==index*chunkSize||!Array.isArray(chunk.items)||chunk.items.length!==Math.min(chunkSize,value.count-chunk.offset))fail();
   items.push(...chunk.items.slice(at%chunkSize,Math.min(chunkSize,at%chunkSize+limit-items.length)));
  }
  return {items,offset,total:value.count,next:offset+items.length<value.count?offset+items.length:null};
 }
 async append(value,items){
  this.validate(value);
  if(value.kind==='calculation-lineage'||!Array.isArray(items)||items.length>64)throw new AppError('INVALID');
  if(!Number.isSafeInteger(value.count+items.length))throw new AppError('MATERIAL_DATASET_LIMIT');
  if(!items.length)return value;
  const size=value.chunkSize,tree=this.tree();let root=value.root,count=value.count,remaining=[...items];
  const start=count-count%size;
  let buffer=count%size?(await this.page(value,{offset:start,limit:count-start})).items:[];
  while(remaining.length){
   const take=remaining.splice(0,size-buffer.length);buffer.push(...take);count+=take.length;
   const offset=count-buffer.length,revision=await this.put('chunks',{kind:value.kind,offset,items:buffer});
   root=await tree.change(root,key(Math.floor(offset/size)),revision);buffer=[];
  }
  await tree.flush(root);return this.validate({...value,root,count});
 }
 async item(value,index){const page=await this.page(value,{offset:index,limit:1});if(!page.items.length)fail();return page.items[0];}
 async *items(value){for(let offset=0;offset<value.count;offset+=64)yield* (await this.page(value,{offset,limit:64})).items;}
}
