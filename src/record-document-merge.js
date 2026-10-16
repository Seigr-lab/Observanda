// Three-way reconciliation retains values by reference. Scratch storage owns
// growing identity/order maps; callers own conflict decisions and publication.
import {createHash} from 'node:crypto';
import {withScratch} from './scratch-work.js';
import {RecordContainerBuilder} from './record-tree-values.js';
import {RecordDocument} from './record-document.js';
import {mergeAttemptAdditions} from './web/attempt-model.js';
import {AppError} from './errors.js';

const collections=new Set(['sections','attachments','contributors','relations','figures']);
export async function mergeRecordDocuments(document,{base,mine,stored,choose,signal}){
 const {tree,blocks}=document,hashes=new Map();
 const fingerprint=async ref=>{
  if(ref===null)return null;if(hashes.has(ref))return hashes.get(ref);
  const hash=createHash('sha256');for await(const chunk of tree.json(ref,{canonical:true,signal}))hash.update(chunk);
  const value=hash.digest('hex');if(hashes.size===64)hashes.delete(hashes.keys().next().value);hashes.set(ref,value);return value;
 };
 const same=async(a,b)=>a===b||await fingerprint(a)===await fingerprint(b);
 const field=async(ref,name)=>ref===null?null:new RecordDocument(blocks,ref).reference([name],{signal});
 const read=ref=>ref===null?undefined:tree.read(ref);
 const retain=value=>value===undefined?null:tree.retain(value);
 const select=async(b,m,s,path)=>{
  signal?.throwIfAborted();
  if(await same(m,b))return s;if(await same(s,b)||await same(m,s))return m;
  return choose({path,base:b,mine:m,stored:s});
 };
 async function object(b,m,s,path,{record=false}={}){
  const names=new Set();for(const ref of [b,m,s])if(ref!==null)for await(const item of new RecordDocument(blocks,ref).properties([],{signal}))names.add(item.name);
  const result=new RecordContainerBuilder(blocks,'object');
  for(const name of names){
   signal?.throwIfAborted();const values=await Promise.all([b,m,s].map(ref=>field(ref,name)));let value;
   if(record&&['id','createdAt','updatedAt'].includes(name))value=values[2];
   else if(record&&collections.has(name)&&values.every(ref=>ref!==null))value=await items(...values,[...path,name]);
   else if(record&&name==='attempt'){
    const attempt=mergeAttemptAdditions(...await Promise.all(values.map(read)));
    value=attempt?await retain(attempt):await select(...values,[...path,name]);
   }else if(record&&name==='results'){
    const versions=await Promise.all(values.map(ref=>field(ref,'version')).map(async ref=>read(await ref)));
    if([undefined,1].includes(versions[0])&&versions[1]===1&&versions[2]===1){
     const empty=await tree.retain([]),arrays=await Promise.all(values.map(async ref=>(await field(ref,'statements'))??empty));
     const builder=new RecordContainerBuilder(blocks,'object');await builder.add({name:'version',value:await tree.retain(1)});await builder.add({name:'statements',value:await items(...arrays,[...path,name,'statements'],{atomic:true})});value=await builder.finish();
    }else value=await select(...values,[...path,name]);
   }else value=await select(...values,[...path,name]);
   if(value!==null)await result.add({name,value});
  }
  return result.finish();
 }
 async function items(b,m,s,path,{atomic=false}={}){
  if(await same(m,b))return s;if(await same(s,b)||await same(m,s))return m;
  return withScratch(async work=>{
   const each=async function*(ref){yield* new RecordDocument(blocks,ref).items([],{signal});};
   const id=async ref=>{const value=(await tree.selected(ref,['id'])).value;if(typeof value!=='string')throw new AppError('INVALID');return value;};
   for(const [version,ref] of [['base',b],['mine',m],['stored',s]])for await(const item of each(ref)){
    const key=await id(item.value),row=await work.get('item:'+key)??{id:key,base:null,mine:null,stored:null};if(row[version]!==null)throw new AppError('INVALID');row[version]=item.value;await work.put('item:'+key,row);
   }
   // Walk source order, marking each identity once. Item fields compose
   // independently; retained result claims remain atomic evidence tuples.
   for(const ref of [b,m,s])for await(const item of each(ref)){
    const key=await id(item.value);if(!await work.add('visited:'+key,true))continue;
    const row=await work.get('item:'+key),values=[row.base,row.mine,row.stored];
    row.merged=values.every(value=>value!==null)&&!atomic?await object(...values,[...path,key]):await select(...values,[...path,key]);
    await work.put('item:'+key,row);
   }
   const orders=[];
   for(const ref of [b,m,s]){
    const builder=new RecordContainerBuilder(blocks,'array');
    for await(const item of each(ref)){const key=await id(item.value),row=await work.get('item:'+key);if(row.base&&row.mine&&row.stored&&row.merged)await builder.add({value:await tree.retain(key)});}
    orders.push(await builder.finish());
   }
   const order=await select(...orders,[...path,'order']);let first=null,previous=null;
   for await(const item of each(order)){
    const key=await tree.read(item.value);if(await work.has('next:'+key))throw new AppError('INVALID');
    if(previous===null)first=key;else await work.put('next:'+previous,key);await work.put('next:'+key,null);previous=key;
   }
   // Same neighbour insertion rule as the ordinary record merge, with a
   // disk-backed linked order rather than corpus-sized ID arrays and maps.
   for(const ref of [s,m,b]){
    previous=null;
    for await(const item of each(ref)){
     const key=await id(item.value),row=await work.get('item:'+key);if(!row.merged)continue;
     if(!await work.has('next:'+key)){await work.put('next:'+key,previous===null?first:await work.get('next:'+previous));if(previous===null)first=key;else await work.put('next:'+previous,key);}
     previous=key;
    }
   }
   const result=new RecordContainerBuilder(blocks,'array');
   for(let key=first;key!==null;key=await work.get('next:'+key)){
    if(typeof key!=='string'||!await work.add('emitted:'+key,true))throw new AppError('INVALID');
    const row=await work.get('item:'+key);if(!row?.merged)throw new AppError('INVALID');await result.add({value:row.merged});
   }
   return result.finish();
  },{signal});
 }
 if(!mine)throw new AppError('INVALID');
 if(!base||!stored){
  if(!base&&!stored)return new RecordDocument(blocks,mine,{mutable:true});
  const selected=await same(mine,stored)?stored:await choose({path:[],base,mine,stored});
  if(selected===null)return null;
  const result=new RecordDocument(blocks,selected,{mutable:true});
  return base&&!stored?result.replace(['share'],false,{signal}):result;
 }
 const merged=await object(base,mine,stored,[],{record:true});
 const result=new RecordDocument(blocks,merged,{mutable:true});
 return await same(await field(merged,'notebookId'),await field(stored,'notebookId'))?result:result.replace(['share'],false,{signal});
}
