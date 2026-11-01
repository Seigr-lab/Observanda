import {setTimeout as wait} from 'node:timers/promises';
import {ModuleCatalogue} from './catalogue.js';
import {InventoryProjection,inventoryContributions,applyInventoryContribution} from './inventory-projection.js';
import {projectModuleDomainReader} from '../project-module-domain-reader.js';
import {moduleStateRow} from './read-state.js';
import {digest,serialize} from '../storage-format.js';
import {researchId} from '../web/research-reference.js';
import {AppError} from '../errors.js';

const hash=value=>digest(serialize(value)),revision=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value),integer=value=>Number.isSafeInteger(value)&&value>=0;
const damaged=()=>{throw new AppError('JOB_DAMAGED');},stale=()=>{throw new AppError('CONFLICT');};
const inventoryTypes=new Set(['resource','movement','reservation','stock-transfer','bom']);
const memberCount=head=>head.memberVersion===1?head.root?.count??0:head.entities.length;
const directory=id=>{if(!researchId(id))throw new AppError('INVALID');return '.observanda/inventory-maintenance/'+id;};

// Each invocation owns a short catalogue snapshot. Dedicated domains borrow
// that snapshot; no read transaction survives a checkpoint or foreground turn.
export async function inventorySources(workspace,operation){
 return workspace.catalogue(async research=>{
  const owner=(await research.snapshot()).metadata.id,reader=await projectModuleDomainReader(research);
  if(!reader)return operation([{domain:'legacy',namespaceId:owner,catalogue:new ModuleCatalogue(research)}],owner);
  return reader.run(async context=>{
   const sources=[];for(const domain of ['bom','inventory'])if(reader.registry.domains.includes(domain))sources.push({domain,namespaceId:reader.registry.namespaceId,catalogue:new ModuleCatalogue(await context.inspect(domain))});
   return operation(sources,owner);
  });
 });
}
async function sourceHead(source,full){
 if(full)return source.catalogue.head(source.namespaceId);
 const store=source.catalogue.store,row=await moduleStateRow(store,'modules');
 return row?store.decode('state','modules',row.payload):{workspaceId:source.namespaceId,revision:0,entities:[]};
}
async function capture(sources){
 const values=[];for(const source of sources){const head=await sourceHead(source,true),count=memberCount(head);if(count&&!head.stockIndex)throw new AppError('STORAGE_UPGRADE_REQUIRED');values.push({domain:source.domain,namespaceId:source.namespaceId,head:hash(head),revision:head.revision,members:count,rows:head.stockIndex?.root?.count??0});}return values;
}
async function admitted(sources,state,owner,{full=false}={}){
 if(owner!==state.owner||sources.length!==state.sources.length)stale();const heads=[];
 for(let i=0;i<sources.length;i++){const source=sources[i],expected=state.sources[i],head=await sourceHead(source,full);if(source.domain!==expected.domain||source.namespaceId!==expected.namespaceId||hash(head)!==expected.head)stale();heads.push(head);}return heads;
}
export function validateInventoryCheckpoint(value,id,owner){
 const fields='attempt,checked,counts,format,id,member,offset,owner,phase,previous,read,reset,sequence,source,sources';
 if(!value||Object.keys(value).sort().join()!==fields||value.format!==1||value.id!==id||value.owner!==owner||!researchId(owner)||!['build','compare','cleanup','ready','reset','restart','stale'].includes(value.phase)||!['attempt','checked','member','offset','read','reset','sequence','source'].every(key=>integer(value[key]))||value.attempt<1||!Array.isArray(value.sources)||value.sources.length>2||!Array.isArray(value.counts)||value.counts.length!==value.sources.length||!value.counts.every(integer)||value.previous!==null&&(!integer(value.previous.read)||!integer(value.previous.checked))||value.source>value.sources.length)damaged();
 for(const source of value.sources)if(!source||Object.keys(source).sort().join()!=='domain,head,members,namespaceId,revision,rows'||!['legacy','bom','inventory'].includes(source.domain)||!researchId(source.namespaceId)||!revision(source.head)||!['members','revision','rows'].every(key=>integer(source[key])))damaged();
 if(new Set(value.sources.map(source=>source.domain)).size!==value.sources.length)damaged();
 const members=value.sources.reduce((sum,source)=>sum+source.members,0),rows=value.sources.reduce((sum,source)=>sum+source.rows,0),source=value.sources[value.source];
 if(!integer(members+rows)||value.read>members||value.checked>rows||value.previous!==null&&Object.keys(value.previous).sort().join()!=='checked,read')damaged();
 if(value.phase==='build'&&(!source&&(value.source!==0||value.member||value.offset)||source&&(value.member>source.members||value.offset>0&&value.member>=source.members)))damaged();
 if(value.phase==='compare'&&(value.offset||value.member>(source?.rows??0))||['cleanup','ready'].includes(value.phase)&&(value.source!==value.sources.length||value.member||value.offset||value.read!==members||value.checked!==rows))damaged();return value;
}

export class InventoryReconciliation{
 constructor(workspace,job,{sources=inventorySources,batch=32,contributions=128}={}){
  if(!Number.isSafeInteger(batch)||batch<1||batch>64||!Number.isSafeInteger(contributions)||contributions<1||contributions>256)throw new AppError('INVALID');
  this.workspace=workspace;this.job=job;this.sources=sources;this.batch=batch;this.contributions=contributions;this.base=directory(job.id);this.file=this.base+'/checkpoint.json';
 }
 async read(){const raw=await this.workspace.readMetadata(this.file,65536);if(raw===null)return null;let value;try{value=JSON.parse(raw);}catch{damaged();}return validateInventoryCheckpoint(value,this.job.id,this.job.scope);}
 async save(state){validateInventoryCheckpoint(state,this.job.id,this.job.scope);await this.workspace.writeMetadata(this.file,serialize(state));}
 values(source){return this.base+'/values/'+source;}
 async initialize(){
  const previous=await this.read();if(previous)return previous;
  const state=await this.sources(this.workspace,async(sources,owner)=>{if(owner!==this.job.scope)throw new AppError('JOB_CHANGED');const bound=await capture(sources);return {format:1,id:this.job.id,owner,attempt:this.job.attempt,sequence:0,phase:'build',sources:bound,counts:bound.map(()=>0),source:0,member:0,offset:0,read:0,checked:0,reset:0,previous:null};});await this.save(state);return state;
 }
 async transaction(expected,operation,{check=true,captureSources=false}={}){
  const current=await this.read();if(!current||current.sequence!==expected.sequence)throw new AppError('JOB_CHANGED');
  const bound=await this.sources(this.workspace,async(sources,owner)=>{if(owner!==current.owner)throw new AppError('JOB_CHANGED');if(check)await admitted(sources,current,owner);return captureSources?capture(sources):null;});
  // Domain readers restore the research schema before metadata writes. The
  // caller's fenced writer still holds the same database transaction here.
  await operation(current,bound);current.sequence++;await this.save(current);return current;
 }
 async buildSlice(state,{signal}={}){
  return this.sources(this.workspace,async(sources,owner)=>{
   const heads=await admitted(sources,state,owner),source=sources[state.source],head=heads[state.source],items=[];let memberAt=state.member,offset=state.offset,read=0;
   if(!source)return {items,member:0,offset:0,read:0,finished:true};
   while(memberAt<state.sources[state.source].members&&read<this.batch&&items.length<this.contributions){
    signal?.throwIfAborted();const member=head.memberVersion===1?await source.catalogue.membersIndex.decode(head,await source.catalogue.membersIndex.tree.entryAt(head,memberAt)):head.entities[memberAt];if(!member)damaged();
    if(member.type&&!inventoryTypes.has(member.type)){memberAt++;offset=0;read++;continue;}
    // Authenticate the original and all of its derived inventory facts. One
    // existing module-sized body is retained at a time; the contribution list
    // itself is bounded independently of ledger size and BOM line count.
    const key=state.sources[state.source].head+':'+member.id;
    if(this.pendingSource?.key!==key||this.pendingSource.offset!==offset){
     const entity=await source.catalogue.selected(head,member.id),iterator=inventoryContributions(entity,head.workspaceId);this.pendingSource={key,iterator,offset,pending:null};
     for(let skipped=0;skipped<offset;skipped++){signal?.throwIfAborted();if(iterator.next().done)damaged();if(skipped&&skipped%1024===0)await wait(0,undefined,{signal});}
    }
    let finished=true;
    for(;;){
     signal?.throwIfAborted();const next=this.pendingSource.pending??this.pendingSource.iterator.next();this.pendingSource.pending=null;
     if(next.done){this.pendingSource=null;break;}
     if(items.length===this.contributions){this.pendingSource.pending=next;finished=false;break;}items.push(next.value);offset++;this.pendingSource.offset=offset;
    }
    if(!finished)break;memberAt++;offset=0;read++;
   }
   return {items,member:memberAt,offset,read,finished:memberAt===state.sources[state.source].members};
  });
 }
 async applySlice(state,slice){
  return this.transaction(state,async current=>{
   const changes=new Map(),prefix=this.values(current.source),change=async(id,update)=>{
    if(!changes.has(id)){const raw=await this.workspace.readMetadata(prefix+'/'+digest(id)+'.json',16384);let before=null;if(raw!==null){try{before=JSON.parse(raw);}catch{damaged();}if(before?.id!==id||!before.value)damaged();}changes.set(id,{before:before?.value??null,value:before?.value??null});}
    const entry=changes.get(id);entry.value=update(entry.value);
   };
   for(const item of slice.items)await applyInventoryContribution(change,item,1);
   for(const [id,entry] of changes){const file=prefix+'/'+digest(id)+'.json';current.counts[current.source]+=Number(entry.value!==null)-Number(entry.before!==null);if(entry.value===null){if(entry.before!==null)await this.workspace.removeMetadata(file);}else await this.workspace.writeMetadata(file,serialize({id,value:entry.value}));}
   current.member=slice.member;current.offset=slice.offset;current.read+=slice.read;
   if(slice.finished&&current.sources.length){current.source++;current.member=0;current.offset=0;}
   if(current.source===current.sources.length){if(current.counts.some((value,index)=>value!==current.sources[index].rows))throw new AppError('CATALOGUE_DAMAGED');current.phase='compare';current.source=0;}
  });
 }
 async compareSlice(state,{signal}={}){
  const slice=await this.sources(this.workspace,async(sources,owner)=>{
   const heads=await admitted(sources,state,owner);if(state.source===sources.length)return {count:0,done:true,values:[]};
   const source=sources[state.source],index=new InventoryProjection(source.catalogue),head=heads[state.source],values=[];
   // Compare by the projection's authenticated ordinal so resume does not
   // rescan already checked accumulator keys or rely on an unauthenticated SQL cursor.
   const end=Math.min(state.member+this.batch,state.sources[state.source].rows);
   for(let at=state.member;at<end;at++){signal?.throwIfAborted();const entry=await index.tree.entryAt(head.stockIndex,at);if(!entry)damaged();values.push({id:entry.id,hash:hash(await index.value(entry))});}
   return {count:end-state.member,member:end,done:end===state.sources[state.source].rows,values};
  });
  for(const entry of slice.values){signal?.throwIfAborted();const raw=await this.workspace.readMetadata(this.values(state.source)+'/'+digest(entry.id)+'.json',16384);if(raw===null)throw new AppError('CATALOGUE_DAMAGED');let expected;try{expected=JSON.parse(raw);}catch{damaged();}if(expected.id!==entry.id||entry.hash!==hash(expected.value))throw new AppError('CATALOGUE_DAMAGED');}return slice;
 }
 async recordComparison(state,slice){return this.transaction(state,current=>{current.member=slice.member??0;current.checked+=slice.count;if(slice.done&&current.source<current.sources.length){current.source++;current.member=0;}if(current.source===current.sources.length){current.phase='cleanup';current.member=0;}});}
 async cleanSlice(state){
  return this.transaction(state,async current=>{const page=await this.workspace.metadataPage(this.base+'/values',{limit:this.batch});for(const item of page.items)await this.workspace.removeMetadata(this.base+'/values/'+item.name);if(!page.next)current.phase=current.phase==='reset'?'restart':'ready';}, {check:false});
 }
 async reset(state){
  this.pendingSource=null;
  return this.transaction(state,async current=>{
   current.phase='reset';current.previous={read:current.read,checked:current.checked};current.reset=current.attempt===this.job.attempt?current.reset+1:1;current.attempt=this.job.attempt;
   if(current.reset>2)current.phase='stale';
  },{check:false});
 }
 async restart(state){return this.transaction(state,async(current,sources)=>{current.sources=sources;current.counts=current.sources.map(()=>0);current.source=0;current.member=0;current.offset=0;current.read=0;current.checked=0;current.phase='build';},{check:false,captureSources:true});}
 async prepare(options){try{return await this.run(options);}finally{this.pendingSource=null;}}
 async run({signal,write,progress=async()=>{}}){
  let state=await write(()=>this.initialize());
  if(state.phase==='stale'){if(state.attempt===this.job.attempt)throw new AppError('CONFLICT');state=await write(()=>this.reset(state));}
  for(;;){
   signal?.throwIfAborted();await progress({stage:state.phase,done:state.read+state.checked,total:state.sources.reduce((sum,value)=>sum+value.members+value.rows,0)});
   try{
    if(state.phase==='build'){const slice=await this.buildSlice(state,{signal});state=await write(()=>this.applySlice(state,slice));}
    else if(state.phase==='compare'){const slice=await this.compareSlice(state,{signal});state=await write(()=>this.recordComparison(state,slice));}
    else if(state.phase==='cleanup'||state.phase==='reset')state=await write(()=>this.cleanSlice(state));
    else if(state.phase==='restart')state=await write(()=>this.restart(state));
    else if(state.phase==='ready'){await this.sources(this.workspace,(sources,owner)=>admitted(sources,state,owner));return {checkpoint:state.sequence,owner:state.owner,sources:state.sources.map(({domain,revision,members,rows})=>({domain,revision,members,rows})),members:state.read,rows:state.checked,restarts:state.reset};}
    else throw new AppError('CONFLICT');
   }catch(error){if(error.code!=='CONFLICT')throw error;state=await write(()=>this.reset(state));if(state.phase==='stale'){await progress({stage:'stale',done:state.read+state.checked,total:state.sources.reduce((sum,value)=>sum+value.members+value.rows,0)});throw error;}await wait(Math.min(500,100*state.reset),undefined,{signal});}
   // Cooperative scheduling is between committed slices and released snapshots.
   signal?.throwIfAborted();
   await wait(0,undefined,{signal});
  }
 }
 async commit(prepared){
  const state=await this.read();if(!state||state.phase!=='ready'||state.sequence!==prepared.checkpoint)throw new AppError('JOB_CHANGED');
  await this.sources(this.workspace,(sources,owner)=>admitted(sources,state,owner,{full:true}));
  return {...prepared,verified:true};
 }
}
