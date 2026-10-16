// FileList objects remain in the browser. Fingerprints and sorted metadata are
// paged from this encrypted immutable index; no selected set is returned whole.
import {AppError} from './errors.js';
import {ObjectIndex,validIndexRef} from './object-index.js';
import {digest,serialize} from './storage-format.js';
import {researchId} from './web/research-reference.js';
import {validEvidenceFile,evidenceFileKey,evidenceFileMetadata} from './web/evidence-files.js';
const fail=code=>{throw new AppError(code??'MATERIAL_INVALID');};
export class EvidenceFileChoices{
 constructor(workspace){this.workspace=workspace;}
 tree(store){return new ObjectIndex(store,{namespace:'evidence-file-choice-index:',immutable:true});}
 async state(store,{recordId,selection=null}){
  if(!researchId(recordId))fail();
  const snapshot=await store.snapshot();if(!await store.member(snapshot,recordId))fail('NOT_FOUND');
  const scope=JSON.stringify({workspaceId:snapshot.metadata.id,recordId});
  if(selection===null)return {scope,root:null,bytes:0};
  if(typeof selection!=='string'||selection.length>4096||!/^[A-Za-z0-9_-]+$/.test(selection))fail();
  let value;try{value=store.decode('evidence-file-selection',scope,Buffer.from(selection,'base64url'));}catch{fail();}
  if(!value||value.scope!==scope||!validIndexRef(value.root)||!Number.isSafeInteger(value.bytes)||value.bytes<0)fail();
  return value;
 }
 summary(store,state){return {selection:store.encode('evidence-file-selection',state.scope,state).toString('base64url'),count:state.root?.count??0,bytes:state.bytes};}
 async append(command){
  const {items,offset}=command;
  if(!Array.isArray(items)||!items.length||items.length>64||!items.every(validEvidenceFile)||!Number.isSafeInteger(offset)||offset<0)fail();
  return this.workspace.withLock(()=>this.workspace.catalogue(async store=>{
   const state=await this.state(store,command),tree=this.tree(store),count=state.root?.count??0;
   if(offset!==count||!Number.isSafeInteger(count+items.length))fail();
   for(const [i,item] of items.entries()){
    const value={...evidenceFileMetadata(item),ordinal:offset+i},revision=digest(serialize(value)),slot='evidence-file-choice:'+revision;
    if(!Number.isSafeInteger(state.bytes+value.size))fail();
    await store.db.run('INSERT INTO state VALUES ($1,$2) ON CONFLICT(slot) DO NOTHING',slot,store.encode('state',slot,value));
    state.root=await tree.change(state.root,evidenceFileKey(value),revision);state.bytes+=value.size;
   }
   await tree.flush(state.root);return this.summary(store,state);
  }));
 }
 async page(command){
  const {offset=0,limit=64}=command;
  if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>64)fail();
  return this.workspace.catalogue(async store=>{
   const state=await this.state(store,command),tree=this.tree(store),count=state.root?.count??0;
   if(offset>count)fail();
   const start=offset?await tree.entryAt(state,offset-1):null,items=[];
   for await(const entry of tree.entries(state,'',start?.id??null)){
    const slot='evidence-file-choice:'+entry.revision,row=await store.db.get('SELECT payload FROM state WHERE slot=$1',slot),value=store.decode('state',slot,row?.payload);
    if(digest(serialize(value))!==entry.revision||!validEvidenceFile(value)||!Number.isSafeInteger(value.ordinal)||value.ordinal<0||value.ordinal>=count||evidenceFileKey(value)!==entry.id)fail('CATALOGUE_DAMAGED');
    items.push(value);if(items.length===limit)break;
   }
   if(items.length!==Math.min(limit,count-offset))fail('CATALOGUE_DAMAGED');
   return {items,offset,count,next:offset+items.length<count?offset+items.length:null};
  });
 }
}
