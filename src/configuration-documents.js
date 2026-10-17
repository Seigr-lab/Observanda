import {randomUUID} from 'node:crypto';
// Schema references are pinned in research snapshot members. A reader never
// substitutes a newer schema, and no selected response includes child arrays.
import {ConfigurationValueBlocks,CONFIGURATION_BLOCK_PREFIX} from './configuration-block-store.js';
import {ConfigurationIndex,configurationObjectHeader} from './configuration-index.js';
import {RecordDocument} from './record-document.js';
import {copyRecordValue} from './record-document-copy.js';
import {retainRecordContainer} from './record-tree-values.js';
import {RetainedTableIndex} from './retained-table-index.js';
import {digest,serialize} from './storage-format.js';
import {AppError} from './errors.js';
import {retainRecordOwnerResource} from './record-owner-resources.js';
import {configurationBlockResource} from './configuration-block-store.js';
import {validConfigurationOwner,isConfigurationReference,validConfigurationReference} from './web/configuration-reference.js';
import {configurationCollections,validConfigurationProfile,validConfigurationSection,validConfigurationField,validConfigurationChoice} from './web/configuration-model.js';
const invalid=()=>{throw new AppError('INVALID');},damaged=()=>{throw new AppError('CATALOGUE_DAMAGED');};
const same=(a,b)=>serialize(a)===serialize(b),stamp=value=>digest(serialize(value));
const natural=value=>Number.isSafeInteger(value)&&value>=0;
const sectionId=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const fieldKey=value=>typeof value==='string'&&/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(value)&&!['constructor','prototype','__proto__'].includes(value);
const profileId=value=>typeof value==='string'&&/^[a-z][a-z0-9-]{0,79}$/.test(value);
async function admit(store,write){
 const {requireConfigurationDocuments}=await import('./catalogue-format.js');
 if(typeof requireConfigurationDocuments!=='function')throw new AppError('ACCESS_UPGRADE');
 if(write)await write(target=>requireConfigurationDocuments(target.db));else await requireConfigurationDocuments(store.db);
}
function queryValid(query,{key=false}={}){
 if(!query||!configurationCollections.includes(query.collection)||['fields','choices'].includes(query.collection)&&!sectionId(query.sectionId)||query.collection==='choices'&&!fieldKey(query.fieldKey))invalid();
 if(key&&!(query.collection==='profiles'?profileId(query.key):query.collection==='sections'?sectionId(query.key):query.collection==='fields'?fieldKey(query.key):typeof query.key==='string'&&query.key.length<=160))invalid();
}
const projectRow=row=>row?{key:row.key,position:row.position,revision:row.source,value:structuredClone(row.value),...(row.counts?{counts:{...row.counts}}:{})}:null;
export async function* configurationDocumentNodes(source,root,indexRoot,{signal}={}){
 const seen=new Map(),table=new RetainedTableIndex(source.blocks,{namespace:'index',allowSparseBranches:true});
 const kept=key=>{if(seen.has(key))return true;return false;},remember=key=>{while(seen.size>=1024)seen.delete(seen.keys().next().value);seen.set(key,true);};
 const value=async function* (revision){
  signal?.throwIfAborted();const key='value:'+revision;if(kept(key))return;const node=await source.tree.node(revision);
  if(['item','property'].includes(node.type))yield* value(node.value);else if(node.root)yield* index(node.root);else if(node.type==='inline'&&node.value?.configurationRow===1)yield* value(node.value.source);
  yield {kind:'value',revision,node};remember(key);
 };
 const index=async function* (ref){
  if(!ref)return;signal?.throwIfAborted();const key='index:'+ref.hash;if(kept(key))return;const node=await table.node(ref);
  if(node.children)for(const child of node.children)yield* index(child);else for(const entry of node.entries)yield* value(entry.revision);
  yield {kind:'index',revision:ref.hash,node};remember(key);
 };
 yield* value(root);yield* index(indexRoot);
}
async function copyNodes(source,destination,root,indexRoot,options){
 for await(const {kind,revision,node} of configurationDocumentNodes(source,root,indexRoot,options))if(await destination.blocks.put(kind,node)!==revision)damaged();
}

export class ConfigurationReader{
 constructor(owner,document,descriptor,index,{signal}={}){this.owner=owner;this.document=document;this.descriptor=descriptor;this.index=index;this.signal=signal;this.revision=descriptor?stamp(descriptor):null;}
 async header({signal=this.signal}={}){
  const counts={};for(const collection of configurationCollections)counts[collection]=(await this.index.range('o:'+collection+':',{signal})).total;return {counts};
 }
 async item(query){queryValid(query,{key:true});return projectRow(await this.index.get(query,{signal:query.signal??this.signal}));}
 async section(query,{signal=this.signal}={}){
  if(query?.id)return this.item({collection:'sections',key:query.id,signal});
  if(!query||query.profileId!==null&&!profileId(query.profileId)||!profileId(query.key))invalid();return projectRow(await this.index.section(query.profileId,query.key,{signal}));
 }
 async window(query){
  queryValid(query);const {offset=0,limit=20,query:search='',available,profileId:profile,allowedProfiles,signal=this.signal}=query;
  if(!natural(offset)||!Number.isSafeInteger(limit)||limit<1||limit>32||typeof search!=='string'||search.length>160||available!==undefined&&typeof available!=='boolean'||profile!==undefined&&profile!==null&&!profileId(profile))invalid();
  if(allowedProfiles!==undefined&&(query.collection!=='sections'||!Array.isArray(allowedProfiles)||!allowedProfiles.every(profileId)||new Set(allowedProfiles).size!==allowedProfiles.length))invalid();
  const allowed=allowedProfiles===undefined?null:new Set(allowedProfiles),filtered=!!search||available!==undefined||profile!==undefined||allowed!==null,rows=[];
  if(!filtered){const total=await this.index.count(query,{signal});for await(const row of this.index.rows(query,{offset,limit,signal}))rows.push(projectRow(row));return {rows,total,offset,next:offset+rows.length<total?offset+rows.length:null};}
  let total=0;const normalized=search.toLocaleLowerCase();
  for await(const row of this.index.rows(query,{signal})){
   const value=row.value;if(allowed&&value.profileId!==null&&!allowed.has(value.profileId))continue;if(profile!==undefined&&(query.collection!=='sections'||value.profileId!==profile))continue;
   if(available!==undefined){let enabled=value?.enabled??true;if(row.collection==='sections'&&value.profileId!==null)enabled=enabled&&!!(await this.index.get({collection:'profiles',key:value.profileId},{signal}))?.value.enabled;if(enabled!==available)continue;}
   if(normalized&&!String(typeof value==='string'?value:value.label??value.id??value.key).toLocaleLowerCase().includes(normalized))continue;
   if(total>=offset&&rows.length<limit)rows.push(projectRow(row));total++;
  }
  return {rows,total,offset,next:offset+rows.length<total?offset+rows.length:null};
 }
 async collectionPath(query,{signal=this.signal}={}){
  queryValid(query);if(['profiles','sections'].includes(query.collection))return [query.collection];
  const section=await this.index.get({collection:'sections',key:query.sectionId},{signal});if(!section)throw new AppError('NOT_FOUND');
  if(query.collection==='fields')return [...section.path,'fields'];
  const field=await this.index.get({collection:'fields',sectionId:query.sectionId,key:query.fieldKey},{signal});if(!field)throw new AppError('NOT_FOUND');return [...field.path,'choices'];
 }
 async sectionReference(query,{signal=this.signal}={}){
  const row=query?.id?await this.index.get({collection:'sections',key:query.id},{signal}):await this.index.section(query.profileId,query.key,{signal});
  return row?{...projectRow(row),reference:row.source,fields:await this.document.reference([...row.path,'fields'],{signal})}:null;
 }
}
export class ConfigurationDocuments{
 constructor(store,{write=null}={}){this.store=store;this.write=write;}
 async open(owner,value,{mutable=false,signal,draft=false}={}){
  if(!validConfigurationOwner(owner))invalid();signal?.throwIfAborted();
  if(isConfigurationReference(value)){
   if(!validConfigurationReference(value,owner))damaged();const blocks=new ConfigurationValueBlocks(this.store,{readOnly:!mutable,write:this.write,signal}),document=new RecordDocument(blocks,value.root,{mutable});
   await this.validateShape(document,{signal});return new ConfigurationReader(structuredClone(owner),document,structuredClone(value),new ConfigurationIndex(document,value.index),{signal});
  }
  // Legacy inline data is already admitted under its historical metadata budget.
  // Derived nodes remain in a private read overlay until an explicit mutation.
  const blocks=new ConfigurationValueBlocks(this.store,{readOnly:true,temporary:true,signal}),document=new RecordDocument(blocks,await blocks.tree().retain(value),{mutable:false});
  await this.validateShape(document,{signal});const index=await ConfigurationIndex.retain(document,{signal,draft}),reader=new ConfigurationReader(structuredClone(owner),document,null,new ConfigurationIndex(document,index),{signal});
  await this.validate(reader,{signal,draft});reader.revision=stamp(value);return reader;
 }
 async validateShape(document,{signal}={}){
  const header=await configurationObjectHeader(document,[],['profiles','sections'],{signal,allowed:[]});if(Object.keys(header).length)invalid();
  await document.tree.arrayLength(document.root,['profiles']);await document.tree.arrayLength(document.root,['sections']);
 }
 async validate(reader,{signal,draft=false}={}){
  const document=reader.document??reader;await this.validateShape(document,{signal});
  const index=reader.index??new ConfigurationIndex(document,await ConfigurationIndex.retain(document,{signal,draft}));
  await index.verify({signal,draft});return reader.header?reader.header({signal}):null;
 }
 async retainInline(owner,value,{signal,draft=false}={}){
  const source=await this.open(owner,value,{signal,draft});if(source.descriptor)return source.descriptor;
  return this.clone(owner,source,{signal,draft});
 }
 async retain(owner,document,{previous=null,signal,draft=true}={}){
  if(!validConfigurationOwner(owner))invalid();signal?.throwIfAborted();await admit(this.store,this.write);await this.validateShape(document,{signal});
  const index=await ConfigurationIndex.retain(document,{previous:previous?.index??previous,signal,draft});await document.blocks.flush();
  const adopt=async store=>{await retainRecordOwnerResource(store,configurationBlockResource('value',document.root),{present:true});if(index.root)await retainRecordOwnerResource(store,configurationBlockResource('index',index.root.hash),{present:true});};
  if(this.write)await this.write(adopt);else await adopt(this.store);
  return {format:'observanda-configuration',version:1,owner:structuredClone(owner),root:document.root,index};
 }
 async writable(reader,{signal}={}){
  signal?.throwIfAborted();await admit(this.store,this.write);
  const blocks=new ConfigurationValueBlocks(this.store,{write:this.write,signal});
  if(reader.descriptor&&reader.document.blocks.store===this.store)return new RecordDocument(blocks,reader.document.root,{mutable:true});
  const document=new RecordDocument(blocks,null,{mutable:true});document.root=await copyRecordValue(reader.document,document,reader.document.root,{signal});await blocks.flush();return document;
 }
 async clone(owner,source,{freshSectionIds=false,uuid,signal,draft=false}={}){
  if(!validConfigurationOwner(owner)||!(source instanceof ConfigurationReader)||freshSectionIds&&typeof uuid!=='function')invalid();signal?.throwIfAborted();await admit(this.store,this.write);
  const blocks=new ConfigurationValueBlocks(this.store,{write:this.write,signal}),document=new RecordDocument(blocks,null,{mutable:true});
  if(!freshSectionIds){document.root=source.document.root;await copyNodes(source.document,document,document.root,source.index.value.root,{signal});}
  else{
   const profiles=await copyRecordValue(source.document,document,await source.document.reference(['profiles'],{signal}),{signal});
   async function* sections(){for await(const row of source.index.rows({collection:'sections'},{signal})){
    const value={...row.value,id:uuid===randomUUID?uuid():uuid(row.key)},fields=await copyRecordValue(source.document,document,await source.document.reference([...row.path,'fields'],{signal}),{signal});
    if(!validConfigurationSection(value,{draft}))invalid();
    async function* properties(){for(const name of await source.document.tree.propertyNames(row.source)){yield {name,value:name==='fields'?fields:await document.tree.retain(value[name])};}}
    yield {value:await retainRecordContainer(blocks,'object',properties(),{signal})};
   }}
   const sectionRoot=await retainRecordContainer(blocks,'array',sections(),{signal});
   document.root=await retainRecordContainer(blocks,'object',(async function*(){for(const name of await source.document.tree.propertyNames(source.document.root))yield {name,value:name==='profiles'?profiles:sectionRoot};})(),{signal});
  }
  return this.retain(owner,document,{previous:freshSectionIds?null:source.index.value,signal,draft});
 }
 async applySelected(reader,operations,{signal,draft=true}={}){
  if(!(reader instanceof ConfigurationReader)||!Array.isArray(operations)||!operations.length||operations.length>32)invalid();
  let document=await this.writable(reader,{signal}),previous=reader.descriptor;
  if(!previous||previous.root!==document.root){previous=await this.retain(reader.owner,document,{signal,draft:true});}
  let current=new ConfigurationReader(reader.owner,document,previous,new ConfigurationIndex(document,previous.index),{signal});
  for(const operation of operations){
   signal?.throwIfAborted();if(!operation||!['append','replace','remove','move'].includes(operation.type))invalid();queryValid(operation,{key:operation.type!=='append'});
   const {collection}=operation,path=await current.collectionPath(operation,{signal}),row=operation.type==='append'?null:await current.index.get(operation,{signal});if(operation.type!=='append'&&!row)throw new AppError('NOT_FOUND');
   if(operation.type==='append'){
    let value=structuredClone(operation.value);
    if(collection==='sections'&&value&&!Object.hasOwn(value,'fields'))value.fields=[];
    if(collection==='fields'&&value&&!Object.hasOwn(value,'choices'))value.choices=[];
    if(collection==='sections'&&value?.profileId!==null&&!await current.index.get({collection:'profiles',key:value?.profileId},{signal}))invalid();
    const position=await document.tree.arrayLength(document.root,path);document=await document.splice(path,position,0,[value],{signal});
   }else if(operation.type==='replace'){
    if(collection==='choices'){if(!validConfigurationChoice(operation.value,{draft}))invalid();document=await document.replace(row.path,operation.value,{signal});}
    else{
     if(!operation.value||typeof operation.value!=='object'||Array.isArray(operation.value)||Object.keys(operation.value).some(name=>['fields','choices'].includes(name)))invalid();
     const value={...row.value,...operation.value};
     if(operation.remove!==undefined){if(collection!=='fields'||!Array.isArray(operation.remove)||operation.remove.length!==1||operation.remove[0]!=='numeric'||Object.hasOwn(operation.value,'numeric'))invalid();delete value.numeric;}
     if(collection!=='fields'&&value.id!==row.value.id)invalid();
     if(!(collection==='profiles'?validConfigurationProfile(value):collection==='sections'?validConfigurationSection(value,{draft}):validConfigurationField(value,{draft})))invalid();
     if(collection==='sections'&&value.profileId!==null&&!await current.index.get({collection:'profiles',key:value.profileId},{signal}))invalid();
     for(const [name,item] of Object.entries(operation.value))document=await document.property(row.path,name,item,{signal});
     for(const name of operation.remove??[])document=await document.property(row.path,name,null,{remove:true,signal});
    }
   }else if(operation.type==='remove'){
    if(collection==='profiles'&&(await current.index.range('p:'+row.key+':',{signal})).total)invalid();document=await document.splice(path,row.position,1,[],{signal});
   }else{
    let destination;
    if(operation.direction!==undefined){
     if(collection!=='sections'||![-1,1].includes(operation.direction))invalid();const prefix='p:'+(row.value.profileId??'~')+':',range=await current.index.range(prefix,{signal});
     let chosen=null;for(let at=0;at<range.total;at++){const candidate=await current.index.row(await current.index.table.entryAt(current.index.value,range.start+at),{signal});if(candidate.value.enabled&&(operation.direction<0?candidate.position<row.position:candidate.position>row.position)){chosen=candidate;if(operation.direction>0)break;}}
     if(!chosen)continue;destination=chosen.position;
     const other=await document.reference([...path,String(destination)],{signal}),mine=await document.reference(row.path,{signal});
     document=new RecordDocument(document.blocks,await document.replaceReference(document.root,row.path,other,{signal}),{mutable:true});
     document=new RecordDocument(document.blocks,await document.replaceReference(document.root,[...path,String(destination)],mine,{signal}),{mutable:true});
    }else{
     const before=operation.beforeKey==null?null:await current.index.get({...operation,key:operation.beforeKey},{signal});if(operation.beforeKey!=null&&!before)throw new AppError('NOT_FOUND');
     destination=before?.position??await document.tree.arrayLength(document.root,path);if(destination===row.position||destination===row.position+1)continue;
     const source=document,moving=await document.reference(row.path,{signal});
     async function* children(){for await(const item of source.items(path,{signal})){if(item.index===destination)yield {value:moving};if(item.index!==row.position)yield item;}if(destination===await source.tree.arrayLength(source.root,path))yield {value:moving};}
     const root=await retainRecordContainer(document.blocks,'array',children(),{signal});document=new RecordDocument(document.blocks,await document.replaceReference(document.root,path,root,{signal}),{mutable:true});
    }
   }
   const descriptor=await this.retain(reader.owner,document,{previous,signal,draft});previous=descriptor;current=new ConfigurationReader(reader.owner,document,descriptor,new ConfigurationIndex(document,descriptor.index),{signal});
  }
  return previous;
 }
 async verify(owner,pointer,{signal,draft=false}={}){
  try{if(!validConfigurationReference(pointer,owner))damaged();const reader=await this.open(owner,pointer,{signal,draft});await this.validate(reader,{signal,draft});return reader;}
  catch(error){signal?.throwIfAborted();if(error.code==='CATALOGUE_DAMAGED')throw error;throw new AppError('CATALOGUE_DAMAGED');}
 }
}
export async function withConfigurationDocument(store,owner,value,operation,{write=null,...options}={}){return operation(await new ConfigurationDocuments(store,{write}).open(owner,value,options));}
export async function verifyConfigurationBlocks(store,{signal}={}){
 try{return await checkConfigurationBlocks(store,{signal});}catch(error){signal?.throwIfAborted();if(error.code==='CATALOGUE_DAMAGED')throw error;throw new AppError('CATALOGUE_DAMAGED');}
}
async function checkConfigurationBlocks(store,{signal}={}){
 const blocks=new ConfigurationValueBlocks(store,{readOnly:true,signal}),tree=blocks.tree(),index=new RetainedTableIndex(blocks,{namespace:'index',allowSparseBranches:true});let cursor='';
 for(;;){
  signal?.throwIfAborted();const rows=await store.db.all('SELECT slot,payload FROM state WHERE slot LIKE $1 AND slot>$2 ORDER BY slot LIMIT 64',CONFIGURATION_BLOCK_PREFIX+'%',cursor);if(!rows.length)break;
  if(!cursor){const {catalogueFormat,catalogueRequiresConfigurationDocuments}=await import('./catalogue-format.js');if(!catalogueRequiresConfigurationDocuments(await catalogueFormat(store.db)))damaged();}
  for(const row of rows){
   signal?.throwIfAborted();const match=/^configuration-block:(value|index):([a-f0-9]{64})$/.exec(row.slot);if(!match)damaged();const node=blocks.decode(row.slot,row.payload,match[2]);
   if(match[1]==='value'){const value=await tree.node(match[2]);if(['item','property'].includes(value.type))await tree.node(value.value);else if(value.root)await index.node(value.root);else if(value.type==='inline'&&value.value?.configurationRow===1)await tree.node(value.value.source);}
   else{
    if(node?.entries){const ref={hash:match[2],count:node.entries.length,height:1,first:node.entries[0]?.id,last:node.entries.at(-1)?.id};index.validate(node,ref);for(const entry of node.entries)await tree.node(entry.revision);}
    else if(node?.children){const ref={hash:match[2],count:node.children.reduce((n,child)=>n+child.count,0),height:(node.children[0]?.height??0)+1,first:node.children[0]?.first,last:node.children.at(-1)?.last};index.validate(node,ref);for(const child of node.children)await index.node(child);}
    else damaged();
   }
   cursor=row.slot;
  }
 }
}
