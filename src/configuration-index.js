// A single authenticated index covers all schema collections. Parent identity
// scopes child keys; ordinal entries never contain growing child arrays.
import {RetainedTableIndex,validTableRef} from './retained-table-index.js';
import {RecordDocument} from './record-document.js';
import {collectionChanges} from './record-projection-dependency.js';
import {digest,serialize} from './storage-format.js';
import {AppError} from './errors.js';
import {configurationCollections,validConfigurationProfile,validConfigurationSection,validConfigurationField,validConfigurationChoice} from './web/configuration-model.js';
const fail=()=>{throw new AppError('CATALOGUE_DAMAGED');};
const invalid=()=>{throw new AppError('INVALID');};
const ordinal=n=>String(n).padStart(16,'0'),natural=n=>Number.isSafeInteger(n)&&n>=0;
const stamp=value=>digest(serialize(value));
const profileKey=id=>id??'~';
export const configurationContext=({collection,sectionId,fieldKey})=>collection==='fields'?sectionId+':':collection==='choices'?sectionId+':'+fieldKey+':':'';
export const configurationOrderPrefix=query=>'o:'+query.collection+':'+configurationContext(query);
export const configurationIdentityKey=query=>'k:'+query.collection+':'+configurationContext(query)+(query.collection==='choices'?stamp(query.key):query.key);
const rowKeys=row=>[configurationIdentityKey(row),configurationOrderPrefix(row)+ordinal(row.position),...(row.collection==='sections'?['s:'+profileKey(row.value.profileId)+':'+row.value.key,'p:'+profileKey(row.value.profileId)+':'+ordinal(row.position)]:[])];
const uniqueKeys=row=>[configurationIdentityKey(row),...(row.collection==='sections'?['s:'+profileKey(row.value.profileId)+':'+row.value.key]:[])];
export async function configurationObjectHeader(document,path,omitted,{signal,allowed=null}={}){
 signal?.throwIfAborted();const selected=await document.tree.select(document.root,path);if(!selected)fail();
 const node=selected.inline?{type:'inline',value:selected.value}:await document.tree.node(selected.revision);
 if(node.type==='inline'&&(!node.value||typeof node.value!=='object'||Array.isArray(node.value)))fail();
 const names=[],value={};
 const accept=name=>{if(typeof name!=='string'||names.includes(name)||names.length>=9||allowed&&!allowed.includes(name)&&!omitted.includes(name))invalid();names.push(name);};
 if(node.type==='inline')for(const name of Object.keys(node.value))accept(name);
 else{if(node.type!=='object')fail();for await(const child of document.tree.children(node)){if(child.type!=='property')fail();accept(child.name);}}
 for(const name of names){
  signal?.throwIfAborted();if(omitted.includes(name))continue;const target=await document.tree.select(document.root,[...path,name]),item=target?.inline?{type:'inline',value:target.value}:target?await document.tree.node(target.revision):null;
  if(item?.type!=='inline')invalid();Object.defineProperty(value,name,{value:structuredClone(item.value),enumerable:true});
 }
 if(omitted.some(name=>!names.includes(name)))fail();return value;
}
export async function configurationSourceRow(document,collection,path,position,context={},options={}){
 const {signal,draft=true}=options;signal?.throwIfAborted();const source=await document.reference(path,{signal});if(!source)fail();
 let value,counts,key;
 if(collection==='choices'){const node=await document.tree.node(source);if(node.type!=='inline')invalid();value=node.value;if(!validConfigurationChoice(value,{draft}))invalid();key=value;}
 else{
  const child=collection==='sections'?'fields':collection==='fields'?'choices':null;
  value=await configurationObjectHeader(document,path,child?[child]:[],{signal,allowed:collection==='profiles'?['id','version','enabled']:collection==='sections'?['id','profileId','key','label','description','enabled']:['key','label','type','unit','required','numeric']});
  if(!(collection==='profiles'?validConfigurationProfile(value):collection==='sections'?validConfigurationSection(value,{draft}):validConfigurationField(value,{draft})))invalid();
  key=collection==='fields'?value.key:value.id;
  if(child)counts={[child]:await document.tree.arrayLength(document.root,[...path,child])};
 }
 return {configurationRow:1,collection,...context,key,position,path,source,value,...(counts?{counts}:{})};
}
async function* descendants(document,row,options){
 const child=row.collection==='sections'?'fields':row.collection==='fields'?'choices':null;if(!child)return;
 const context=row.collection==='sections'?{sectionId:row.key}:{sectionId:row.sectionId,fieldKey:row.key};
 yield* configurationRows(document,child,[...row.path,child],context,options);
}
export async function* configurationRows(document,collection,path=[collection],context={},options={}){
 for await(const item of document.items(path,options)){
  const row=await configurationSourceRow(document,collection,[...path,String(item.index)],item.index,context,options);yield row;yield* descendants(document,row,options);
 }
}
async function* changedRows(document,previous,collection,path,context,options){
 const changes=await collectionChanges(document,previous,path,options);if(!changes)fail();if(changes.unchanged)return;
 for await(const position of changes.positions()){
  const itemPath=[...path,String(position)],before=position<changes.beforeTotal?await configurationSourceRow(previous,collection,itemPath,position,context,options):null,after=position<changes.total?await configurationSourceRow(document,collection,itemPath,position,context,options):null;
  if(before?.source===after?.source)continue;yield {before,after};
  if(before&&after&&before.key===after.key){
   const child=collection==='sections'?'fields':collection==='fields'?'choices':null;
   if(child)yield* changedRows(document,previous,child,[...itemPath,child],collection==='sections'?{sectionId:after.key}:{sectionId:after.sectionId,fieldKey:after.key},options);
  }else{
   if(before)for await(const row of descendants(previous,before,options))yield {before:row,after:null};
   if(after)for await(const row of descendants(document,after,options))yield {before:null,after:row};
  }
 }
}
export class ConfigurationIndex{
 constructor(document,value){
  if(!value||value.version!==1||value.source!==document.root||!validTableRef(value.root))fail();
  this.document=document;this.value=value;this.table=new RetainedTableIndex(document.blocks,{namespace:'index',allowSparseBranches:true});
 }
 async row(entry,{signal}={}){
  if(!entry)fail();signal?.throwIfAborted();const node=await this.document.tree.node(entry.revision),row=node.value;
  if(node.type!=='inline'||row?.configurationRow!==1||!configurationCollections.includes(row.collection)||!natural(row.position)||!Array.isArray(row.path)||!rowKeys(row).includes(entry.id))fail();
  const context=row.collection==='fields'?{sectionId:row.sectionId}:row.collection==='choices'?{sectionId:row.sectionId,fieldKey:row.fieldKey}:{};
  const expected=await configurationSourceRow(this.document,row.collection,row.path,row.position,context,{signal,draft:true});
  if(serialize(expected)!==serialize(row))fail();return row;
 }
 async get(query,{signal}={}){signal?.throwIfAborted();const entry=await this.table.find(this.value,configurationIdentityKey(query));return entry?this.row(entry,{signal}):null;}
 async section(profileId,key,{signal}={}){const entry=await this.table.find(this.value,'s:'+profileKey(profileId)+':'+key);return entry?this.row(entry,{signal}):null;}
 async range(prefix,{signal}={}){signal?.throwIfAborted();const start=await this.table.rank(this.value,prefix),end=await this.table.rank(this.value,prefix+'\uffff');return {start,total:end-start};}
 async count(query,options={}){return (await this.range(configurationOrderPrefix(query),options)).total;}
 async *rows(query,{offset=0,limit=Infinity,signal}={}){
  if(!natural(offset)||limit!==Infinity&&!natural(limit))invalid();const prefix=configurationOrderPrefix(query),range=await this.range(prefix,{signal});
  for(let i=offset;i<Math.min(range.total,offset+limit);i++){
   signal?.throwIfAborted();const entry=await this.table.entryAt(this.value,range.start+i);if(!entry?.id.startsWith(prefix))fail();yield await this.row(entry,{signal});
  }
 }
 async verify({signal,draft=false}={}){
  let total=0;for(const collection of ['profiles','sections'])for await(const row of configurationRows(this.document,collection,[collection],{},{signal,draft})){
   const revision=stamp({type:'inline',value:row}),stored=await this.document.tree.node(revision);
   if(stored.type!=='inline'||serialize(stored.value)!==serialize(row))fail();
   for(const key of rowKeys(row)){if((await this.table.find(this.value,key))?.revision!==revision)fail();total++;}
   if(row.collection==='sections'&&row.value.profileId!==null&&!await this.get({collection:'profiles',key:row.value.profileId},{signal}))fail();
   if(!draft&&row.collection==='fields'&&row.value.type==='select'&&!row.counts.choices)invalid();
  }
  if(total!==(this.value.root?.count??0))fail();
  // Each distinct source key and its stored row have been authenticated above.
  // Check tree structure without deriving each source row again for every key.
  for await(const node of this.table.nodes(this.value.root,{signal})){void node;}
 }
 static async retain(document,{previous=null,signal,draft=true}={}){
  if(previous?.source===document.root)return previous;
  const value={version:1,source:document.root,root:previous?.root??null},table=new RetainedTableIndex(document.blocks,{namespace:'index',allowSparseBranches:true});
  const old=previous?new RecordDocument(document.blocks,previous.source):null;
  async function* changes(){for(const collection of ['profiles','sections']){
   if(old)yield* changedRows(document,old,collection,[collection],{},{signal,draft});
   else for await(const row of configurationRows(document,collection,[collection],{},{signal,draft}))yield {before:null,after:row};
  }}
  for(const removing of [true,false]){
   if(removing&&!old)continue;let pending=0;
   for await(const change of changes()){
    signal?.throwIfAborted();const row=removing?change.before:change.after;if(!row)continue;
    if(removing){const revision=stamp({type:'inline',value:row});for(const key of rowKeys(row)){if((await table.find(value,key))?.revision!==revision)fail();value.root=await table.remove(value.root,key);}}
    else{for(const key of uniqueKeys(row))if(await table.find(value,key))invalid();const revision=await document.tree.retain(row);for(const key of rowKeys(row))value.root=await table.change(value.root,key,revision);}
    if(++pending===32){await table.flush(value.root);pending=0;}
   }await table.flush(value.root);
  }
  return value;
 }
}
