import {materialReference,materialReferenceKey,validMaterialReference} from './web/material-reference.js';
// Immutable, encrypted selections. The browser holds an authenticated handle,
// while ordered pages and membership checks read only the requested references.
import {AppError} from './errors.js';
import {researchId} from './web/research-reference.js';
import {ObjectIndex,validIndexRef} from './object-index.js';
import {digest,serialize} from './storage-format.js';
const kinds=['artifact','dataset','analysis','collection'];
const fail=code=>{throw new AppError(code??'MATERIAL_INVALID');};
const reference=materialReference;
const valid=item=>validMaterialReference(item)&&kinds.includes(item.kind);
const key=item=>'ref:'+materialReferenceKey(item);
const order=ordinal=>'order:'+String(ordinal).padStart(16,'0');
export class MaterialChoices{
 constructor(materials){this.materials=materials;this.workspace=materials.workspace;}
 tree(store){return new ObjectIndex(store,{namespace:'material-choice-index:',immutable:true});}
 async state(store,{recordId,kind=null,selection=null},{retained=false}={}){
  if(!researchId(recordId)||kind!==null&&!kinds.includes(kind))fail();
  const snapshot=await store.snapshot();
  if(!retained&&!await store.member(snapshot,recordId))fail('NOT_FOUND');
  const scope=JSON.stringify({workspaceId:snapshot.metadata.id,recordId,kind});
  if(selection===null)return {scope,root:null,ordinal:0};
  if(typeof selection!=='string'||selection.length>4096||!/^[A-Za-z0-9_-]+$/.test(selection))fail();
  let value;try{value=store.decode('material-selection',scope,Buffer.from(selection,'base64url'));}catch{fail();}
  if(!value||value.scope!==scope||!validIndexRef(value.root)||!Number.isSafeInteger(value.ordinal)||value.ordinal<0||
   (value.root?.count??0)%2||(value.root?.count??0)/2>value.ordinal)fail();
  return value;
 }
 summary(store,state){return {selection:store.encode('material-selection',state.scope,state).toString('base64url'),count:(state.root?.count??0)/2};}
 // Durable tasks pin the authenticated tree inside encrypted metadata, not the
 // browser's key-dependent token. Fresh-key recovery can then resume them.
 async pin(command){return this.workspace.catalogue(store=>this.state(store,command));}
 async pagePinned(state,options={}){
  return this.workspace.catalogue(async store=>{
   const {recordId,kind}=JSON.parse(state.scope);
   return this.page({...options,recordId,kind,selection:this.summary(store,state).selection},{retained:true});
  });
 }
 async item(store,entry){
  const slot='material-choice:'+entry.revision,row=await store.db.get('SELECT payload FROM state WHERE slot=$1',slot);
  const value=store.decode('state',slot,row?.payload);
  if(digest(serialize(value))!==entry.revision)fail('CATALOGUE_DAMAGED');
  if(!value||!valid(value.ref)||typeof value.title!=='string'||value.title.length>300||!Number.isSafeInteger(value.ordinal)||value.ordinal<0||
   ![key(value.ref),order(value.ordinal)].includes(entry.id))fail('CATALOGUE_DAMAGED');
  return value;
 }
 async change(command){
  const {ref,checked,kind=null}=command,refs=command.refs??[ref];
  if(ref!==undefined&&command.refs!==undefined||!Array.isArray(refs)||!refs.length||refs.length>50||!refs.every(r=>valid(r)&&(!kind||r.kind===kind))||typeof checked!=='boolean')fail();
  return this.workspace.withLock(()=>this.workspace.catalogue(async store=>{
   const state=await this.state(store,command),tree=this.tree(store);
   for(const ref of refs){
   const prior=await tree.find(state,key(ref));
   await this.materials.assertReferenceWorkspace(ref);
   if(checked&&!prior){
    if(!Number.isSafeInteger(state.ordinal+1))fail();
    const doc=await this.materials.read(ref),value={ref:reference(ref),title:doc.title,ordinal:state.ordinal++};
    const version=digest(serialize(value)),slot='material-choice:'+version;
    await store.db.run('INSERT INTO state VALUES ($1,$2) ON CONFLICT(slot) DO NOTHING',slot,store.encode('state',slot,value));
    state.root=await tree.change(state.root,key(ref),version);
    state.root=await tree.change(state.root,order(value.ordinal),version);
   }else if(!checked&&prior){
    const value=await this.item(store,prior),ordered=await tree.find(state,order(value.ordinal));
    if(ordered?.revision!==prior.revision)fail('CATALOGUE_DAMAGED');
    state.root=await tree.change(state.root,key(ref),null);
    state.root=await tree.change(state.root,order(value.ordinal),null);
   }
   }
   await tree.flush(state.root);return this.summary(store,state);
  }));
 }
 async page(command,{retained=false}={}){
  const {offset=0,limit=10,members=[]}=command;
  if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>64||!Array.isArray(members)||members.length>50||!members.every(valid))fail();
  return this.workspace.catalogue(async store=>{
   const state=await this.state(store,command,{retained}),tree=this.tree(store),count=(state.root?.count??0)/2;
   for(const ref of members)await this.materials.assertReferenceWorkspace(ref);
   if(offset>count)fail();
   const start=offset?await tree.entryAt(state,offset-1):null,items=[],selected=[];
   for await(const entry of tree.entries(state,'order:',start?.id??null)){
    const value=await this.item(store,entry),member=await tree.find(state,key(value.ref));
    if(member?.revision!==entry.revision)fail('CATALOGUE_DAMAGED');
    items.push({...value.ref,title:value.title});if(items.length===limit)break;
   }
   if(items.length!==Math.min(limit,count-offset))fail('CATALOGUE_DAMAGED');
   for(const ref of members)if(await tree.find(state,key(ref)))selected.push(reference(ref));
   return {items,selected,offset,count,next:offset+items.length<count?offset+items.length:null};
  });
 }
}
