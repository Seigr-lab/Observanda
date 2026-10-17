import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {collaborationFixture} from './fixtures/collaboration.js';
import {Workspace} from '../src/storage.js';
import {readAccess,verifyAccess} from '../src/access.js';
import {ResearchExchange} from '../src/collaboration/research-exchange.js';
import {ChangeReview} from '../src/collaboration/change-review.js';
import {sharingCommand} from '../src/collaboration/commands.js';
import {ExchangeParts} from '../src/collaboration/exchange-parts.js';
import {packageSelection} from '../src/collaboration/research-package.js';
import {selectedMetadata,validateSelection} from '../src/collaboration/selection.js';
import {verifyPackageConfigurations,configurationPartName} from '../src/collaboration/configuration-transfer.js';
import {ConfigurationDocuments} from '../src/configuration-documents.js';
import {RecordValueTree} from '../src/record-value-tree.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {copyPlan,copyWorkspace} from '../src/locations.js';
import {digest,serialize} from '../src/storage-format.js';

const schema=()=>({profiles:[],sections:[{id:randomUUID(),profileId:null,key:'observations',label:'Observations',description:'Shared schema',enabled:true,fields:[{key:'choice',label:'Choice',type:'select',unit:'',required:true,choices:Array.from({length:97},(_,i)=>'option-'+String(i).padStart(3,'0'))}]}]});
async function configure(workspace,value){
 return workspace.withLock(()=>workspace.catalogue(async store=>{
  const head=await store.head(),snapshot=await store.snapshot(head),metadata=structuredClone(snapshot.metadata),book=metadata.notebooks[0],owner={workspaceId:metadata.id,projectId:book.projectId,notebookId:book.id,slot:'configuration'};
  book.configuration=typeof value==='function'?await value(new ConfigurationDocuments(store),owner,book.configuration):structuredClone(value);
  await store.validateMetadata(snapshot,metadata);await store.commitChanges(head,snapshot,metadata,[]);return book.configuration;
 }));
}
async function opened(f,destination){const vault=await verifyAccess(await readAccess(destination),'','',{deviceStore:f.member.deviceStore});f.vaults.push(vault);return new Workspace(destination,vault);}
async function choices(workspace,reference,sectionId,query){return workspace.catalogue(async store=>{
 const reader=await new ConfigurationDocuments(store).open(reference.owner,reference);
 return (await reader.window({collection:'choices',sectionId,fieldKey:'choice',query,limit:32})).rows.map(row=>row.value);
 });}

// One connected case exercises both old inline bases and new graph packets.
// The tree guard makes accidental whole-configuration hydration fail directly.
test('offline configuration references survive shared copies, changes, owner editions and backup without schema hydration', {timeout:240000},async t=>{
 const f=await collaborationFixture(t),value=schema();await configure(f.author.workspace,value);
 const oldOffer=await f.sa.prepareOffer({grantId:f.grant.id,contact:f.contact}),oldParts=new ExchangeParts(f.author.workspace,oldOffer.id);await oldParts.open();
 const oldSelection=await packageSelection(oldParts);assert.equal(oldSelection.version,1);assert.deepEqual(oldSelection.metadata.notebooks[0].configuration,value);
 assert.deepEqual(validateSelection(structuredClone(oldSelection)),oldSelection);
 assert.deepEqual(selectedMetadata(oldSelection.metadata,oldSelection.metadata.notebooks.map(book=>book.id)),oldSelection.metadata);
 assert.ok(!(await Array.fromAsync(oldParts.items())).some(item=>configurationPartName(item.name)));
 const first=await f.sb.receive(await f.sa.outgoing(oldOffer.id)),destination=path.join(f.directory,'configuration-copy');await f.sb.acceptCopy(first.id,destination);
 const copy=await opened(f,destination),member=new ResearchExchange(copy,f.member.deviceStore),reviewer=new ChangeReview(member);
 const converted=await configure(copy,(documents,owner,inline)=>documents.retainInline(owner,inline));
 const legacyChanges=await member.prepareChanges(),legacyParts=new ExchangeParts(copy,legacyChanges.id);await legacyParts.open();
 assert.equal((await packageSelection(legacyParts)).version,1);assert.deepEqual((await packageSelection(legacyParts)).metadata,oldSelection.metadata);
 const original=await configure(f.author.workspace,(documents,owner,inline)=>documents.retainInline(owner,inline));
 const protectedRoots=new Set([original.root,converted.root]),read=RecordValueTree.prototype.read;
 RecordValueTree.prototype.read=async function(revision,...args){assert.ok(!protectedRoots.has(revision),'whole configuration hydration');return read.call(this,revision,...args);};
 t.after(()=>{RecordValueTree.prototype.read=read;});
 const offer=await f.sa.prepareOffer({grantId:f.grant.id,contact:f.contact}),parts=new ExchangeParts(f.author.workspace,offer.id);await parts.open();
 const selection=await packageSelection(parts);assert.equal(selection.version,2);assert.deepEqual(selection.metadata.notebooks[0].configuration,original);
 assert.ok(!Object.hasOwn(selection.metadata.projects[0],'labBookTemplate'));
 const entries=await Array.fromAsync(parts.items()),nodes=entries.filter(item=>configurationPartName(item.name));assert.ok(nodes.length>1);assert.ok(nodes.every(item=>item.size<=65536));
 // Fresh v2 import must install nodes before publishing its exact metadata.
 const fresh=await f.sb.receive(await f.sa.outgoing(offer.id)),freshDestination=path.join(f.directory,'configuration-native-copy');await f.sb.acceptCopy(fresh.id,freshDestination);
 const nativeCopy=await opened(f,freshDestination);assert.deepEqual((await nativeCopy.outline()).metadata.notebooks[0].configuration,original);
 assert.deepEqual(await choices(nativeCopy,original,value.sections[0].id,'option-096'),['option-096']);
 // An owner edition with no record changes still installs the new schema.
 const incoming=await member.receive(await f.sa.outgoing(offer.id)),review=await reviewer.review(incoming.id);assert.equal(review.rows.length,0);
 const identity={workspaceId:f.book.id,reviewId:review.id,notebookId:f.book.notebooks[0].id},query={...identity,operation:'window',collection:'choices',sectionId:value.sections[0].id,fieldKey:'choice',offset:80,limit:20};
 const configuration=data=>sharingCommand(copy,f.member.deviceStore,'configuration',data),writeMetadata=copy.writeMetadata;
 copy.writeMetadata=async()=>assert.fail('configuration review must not write metadata');
 try{
  for(const version of ['base','incoming']){
   const opened=await configuration({...identity,version,operation:'open'});assert.equal(opened.header.counts.choices,97);
   const late=await configuration({...query,version});assert.equal(late.total,97);assert.equal(late.offset,80);assert.equal(late.next,null);assert.deepEqual(late.rows.map(row=>row.value),value.sections[0].fields[0].choices.slice(80));
   const field=await configuration({...identity,version,operation:'item',collection:'fields',sectionId:value.sections[0].id,key:'choice'});assert.equal(field.item.counts.choices,97);assert.ok(!Object.hasOwn(field.item.value,'choices'));
  }
  await assert.rejects(configuration({...query,version:'current'}),{code:'INVALID'});
  await assert.rejects(configuration({...query,version:'incoming',notebookId:f.book.notebooks[1].id}),{code:'COLLABORATION_SCOPE'});
  await assert.rejects(configuration({...query,version:'incoming',reviewId:randomUUID()}),{code:'COLLABORATION_PACKAGE'});
  await assert.rejects(configuration({...query,version:'incoming',workspaceId:randomUUID()}),{code:'WORKSPACE_CHANGED'});
  await assert.rejects(configuration({...query,version:'incoming',root:original.root}),{code:'INVALID'});
  await assert.rejects(configuration({...query,version:'incoming',limit:21}),{code:'INVALID'});
 }finally{copy.writeMetadata=writeMetadata;}
 await reviewer.apply({reviewId:review.id,choices:[]});
 assert.deepEqual((await copy.outline()).metadata.notebooks[0].configuration,original);
 const next=await configure(f.author.workspace,async(documents,owner,reference)=>documents.applySelected(await documents.open(owner,reference),[{type:'replace',collection:'choices',sectionId:value.sections[0].id,fieldKey:'choice',key:'option-096',value:'retained-later-choice'}]));protectedRoots.add(next.root);
 const second=await f.sa.prepareOffer({grantId:f.grant.id,contact:f.contact}),received=await member.receive(await f.sa.outgoing(second.id)),update=await reviewer.review(received.id);assert.equal(update.rows.length,0);await reviewer.apply({reviewId:update.id,choices:[]});
 assert.deepEqual(await choices(copy,next,value.sections[0].id,'retained-later'),['retained-later-choice']);assert.deepEqual(await choices(copy,original,value.sections[0].id,'option-096'),['option-096']);
 assert.equal((await configuration({...query,version:'incoming'})).rows.at(-1).value,'option-096');
 assert.equal((await configuration({...query,reviewId:update.id,version:'incoming'})).rows.at(-1).value,'retained-later-choice');
 const record=await copy.catalogue(async store=>{const row=await store.member(await store.snapshot(),f.book.entries[0].id);return store.record(row.id,row.revision);});await new ResearchRecords(copy,{}).save({workspaceId:f.book.id,changes:[{id:record.id,expectedRevision:recordRevision(record),record:{...record,title:'Configuration-aware shared edit'}}]});
 const outgoing=await member.prepareChanges(),returned=await f.sa.receive(await member.outgoing(outgoing.id)),ownerReview=new ChangeReview(f.sa),changes=await ownerReview.review(returned.id);assert.equal(changes.rows.length,1);
 await ownerReview.apply({reviewId:changes.id,choices:changes.rows.map(row=>({id:row.id,choice:'incoming'}))});assert.equal(await f.author.workspace.catalogue(async store=>{const row=await store.member(await store.snapshot(),record.id);return (await store.record(row.id,row.revision)).title;}),'Configuration-aware shared edit');
 // Neither a signature nor the right node namespace permits an unrelated graph.
 const foreign=structuredClone(selection.metadata);foreign.notebooks[0].configuration.owner.notebookId=randomUUID();await assert.rejects(verifyPackageConfigurations(parts,foreign),{code:'COLLABORATION_PACKAGE'});
 const target=nodes[0],missing={workspace:parts.workspace,items:()=>parts.items(),descriptor:(kind,name)=>name===target.name?null:parts.descriptor(kind,name),value:(...args)=>parts.value(...args)};
 await assert.rejects(verifyPackageConfigurations(missing,selection.metadata),{code:'COLLABORATION_PACKAGE'});
 const damaged={...missing,descriptor:(...args)=>parts.descriptor(...args),value:async(kind,name)=>name===target.name?{type:'inline',value:'Changed bytes'}:parts.value(kind,name)};
 await assert.rejects(verifyPackageConfigurations(damaged,selection.metadata),{code:'COLLABORATION_PACKAGE'});
 const unrelated={type:'inline',value:'Outside selected roots'},name='.observanda/configuration-blocks/value/'+digest(serialize(unrelated))+'.json';
 const extra={workspace:parts.workspace,descriptor:(...args)=>parts.descriptor(...args),value:(...args)=>parts.value(...args),async *items(){yield* parts.items();yield {kind:'metadata',name,size:JSON.stringify(unrelated).length,sha256:digest(JSON.stringify(unrelated)),index:parts.count};}};
 await assert.rejects(verifyPackageConfigurations(extra,selection.metadata),{code:'COLLABORATION_PACKAGE'});
 await assert.rejects(verifyPackageConfigurations(extra,oldSelection.metadata),{code:'COLLABORATION_PACKAGE'});
 const backup=await copyWorkspace(await copyPlan(destination,path.join(f.directory,'configuration-backup')),{vault:copy.vault}),restored=new Workspace(backup,copy.vault);
 assert.deepEqual((await restored.outline()).metadata.notebooks[0].configuration,next);assert.deepEqual(await choices(restored,original,value.sections[0].id,'option-096'),['option-096']);
 assert.equal((await new ResearchExchange(restored,f.member.deviceStore).working()).selection.id,second.id);
});
