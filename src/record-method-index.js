// Counted method links pin their complete relationship owner. Comparisons read
// only the selected methods; labels and exact revisions remain in the original.
import {RetainedTableIndex,validTableRef} from './retained-table-index.js';
import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {researchId} from './web/research-reference.js';
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v),natural=v=>Number.isSafeInteger(v)&&v>=0;
const fail=()=>{throw new AppError('CATALOGUE_DAMAGED');},key=position=>String(position).padStart(16,'0');
export const validMethodIndex=v=>v&&Object.keys(v).sort().join()==='relations,root,source,version'&&v.version===1&&hash(v.source)&&natural(v.relations)&&validTableRef(v.root)&&(v.root?.count??0)<=v.relations;
export class RecordMethodIndex{
 constructor(document,value){if(!validMethodIndex(value))fail();this.document=document;this.value=value;this.index=new RetainedTableIndex(document.blocks,{namespace:'index'});}
 async row(entry,{signal}={}){
  if(!entry)fail();signal?.throwIfAborted();const node=await this.document.tree.node(entry.revision),row=node.value;
  if(node.type!=='inline'||!row||Object.keys(row).sort().join()!=='id,position'||!researchId(row.id)||!natural(row.position)||row.position>=this.value.relations||entry.id!==key(row.position))fail();
  const source=await this.document.reference(['relations',String(row.position)],{signal});if(!source)fail();
  const read=async path=>(await this.document.tree.selected(source,path)).value;
  if(await read(['id'])!==row.id||await read(['role'])!=='uses-method')fail();
  return {label:await read(['label']),revision:await read(['target','revision'])};
 }
 async window({offset=0,limit=4,signal}={}){
  if(!natural(offset)||!Number.isSafeInteger(limit)||limit<1||limit>32)throw new AppError('INVALID');signal?.throwIfAborted();
  const total=this.value.root?.count??0,values=[];offset=Math.min(offset,Math.max(0,total-1));
  for(let i=offset;i<Math.min(total,offset+limit);i++){signal?.throwIfAborted();values.push(await this.row(await this.index.entryAt(this.value,i),{signal}));}
  return {values,page:{offset,total,count:values.length}};
 }
 async verify({signal}={}){
  if(this.value.source!==await this.document.reference(['relations'],{signal})||this.value.relations!==await this.document.tree.arrayLength(this.document.root,['relations']))fail();
  let count=0;
  for await(const item of this.document.items(['relations'],{signal})){
   if((await this.document.tree.selected(item.value,['role'])).value!=='uses-method')continue;
   const row={id:(await this.document.tree.selected(item.value,['id'])).value,position:item.index};
   const entry=await this.index.entryAt(this.value,count++);if(entry?.id!==key(row.position)||entry.revision!==digest(serialize({type:'inline',value:row})))fail();await this.row(entry,{signal});
  }
  if(count!==(this.value.root?.count??0))fail();
 }
 static async open(document,{signal}={}){
  signal?.throwIfAborted();const value=document.methodIndex;if(!value)return null;
  if(value.source!==await document.reference(['relations'],{signal}))return null;return new RecordMethodIndex(document,value);
 }
 static async retain(document,{signal}={}){
  const source=await document.reference(['relations'],{signal});if(!source)return null;
  const existing=await this.open(document,{signal});if(existing)return existing.value;
  const value={version:1,source,relations:await document.tree.arrayLength(document.root,['relations']),root:null},index=new RetainedTableIndex(document.blocks,{namespace:'index'});let pending=0;
  if(!value.relations)return null;
  for await(const item of document.items(['relations'],{signal})){
   if((await document.tree.selected(item.value,['role'])).value!=='uses-method')continue;
   const id=(await document.tree.selected(item.value,['id'])).value;if(!researchId(id))fail();
   value.root=await index.change(value.root,key(item.index),await document.tree.retain({id,position:item.index}));if(++pending===32){await index.flush(value.root);pending=0;}
  }
  await index.flush(value.root);
  // An empty, small relationship owner needs no derivative representation.
  // Larger owners retain even an empty method index to avoid repeated scans.
  return !value.root&&value.relations<=64?null:value;
 }
}
