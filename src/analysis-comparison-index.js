import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {ComparisonTableIndex,validTableRef} from './analysis-comparison-table.js';

const fail=()=>{throw new AppError('MATERIAL_MISSING');};
const ordinal=value=>String(value).padStart(16,'0');
const tables=['groups','distribution','transitions','observations'];
const queryKey=(view,category,group)=>digest(serialize({view,category,group}));

// One authenticated owner for retained comparison tables, their lookup keys
// and filter postings. Values remain immutable encrypted metadata objects.
// Ordinal range seeks read only the requested window, even near the end.
export class ComparisonIndex{
 constructor(sequences,root=null){if(!validTableRef(root))fail();this.sequences=sequences;this.tree=new ComparisonTableIndex(sequences);this.root=root;}
 async value(entry,table){
  if(!entry)return null;const item=await this.sequences.read('comparison-values',entry.revision);
  if(!item||item.table!==table||typeof item.key!=='string'||!Number.isSafeInteger(item.ordinal)||item.ordinal<0||!item.value)fail();
  return item;
 }
 async get(table,key){
  const item=await this.value(await this.tree.find({root:this.root},'lookup/'+table+'/'+digest(key)),table);
  if(item&&item.key!==key)fail();return item;
 }
 async put(table,key,value,count,filters=[]){
  const previous=await this.get(table,key),at=previous?.ordinal??count;
  if(!Number.isSafeInteger(at)||at<0)fail();
  const item={table,key,ordinal:at,value},revision=await this.sequences.put('comparison-values',item);
  this.root=await this.tree.change(this.root,'lookup/'+table+'/'+digest(key),revision);
  this.root=await this.tree.change(this.root,'row/'+table+'/'+ordinal(at),revision);
  for(const filter of new Set(filters))this.root=await this.tree.change(this.root,'filter/'+table+'/'+filter+'/'+ordinal(at),revision);
  return !previous;
 }
 async state(table,key,value){
  const stored='state/'+table+'/'+digest(key);
  if(value===undefined){const entry=await this.tree.find({root:this.root},stored);if(!entry)return null;const row=await this.sequences.read('comparison-state',entry.revision);if(!row||row.key!==key)fail();return row.value;}
  const revision=await this.sequences.put('comparison-state',{key,value});this.root=await this.tree.change(this.root,stored,revision);
 }
 filters(view,category,group){return ['',category].flatMap(c=>['',group].map(g=>queryKey(view,c,g)));}
 async flush(){await this.tree.flush(this.root);return this.root;}
 async page(table,{offset=0,limit=20,view='',category='',group='',backward=false,signal}={}){
  if(!tables.includes(table)||!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>50||typeof backward!=='boolean')throw new AppError('INVALID');
  const prefix=view?'filter/'+table+'/'+queryKey(view,category,group)+'/':'row/'+table+'/',head={root:this.root};
  const start=await this.tree.rank(head,prefix),end=await this.tree.rank(head,prefix+'\uffff'),total=end-start,items=[];let bytes=0;
  if(offset>total)throw new AppError('INVALID');
  for(let at=start+offset-(backward?1:0);at>=start&&at<end&&items.length<limit;at+=backward?-1:1){
   signal?.throwIfAborted();const entry=await this.tree.entryAt(head,at),item=await this.value(entry,table);
   if(!item||entry.id!==prefix+ordinal(item.ordinal))fail();const size=Buffer.byteLength(serialize(item.value));
   if(size>1048576)throw new AppError('ANALYSIS_LIMIT');if(items.length&&bytes+size>1048576)break;
   if(backward)items.unshift(item.value);else items.push(item.value);bytes+=size;
  }
  if(backward)offset-=items.length;
  return {items,offset,total,next:offset+items.length<total?offset+items.length:null};
 }
 async *items(table,{signal}={}){let offset=0;for(;;){const page=await this.page(table,{offset,limit:32,signal});yield* page.items;if(page.next===null)return;offset=page.next;}}
 async *metadata({signal}={}){
  // Lookup and filter entries reference the same values as ordinal rows.
  // Walk the immutable tree with a depth-sized stack and emit each payload
  // through its owning row, without accumulating the entire comparison.
  for await(const {ref,node} of this.tree.nodes(this.root,{signal})){
   yield {name:'.observanda/materials/sequences/comparison-nodes/'+ref.hash+'.json',value:node};
   for(const entry of node.entries??[])if(entry.id.startsWith('row/')||entry.id.startsWith('state/')){
    const kind=entry.id.startsWith('row/')?'comparison-values':'comparison-state',value=await this.sequences.read(kind,entry.revision);if(!value)fail();
    yield {name:'.observanda/materials/sequences/'+kind+'/'+entry.revision+'.json',value};
   }
  }
 }
 async verify({signal}={}){
  for await(const entry of this.tree.entries({root:this.root})){
   signal?.throwIfAborted();
   if(entry.id.startsWith('row/')){const table=entry.id.split('/')[1],item=await this.value(entry,table);if(!tables.includes(table)||entry.id!=='row/'+table+'/'+ordinal(item.ordinal))fail();}
   else if(entry.id.startsWith('state/')){if(!await this.sequences.read('comparison-state',entry.revision))fail();}
  }
 }
}
