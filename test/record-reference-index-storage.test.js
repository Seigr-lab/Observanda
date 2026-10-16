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
import {RecordQuery} from '../src/record-query.js';
import {RecordValueTree} from '../src/record-value-tree.js';
import {recordBrowse} from '../src/web/record-query.js';
import {withQueryValue} from '../src/record-query-storage.js';
import {digest,serialize} from '../src/storage-format.js';
const prose=(workspaceId,id)=>({type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Linked observation',marks:[{type:'link',attrs:{href:'observanda://'+workspaceId+'/record/'+id,title:'',target:'_self',nofollow:false}}]}]}]});

test('selected reference edits preserve duplicate backlinks, verify every index and recover earlier linked queries',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-reference-index-')),book=sampleNotebook(),record=book.entries[0],target=book.entries[1];book.entries=[record,target];
 for(const value of book.entries){value.figures=[];value.attachments=[];value.relations=[];value.sections=[];}
 record.body=prose(book.id,target.id);record.sections=[{id:randomUUID(),title:'Independent reference',body:prose(book.id,target.id)}];
 const f=await encryptedFixture(directory,book);t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const writing=new RecordWriting(f.workspace),where={workspaceId:book.id,recordId:record.id,sectionId:null};
 const initial=await writing.read(where),retained=structuredClone(record.body);retained.content[0].content[0].text='Retained linked observation';await writing.save({...where,expectedRevision:initial.revision,value:{body:retained}});
 const before=(await f.workspace.outline()).etag,read=RecordValueTree.prototype.page;t.mock.method(RecordValueTree.prototype,'page',function(root,path,...args){assert.notEqual(path[0],'referenceTargets','Reference update enumerated its full query array');return read.call(this,root,path,...args);});
 const base=await writing.read(where),command={...where,expectedRevision:base.revision,value:{body:'Removed the first mention'}},first=await writing.save(command);assert.deepEqual(await writing.save(command),first);RecordValueTree.prototype.page.mock.restore();
 const linked=workspace=>new RecordQuery(workspace).list({workspaceId:book.id,query:{projectId:null,notebookId:null,filter:'all',search:'',browse:recordBrowse()},relatedTo:{workspaceId:book.id,id:target.id}});
 assert.deepEqual((await linked(f.workspace)).records.map(value=>value.id),[record.id]);
 const copy=await copyWorkspace(await copyPlan(f.workspace.root,path.join(directory,'copy')),{vault:f.vault}),access=await createAccess('','Reference contribution recovery'),vault=takeCreatedVault(access);t.after(()=>clearVault(vault));const fresh=await encryptedCopy(await copyPlan(f.workspace.root,path.join(directory,'fresh')),access,vault,f.vault);
 for(const workspace of [f.workspace,new Workspace(copy,f.vault),new Workspace(fresh,vault)]){assert.equal((await linked(workspace)).total,1);await workspace.catalogue(async store=>{await store.verifySnapshot(before,book.id);await store.verifySnapshot(first.etag,book.id);});}
 // Small records must audit their auxiliary index, even without member blocks.
 await assert.rejects(f.workspace.withLock(()=>f.workspace.catalogue(async store=>{
  const row=await store.member(await store.snapshot(),record.id),source={revision:row.queryRevision,slot:'record-query:'+row.id+':'+row.queryRevision},found=await store.db.get('SELECT payload FROM state WHERE slot=$1',source.slot),value=store.decode('state',source.slot,found.payload);
  await withQueryValue(store,value,source,row,async({tree})=>{
   const invalid={...value,referenceIndex:{...value.referenceIndex,root:await tree.retain([])}};
   await assert.rejects(withQueryValue(store,invalid,{revision:digest(serialize(invalid))},row,()=>assert.fail('Unbound reference values accepted')),{code:'CATALOGUE_DAMAGED'});
   await store.db.run('DELETE FROM state WHERE slot=$1',tree.storage.slot('index',value.referenceIndex.occurrences.hash));
  });await store.verifySnapshot(undefined,book.id);
 })),{code:'CATALOGUE_DAMAGED'});
 const lastWhere={...where,sectionId:record.sections[0].id},last=await writing.read(lastWhere);await writing.save({...lastWhere,expectedRevision:last.revision,value:{title:'Independent reference',body:'Removed the last mention'}});assert.equal((await linked(f.workspace)).total,0);assert.equal((await linked(new Workspace(copy,f.vault))).total,1);await f.workspace.catalogue(store=>store.verifySnapshot(undefined,book.id));
});
