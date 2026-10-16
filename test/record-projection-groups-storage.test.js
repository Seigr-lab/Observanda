import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../src/sample.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {clearVault} from '../src/encryption.js';
import {createAccess,takeCreatedVault} from '../src/access.js';
import {copyPlan,copyWorkspace,encryptedCopy} from '../src/locations.js';
import {Workspace} from '../src/storage.js';
import {RecordWriting} from '../src/record-writing.js';
import {RecordQueryDocuments} from '../src/record-query-documents.js';
import {withQueryValue} from '../src/record-query-storage.js';
import {researchReference} from '../src/web/research-reference.js';
import {publicationDescriptor} from '../src/publication-record-descriptor.js';
const rich=(ids,target)=>({type:'doc',content:ids.flatMap((id,i)=>[{type:'heading',attrs:{id,level:2},content:[{type:'text',text:'Observation '+i}]},{type:'paragraph',content:[{type:'text',text:'Related observation',marks:[{type:'link',attrs:{href:researchReference(target),title:'Related observation',target:'_self',nofollow:false}}]}]}])});

test('selected rich-text corrections preserve grouped links in earlier revisions and both encrypted copy modes',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-grouped-links-')),book=sampleNotebook(),record=book.entries[0],target={workspaceId:book.id,kind:'record',id:book.entries[1].id};
 record.figures=[];record.attachments=[];record.relations=[];record.body=rich([randomUUID()],target);record.sections=Array.from({length:70},(_,i)=>({id:randomUUID(),title:'Section '+i,body:'Unchanged evidence '.repeat(60)}));record.sections[69].body=rich([randomUUID()],target);
 const f=await encryptedFixture(directory,book);t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const writing=new RecordWriting(f.workspace),selection={workspaceId:book.id,recordId:record.id,sectionId:record.sections[1].id},first=await writing.read(selection),beforeBody=rich([randomUUID(),randomUUID(),randomUUID()],target);
 const before=await writing.save({...selection,expectedRevision:first.revision,value:{title:'Selected section',body:beforeBody}}),initial=structuredClone(record);initial.sections[1]={...initial.sections[1],title:'Selected section',body:beforeBody};
 const next=await writing.read(selection),body=rich([randomUUID()],target),command={...selection,expectedRevision:next.revision,value:{title:'Corrected section',body}},saved=await writing.save(command);assert.deepEqual(await writing.save(command),saved);
 const current=structuredClone(initial);current.sections[1]={...current.sections[1],title:'Corrected section',body};
 const copied=await copyWorkspace(await copyPlan(f.workspace.root,path.join(directory,'copy')),{vault:f.vault}),access=await createAccess('','Grouped link recovery'),vault=takeCreatedVault(access);t.after(()=>clearVault(vault));
 const fresh=await encryptedCopy(await copyPlan(f.workspace.root,path.join(directory,'fresh')),access,vault,f.vault);
 for(const workspace of [f.workspace,new Workspace(copied,f.vault),new Workspace(fresh,vault)])await workspace.catalogue(async store=>{
  for(const [etag,original] of [[before.etag,initial],[saved.etag,current]]){
   const snapshot=await store.snapshot(etag),row=await store.member(snapshot,record.id),[query]=await Array.fromAsync(new RecordQueryDocuments(store).read([row],snapshot.metadata,{search:false,publicationDetails:true})),expected=publicationDescriptor(original);
   assert.deepEqual(query.publicationDescriptor.selectors,expected.selectors);assert.deepEqual(query.publicationDescriptor.relations,expected.relations);assert.equal(query.publicationDescriptor.relations.length,3,'Repeated references in independent fields retain each association');
   const source={revision:row.queryRevision,slot:'record-query:'+row.id+':'+row.queryRevision},found=await store.db.get('SELECT payload FROM state WHERE slot=$1',source.slot);
   await withQueryValue(store,store.decode('state',source.slot,found.payload),source,row,async({tree,value})=>{for(const name of ['selectors','relations']){const selected=await tree.select(value.root,['publicationDescriptor',name]);assert.equal((await tree.node(selected.revision)).type,'keyed-array');}});
   await store.verifySnapshot(etag,book.id);
  }
 });
});
