// A derivative pins one exact website collection. Bodies remain in the source
// tree; keyed selection and public-page counts touch only authenticated paths.
import {RetainedTableIndex,validTableRef} from './retained-table-index.js';
import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {collectionChanges} from './record-projection-dependency.js';
import {revisionId} from './web/revision-model.js';
import {WEBSITE_COLLECTION_PATHS,websiteCollectionName,websiteCollectionKey,validWebsiteCollectionKey} from './web/website-collection-model.js';
const fail=()=>{throw new AppError('CATALOGUE_DAMAGED');},invalid=()=>{throw new AppError('INVALID');};
const natural=v=>Number.isSafeInteger(v)&&v>=0,ordinal=n=>String(n).padStart(16,'0');
const keys=row=>['key:'+row.key,'position:'+ordinal(row.position),...(row.shared?['shared:'+ordinal(row.position)]:[])];
export const validWebsiteCollectionIndex=v=>v&&Object.keys(v).sort().join()==='count,root,source,version'&&v.version===1&&revisionId(v.source)&&natural(v.count)&&validTableRef(v.root)&&(v.count===0?v.root===null:!!v.root&&v.root.count>=v.count*2&&v.root.count<=v.count*3);
export const validWebsiteCollectionIndexes=v=>v&&Object.keys(v).sort().join()==='assets,navigation,pages'&&Object.values(v).every(validWebsiteCollectionIndex);
async function sourceRow(document,collection,position,{signal}={}){
 const path=WEBSITE_COLLECTION_PATHS[collection],key=(await document.field([...path,String(position),collection==='navigation'?'target':'id'],{signal})).value;
 if(!validWebsiteCollectionKey(collection,key))fail();const shared=collection==='pages'?(await document.field([...path,String(position),'share'],{signal})).value:false;
 const label=collection==='pages'?(await document.field([...path,String(position),'title'],{signal})).value:null;if(typeof shared!=='boolean'||label!==null&&typeof label!=='string')fail();return {key,position,shared,label};
}
function priorOwner(document,path,source){return {tree:document.tree,async reference(request,{signal}={}){signal?.throwIfAborted();if(path.some((part,i)=>request[i]!==part))fail();const selected=await document.tree.select(source,request.slice(path.length));return !selected?null:selected.inline?document.tree.retain(selected.value):selected.revision;},async field(request,{signal}={}){signal?.throwIfAborted();if(path.some((part,i)=>request[i]!==part))fail();return document.tree.selected(source,request.slice(path.length));}};}
export class WebsiteCollectionIndex{
 constructor(document,collection,value){if(!websiteCollectionName(collection)||!validWebsiteCollectionIndex(value))fail();this.document=document;this.collection=collection;this.value=value;this.index=new RetainedTableIndex(document.blocks,{namespace:'index',allowSparseBranches:true});}
 async row(entry,{signal}={}){
  if(!entry)fail();signal?.throwIfAborted();const node=await this.document.tree.node(entry.revision),row=node.value;
  if(node.type!=='inline'||!row||Object.keys(row).sort().join()!=='key,label,position,shared'||!validWebsiteCollectionKey(this.collection,row.key)||!natural(row.position)||row.position>=this.value.count||typeof row.shared!=='boolean'||!keys(row).includes(entry.id))fail();
  const expected=await sourceRow(this.document,this.collection,row.position,{signal});if(Object.keys(expected).some(key=>expected[key]!==row[key]))fail();return row;
 }
 async item(key,{signal}={}){if(!validWebsiteCollectionKey(this.collection,key))invalid();const entry=await this.index.find(this.value,'key:'+key);return entry?this.row(entry,{signal}):null;}
 async window({offset=0,limit=20,signal}={}){
  if(!natural(offset)||!Number.isSafeInteger(limit)||limit<1||limit>100)invalid();const start=await this.index.rank(this.value,'position:'),end=await this.index.rank(this.value,'position;');if(end-start!==this.value.count)fail();const rows=[];
  for(let position=offset;position<Math.min(this.value.count,offset+limit);position++){signal?.throwIfAborted();const entry=await this.index.entryAt(this.value,start+position);if(entry?.id!=='position:'+ordinal(position))fail();rows.push(await this.row(entry,{signal}));}
  return {rows,total:this.value.count,offset};
 }
 async sharedCount(){return await this.index.rank(this.value,'shared;')-await this.index.rank(this.value,'shared:');}
 async verify({signal}={}){
  if(this.value.source!==await this.document.reference(WEBSITE_COLLECTION_PATHS[this.collection],{signal})||this.value.count!==await this.document.tree.arrayLength(this.document.root,WEBSITE_COLLECTION_PATHS[this.collection]))fail();let total=0,position=0;
  for await(const item of this.document.items(WEBSITE_COLLECTION_PATHS[this.collection],{signal})){
   if(item.index!==position++)fail();const row=await sourceRow(this.document,this.collection,item.index,{signal}),revision=digest(serialize({type:'inline',value:row}));
   for(const key of keys(row)){if((await this.index.find(this.value,key))?.revision!==revision)fail();total++;}
  }
  if(position!==this.value.count||total!==(this.value.root?.count??0))fail();for await(const entry of this.index.entries(this.value))await this.row(entry,{signal});
 }
 static async open(document,collection,value,{signal}={}){
  if(!value)return null;const result=new this(document,collection,value),path=WEBSITE_COLLECTION_PATHS[collection];if(value.source!==await document.reference(path,{signal}))return null;
  if(value.count!==await document.tree.arrayLength(document.root,path))fail();return result;
 }
 static async retain(document,collection,previous,{signal}={}){
  if(!websiteCollectionName(collection))invalid();const existing=await this.open(document,collection,previous,{signal});if(existing)return existing.value;
  const path=WEBSITE_COLLECTION_PATHS[collection],value={version:1,source:await document.reference(path,{signal}),count:await document.tree.arrayLength(document.root,path),root:previous?.root??null},index=new RetainedTableIndex(document.blocks,{namespace:'index',allowSparseBranches:true});
  const before=previous?priorOwner(document,path,previous.source):null,changes=before?await collectionChanges(document,before,path,{signal}):null;
  if(before&&(!changes||changes.unchanged||changes.beforeTotal!==previous.count||changes.total!==value.count))fail();
  async function* changed(){
   const positions=changes?changes.positions():(async function*(){for(let i=0;i<value.count;i++)yield i;})();
   for await(const position of positions){signal?.throwIfAborted();const old=before&&position<previous.count?await sourceRow(before,collection,position,{signal}):null,next=position<value.count?await sourceRow(document,collection,position,{signal}):null;
    if(old&&next&&old.key===next.key&&old.shared===next.shared&&old.label===next.label)continue;yield {old,next};
   }
  }
  for(const remove of [true,false]){let pending=0;for await(const change of changed()){
   const row=remove?change.old:change.next;if(!row)continue;
   if(remove){const revision=digest(serialize({type:'inline',value:row}));for(const key of keys(row)){if((await index.find(value,key))?.revision!==revision)fail();value.root=await index.remove(value.root,key);}}
   else{if(await index.find(value,'key:'+row.key))invalid();const revision=await document.tree.retain(row);for(const key of keys(row))value.root=await index.change(value.root,key,revision);}
   if(++pending===32){await index.flush(value.root);pending=0;}
  }await index.flush(value.root);}
  if(!validWebsiteCollectionIndex(value))fail();return value;
 }
 static async retainAll(document,previous=null,options={}){const indexes={};for(const collection of Object.keys(WEBSITE_COLLECTION_PATHS))indexes[collection]=await this.retain(document,collection,previous?.[collection],options);return indexes;}
}
