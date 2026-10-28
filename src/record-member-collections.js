// Growing membership lists have counted, immutable references. Their values
// are identities and positions only; original content stays under notebook keys.
import {ObjectIndex,validIndexRef} from './object-index.js';
import {buildIndex} from './index-builder.js';
import {digest,serialize} from './storage-format.js';
import {requireMemberCollections} from './catalogue-format.js';
import {AppError} from './errors.js';
import {retainRecordOwnerResource} from './record-owner-resources.js';
import {writeCatalogueRows} from './catalogue-writes.js';
export const memberCollectionFields=['sections','contributors','relations','figures','attachments'];
const fail=()=>{throw new AppError('CATALOGUE_DAMAGED');};
const id=v=>typeof v==='string'&&/^[a-f0-9-]{36}$/.test(v);
const natural=v=>Number.isSafeInteger(v)&&v>=0;
const positionKey=position=>'position:'+String(position).padStart(16,'0');
export const validMemberCollections=value=>value&&Object.keys(value).sort().join()===memberCollectionFields.slice().sort().join()&&Object.values(value).every(root=>validIndexRef(root)&&(root?.count??0)%2===0);
export function memberCollectionCount(row,field){
 if(!memberCollectionFields.includes(field))fail();
 return row.collections?(row.collections[field]?.count??0)/2:(field==='sections'?row.sections:row.cardItems?.[field])?.length??null;
}
export const memberStructureRevision=row=>row.collections?digest(serialize(row.collections.sections)):digest(serialize(row.sections));
export class RecordMemberCollections extends ObjectIndex{
 constructor(store,{write=null}={}){super(store,{namespace:'record-member-collection:',immutable:true,write});}
 decodeValue(entry,payload){
  const slot='record-member-item:'+entry.revision,value=this.store.decode('state',slot,payload);
  if(!value||Object.keys(value).sort().join()!=='id,position'||!id(value.id)||!natural(value.position)||digest(serialize(value))!==entry.revision)fail();return value;
 }
 async value(entry){
  if(!entry)return null;const slot='record-member-item:'+entry.revision;
  const row=await this.store.db.get('SELECT payload FROM state WHERE slot=$1',slot);return this.decodeValue(entry,row?.payload);
 }
 async build(values){
  const self=this;let batch=[];
  const flush=async()=>{
   if(!batch.length)return;
   await self.persistWith(async store=>{
    const found=new Map((await store.db.all('SELECT slot,payload FROM state WHERE slot=ANY($1::text[])',batch.map(item=>item.slot))).map(row=>[row.slot,row.payload])),rows=[];
    for(const {item,revision,slot} of batch){
     if(found.has(slot)&&digest(serialize(store.decode('state',slot,found.get(slot))))!==revision)fail();
     await retainRecordOwnerResource(store,{kind:'state',key:slot,revision},{present:found.has(slot)});
     if(!found.has(slot))rows.push([slot,store.encode('state',slot,item)]);
    }
    await writeCatalogueRows(store.db,'state',rows,{create:true});
   });batch=[];
  };
  async function* entries(){let position=0;for await(const value of values){
   if(!id(value))fail();const item={id:value,position:position++},revision=digest(serialize(item)),slot='record-member-item:'+revision;
   batch.push({item,revision,slot});if(batch.length===32)await flush();
   yield {id:'id:'+item.id,revision};yield {id:positionKey(item.position),revision};
  }await flush();}
  return buildIndex(this.store,this,entries(),fail);
 }
 async position(row,field,itemId){
  if(!memberCollectionFields.includes(field)||!id(itemId))fail();
  if(!row.collections)return (field==='sections'?row.sections:row.cardItems?.[field])?.indexOf(itemId)??-1;
  const item=await this.value(await this.find({root:row.collections[field]},'id:'+itemId));
  if(item&&(item.id!==itemId||item.position>=memberCollectionCount(row,field)))fail();return item?.position??-1;
 }
 async *ids(row,field,{offset=0,limit=Infinity}={}){
  if(!natural(offset)||limit!==Infinity&&!natural(limit)||!memberCollectionFields.includes(field))fail();
  if(!row.collections){const values=field==='sections'?row.sections:row.cardItems?.[field];if(!Array.isArray(values))fail();for(let i=offset;i<Math.min(values.length,offset+limit);i++)yield values[i];return;}
  const root=row.collections[field],total=memberCollectionCount(row,field),self=this;let position=offset,batch=[];
  async function* consume(){
   // Membership values are small. Bound both row count and ciphertext bytes;
   // oversized or missing values still take the ordinary checked read path.
   const slots=batch.map(entry=>'record-member-item:'+entry.revision),found=new Map((await self.store.db.all('SELECT slot,payload FROM state WHERE slot=ANY($1::text[]) AND octet_length(payload)<=8192',slots)).map(row=>[row.slot,row.payload]));
   for(const entry of batch){
    const payload=found.get('record-member-item:'+entry.revision),item=payload?self.decodeValue(entry,payload):await self.value(entry);
    if(entry.id!==positionKey(position)||item.position!==position||position>=total)fail();
    const reverse=await self.find({root},'id:'+item.id);if(reverse?.revision!==entry.revision)fail();
    yield item.id;position++;
   }
   batch=[];
  }
  for await(const entry of this.entries({root},'position:',offset?positionKey(offset-1):null)){
   if(position+batch.length>=offset+limit)break;
   batch.push(entry);if(batch.length===32)yield* consume();
  }
  if(batch.length)yield* consume();
  if(position!==Math.min(total,offset+limit)&&offset<total)fail();
 }
 async retain(row){
  if(row.collections)return row;
  // Encoding choice only: no workload is rejected at this boundary.
  if(!row.cardItems||memberCollectionFields.reduce((n,field)=>n+memberCollectionCount(row,field),0)<=64)return row;
  await this.persistWith(store=>requireMemberCollections(store.db));const collections={};
  for(const field of memberCollectionFields)collections[field]=await this.build(field==='sections'?row.sections:row.cardItems[field]);
  const {sections,cardItems,...rest}=row;void sections;void cardItems;return {...rest,collections};
 }
 async changed(row,field,document){
  if(!memberCollectionFields.includes(field))fail();
  const self=this;
  async function* selected(){for await(const ref of document.items([field]))yield (await document.tree.selected(ref.value,['id'])).value;}
  if(!row.collections){
   const count=await document.tree.arrayLength(document.root,[field]);
   if(count+memberCollectionFields.filter(name=>name!==field).reduce((n,name)=>n+memberCollectionCount(row,name),0)<=64){
    const ids=await Array.fromAsync(selected());return field==='sections'?{...row,sections:ids}:{...row,cardItems:{...row.cardItems,[field]:ids}};
   }
  }
  await this.persistWith(store=>requireMemberCollections(store.db));const collections={};
  for(const name of memberCollectionFields)collections[name]=name===field?await this.build(selected()):row.collections?.[name]??await this.build(self.ids(row,name));
  const {sections,cardItems,...rest}=row;void sections;void cardItems;return {...rest,collections};
 }
 async verify(row,expected){
  for(const field of memberCollectionFields){
   const values=field==='sections'?expected.sections:expected.cardItems[field];
   if(memberCollectionCount(row,field)!==values.length)fail();let position=0;
   for await(const value of this.ids(row,field))if(value!==values[position++])fail();
  }
 }
}
