// Result lookup shares the original notebook key and pins the complete results
// owner. Rows contain identities and positions; statement bodies stay original.
import {RetainedTableIndex,validTableRef} from './retained-table-index.js';
import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {researchId} from './web/research-reference.js';
import {collectionChanges} from './record-projection-dependency.js';
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v),natural=v=>Number.isSafeInteger(v)&&v>=0;
const fail=()=>{throw new AppError('CATALOGUE_DAMAGED');},ordinal=position=>String(position).padStart(16,'0');
const positionKey=position=>'position:'+ordinal(position),figurePrefix=id=>'figure:'+id+':';
const keys=row=>['id:'+row.id,positionKey(row.position),...(row.figureId?[figurePrefix(row.figureId)+ordinal(row.position)]:[])];
export const validResultIndex=v=>v&&Object.keys(v).sort().join()==='count,root,source,version'&&v.version===1&&hash(v.source)&&natural(v.count)&&validTableRef(v.root)&&(v.count===0?v.root===null:!!v.root&&v.root.count>=v.count*2&&v.root.count<=v.count*3);
async function sourceRow(document,reference,position,{signal}={}){
 signal?.throwIfAborted();if(!reference||!natural(position))fail();
 const read=async name=>(await document.tree.selected(reference,[name])).value;
 const id=await read('id'),figureId=await read('kind')==='figure'?await read('figureId'):null;
 if(!researchId(id)||figureId!==null&&!researchId(figureId))fail();return {id,position,figureId};
}
// The previous owner is already retained. Resolve paths relative to it without
// constructing a record or reading any unrelated source collections.
function previousResults(document,source){
 return {tree:document.tree,async reference(path,{signal}={}){
  signal?.throwIfAborted();if(path[0]!=='results')fail();const selected=await document.tree.select(source,path.slice(1));
  return !selected?null:selected.inline?document.tree.retain(selected.value):selected.revision;
 }};
}
async function amendResults(document,base,value,index,{signal}={}){
 const previous=previousResults(document,base.source),path=['results','statements'];
 if(base.count!==await previous.tree.arrayLength(base.source,['statements']))fail();
 const changes=await collectionChanges(document,previous,path,{signal});if(!changes)fail();
 value.root=base.root;if(changes.unchanged){if(base.count!==value.count)fail();return value;}
 if(changes.beforeTotal!==base.count||changes.total!==value.count)fail();
 const at=async(owner,position)=>sourceRow(owner,await owner.reference([...path,String(position)],{signal}),position,{signal});
 async function* changedRows(){
  for await(const position of changes.positions()){
   signal?.throwIfAborted();const before=position<base.count?await at(previous,position):null,after=position<value.count?await at(document,position):null;
   if(before&&after&&before.id===after.id&&before.figureId===after.figureId)continue;
   yield {before,after};
  }
 }
 // Remove every old changed identity before inserting any new identity. A
 // reorder can cross batches; an ID in a later old position is not a duplicate.
 // Replaying the immutable difference frontier keeps both passes bounded.
 for(const removing of [true,false]){
  let pending=0;
  for await(const change of changedRows()){
   const row=removing?change.before:change.after;if(!row)continue;
   if(removing){
    const revision=digest(serialize({type:'inline',value:row}));
    for(const id of keys(row)){if((await index.find(value,id))?.revision!==revision)fail();value.root=await index.remove(value.root,id);}
   }else{
    if(await index.find(value,'id:'+row.id))fail();const revision=await document.tree.retain(row);
    for(const id of keys(row))value.root=await index.change(value.root,id,revision);
   }
   if(++pending===32){await index.flush(value.root);pending=0;}
  }
  await index.flush(value.root);
 }
 if(!validResultIndex(value))fail();return value;
}
export class RecordResultIndex{
 constructor(document,value){if(!validResultIndex(value))fail();this.document=document;this.value=value;this.index=new RetainedTableIndex(document.blocks,{namespace:'index',allowSparseBranches:true});}
 async row(entry,{signal}={}){
  signal?.throwIfAborted();if(!entry)fail();const node=await this.document.tree.node(entry.revision),row=node.value;
  if(node.type!=='inline'||!row||Object.keys(row).sort().join()!=='figureId,id,position'||!researchId(row.id)||!natural(row.position)||row.position>=this.value.count||row.figureId!==null&&!researchId(row.figureId)||!keys(row).includes(entry.id))fail();
  const reference=await this.document.reference(['results','statements',String(row.position)],{signal}),expected=await sourceRow(this.document,reference,row.position,{signal});
  if(Object.keys(expected).some(name=>expected[name]!==row[name]))fail();return row;
 }
 async statement(id,{signal}={}){
  if(!researchId(id))throw new AppError('INVALID');signal?.throwIfAborted();const entry=await this.index.find(this.value,'id:'+id);return entry?this.row(entry,{signal}):null;
 }
 async window(options={}){return this.#window('position:',options,{count:this.value.count});}
 async figureWindow(id,options={}){if(!researchId(id))throw new AppError('INVALID');return this.#window(figurePrefix(id),options);}
 async hasFigure(id,{signal}={}){return (await this.figureWindow(id,{limit:1,signal})).total>0;}
 async #window(prefix,{offset=0,limit=4,signal}={},expected={}){
  if(!natural(offset)||!Number.isSafeInteger(limit)||limit<1||limit>32)throw new AppError('INVALID');signal?.throwIfAborted();
  const start=await this.index.rank(this.value,prefix),end=await this.index.rank(this.value,prefix+'\uffff'),total=end-start,rows=[];
  if(expected.count!==undefined&&total!==expected.count)fail();offset=Math.min(offset,Math.max(0,total-1));
  for(let i=offset;i<Math.min(total,offset+limit);i++){
   signal?.throwIfAborted();const entry=await this.index.entryAt(this.value,start+i);
   if(!entry?.id.startsWith(prefix)||expected.count!==undefined&&entry.id!==positionKey(i))fail();rows.push(await this.row(entry,{signal}));
  }
  return {rows,total,offset};
 }
 async verify({signal}={}){
  if(this.value.source!==await this.document.reference(['results'],{signal})||this.value.count!==await this.document.tree.arrayLength(this.document.root,['results','statements']))fail();
  let count=0,position=0;
  for await(const item of this.document.items(['results','statements'],{signal})){
   if(item.index!==position++)fail();const row=await sourceRow(this.document,item.value,item.index,{signal}),revision=digest(serialize({type:'inline',value:row}));
   for(const id of keys(row)){if((await this.index.find(this.value,id))?.revision!==revision)fail();if(!natural(++count))fail();}
  }
  if(position!==this.value.count||count!==(this.value.root?.count??0))fail();
  for await(const entry of this.index.entries(this.value)){signal?.throwIfAborted();await this.row(entry,{signal});}
 }
 static async open(document,{signal}={}){
  signal?.throwIfAborted();const value=document.resultIndex;if(!value)return null;const index=new RecordResultIndex(document,value);
  // An edited owner invalidates its previous derivative. Legacy originals have
  // no descriptor and use the caller's bounded source fallback.
  if(value.source!==await document.reference(['results'],{signal}))return null;
  if(value.count!==await document.tree.arrayLength(document.root,['results','statements']))fail();return index;
 }
 static async retain(document,{signal}={}){
  const source=await document.reference(['results'],{signal});if(!source)return null;
  const existing=await this.open(document,{signal});if(existing)return existing.value;
  const value={version:1,source,count:await document.tree.arrayLength(document.root,['results','statements']),root:null},index=new RetainedTableIndex(document.blocks,{namespace:'index',allowSparseBranches:true});
  if(document.resultIndex)return amendResults(document,document.resultIndex,value,index,{signal});
  let pending=0,position=0;
  for await(const item of document.items(['results','statements'],{signal})){
   if(item.index!==position++)fail();const row=await sourceRow(document,item.value,item.index,{signal});if(await index.find(value,'id:'+row.id))fail();
   const revision=await document.tree.retain(row);for(const id of keys(row))value.root=await index.change(value.root,id,revision);
   // Flush reachable paths after a fixed batch; neither pending index nodes
   // nor duplicate detection requires a collection-sized JavaScript container.
   if(++pending===32){await index.flush(value.root);pending=0;}
  }
  if(position!==value.count)fail();await index.flush(value.root);return value;
 }
}
