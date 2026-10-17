import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {WorkspaceDatabases} from '../src/workspace-databases.js';
import {installDatabaseProvider} from '../src/workspace-database-context.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {Workspace} from '../src/storage.js';
import {clearVault} from '../src/encryption.js';
import {ConfigurationDocuments} from '../src/configuration-documents.js';
import {ConfigurationCommands} from '../src/configuration-commands.js';
import {ConfigurationValueBlocks} from '../src/configuration-block-store.js';
import {RecordValueTree} from '../src/record-value-tree.js';
import {serialize} from '../src/storage-format.js';
import {MAX_METADATA_BYTES} from '../src/web/research-capacity.js';
import {MAX_BYTES,validateNotebook} from '../src/model.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {ResearchRecords,recordRevision} from '../src/research.js';

test('configuration larger than the former metadata budget supports a bounded selected edit and durable reopen',{timeout:180000},async t=>{
 const parent=path.resolve(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-configuration-growth-')),databases=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(databases),book=sampleNotebook(),f=await encryptedFixture(directory,book),workspace=f.workspace,notebook=book.notebooks[0],owner={workspaceId:book.id,projectId:notebook.projectId,notebookId:notebook.id,slot:'configuration'};
 t.after(async()=>{await databases.close();detach();clearVault(f.vault);assert.equal(path.dirname(directory),parent);assert.ok(path.basename(directory).startsWith('observanda-configuration-growth-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 // This owner fixture is retained directly, rather than sent as a whole-book
 // request. The public selected command below is the authoring boundary.
 const configuration={profiles:[],sections:Array.from({length:1100},(_,i)=>({id:randomUUID(),profileId:null,key:'section-'+i,label:'Observation '+i,description:String(i).padStart(4,'0')+'x'.repeat(1996),enabled:true,fields:[]}))},last=configuration.sections.at(-1);
 last.fields=[{key:'condition',label:'Condition',type:'select',unit:'',required:false,choices:Array.from({length:97},(_,i)=>'Condition '+i)}];
 const fullBytes=Buffer.byteLength(serialize(configuration));assert.ok(fullBytes>MAX_METADATA_BYTES,{fullBytes,limit:MAX_METADATA_BYTES});
 const reference=await workspace.withLock(()=>workspace.catalogue(async store=>{
  const head=await store.head(),current=await store.indexed(await store.snapshot(head)),metadata=structuredClone(current.metadata),reference=await new ConfigurationDocuments(store).retainInline(owner,configuration);
  metadata.notebooks.find(value=>value.id===notebook.id).configuration=reference;assert.ok(Buffer.byteLength(serialize(metadata))<MAX_METADATA_BYTES);
  await store.validateMetadata(current,metadata);await store.commitChanges(head,current,metadata,[]);return reference;
 }));
 const commands=new ConfigurationCommands(workspace),opened=await commands.open(owner);assert.deepEqual(opened.header.counts,{profiles:0,sections:1100,fields:1,choices:97});assert.ok(Buffer.byteLength(serialize(opened))<4096);
 const originalSelect=RecordValueTree.prototype.select,originalRead=RecordValueTree.prototype.read,originalJSON=RecordValueTree.prototype.json,originalBlockRead=ConfigurationValueBlocks.prototype.read,positions=[],blocks=new Set();let readBytes=0;
 RecordValueTree.prototype.select=async function(root,path){if(this.storage instanceof ConfigurationValueBlocks&&path[0]==='sections'&&path[1]!==undefined)positions.push(path.slice());return originalSelect.call(this,root,path);};
 RecordValueTree.prototype.read=async function(root){if(this.storage instanceof ConfigurationValueBlocks)assert.notEqual(root,reference.root,'Selected command hydrated the entire configuration');return originalRead.call(this,root);};
 RecordValueTree.prototype.json=async function*(root,options){if(this.storage instanceof ConfigurationValueBlocks)assert.notEqual(root,reference.root,'Selected command serialized the entire configuration');yield*originalJSON.call(this,root,options);};
 ConfigurationValueBlocks.prototype.read=async function(kind,revision){const value=await originalBlockRead.call(this,kind,revision),key=kind+':'+revision;if(!blocks.has(key)){blocks.add(key);readBytes+=Buffer.byteLength(serialize(value));}return value;};
 let changed;const started=performance.now();
 try{changed=await commands.change({...owner,configurationPin:opened.configurationPin,draftId:null,expectedRevision:null,commandId:randomUUID(),operations:[{type:'replace',collection:'choices',sectionId:last.id,fieldKey:'condition',key:'Condition 96',value:'Final retained choice'}]});}
 finally{RecordValueTree.prototype.select=originalSelect;RecordValueTree.prototype.read=originalRead;RecordValueTree.prototype.json=originalJSON;ConfigurationValueBlocks.prototype.read=originalBlockRead;}
 const editMs=performance.now()-started;assert.ok(positions.length>0);assert.ok(positions.every(path=>path[1]==='1099'&&(path[2]!=='fields'||path[3]===undefined||path[3]==='0')),'Selected edit traversed an unrelated section or field');assert.ok(readBytes<fullBytes/2,'Selected edit read most of the retained configuration');
 const saved=await commands.save({...owner,configurationPin:opened.configurationPin,draftId:changed.draft.id,expectedRevision:changed.draft.revision,commandId:randomUUID()});assert.equal(saved.draft,null);
 const record=book.entries[0];await new ResearchRecords(workspace,{get:async()=>{throw Error('Unexpected synthetic media');}}).save({workspaceId:book.id,changes:[{id:record.id,expectedRevision:recordRevision(record),record:{...record,title:'Authoring after large configuration Save'}}]});
 await databases.closeWorkspace(workspace.root);const reopened=new Workspace(workspace.root,f.vault),again=new ConfigurationCommands(reopened),current=await again.open(owner);assert.equal(current.draft,null);assert.deepEqual(current.header.counts,opened.header.counts);
 const selected=await again.item({...owner,configurationPin:current.configurationPin,collection:'choices',sectionId:last.id,fieldKey:'condition',key:'Final retained choice'});assert.equal(selected.item.position,96);assert.equal(selected.item.value,'Final retained choice');
 const previous=await again.item({...owner,configurationPin:opened.configurationPin,collection:'choices',sectionId:last.id,fieldKey:'condition',key:'Condition 96'});assert.equal(previous.item.value,'Condition 96');
 const final=await reopened.outline();assert.ok(Buffer.byteLength(serialize(final.metadata))<MAX_METADATA_BYTES);await reopened.catalogue(async store=>{await new ConfigurationDocuments(store).verify(owner,final.metadata.notebooks[0].configuration);const row=await store.member(await store.snapshot(),record.id);assert.equal((await store.record(record.id,row.revision)).title,'Authoring after large configuration Save');});
 t.diagnostic(JSON.stringify({configurationBytes:fullBytes,metadataBytes:Buffer.byteLength(serialize(final.metadata)),selectedUniqueBlocks:blocks.size,selectedBlockBytes:readBytes,selectedEditMilliseconds:Math.round(editMs),sections:1100,choices:97}));
});


test('complete workspace reads expand small retained configurations and refuse oversized schemas before hydration',{timeout:180000},async t=>{
 const parent=path.resolve(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-configuration-read-')),databases=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(databases),book=sampleNotebook(),f=await encryptedFixture(directory,book),workspace=f.workspace,notebook=book.notebooks[0],owner={workspaceId:book.id,projectId:notebook.projectId,notebookId:notebook.id,slot:'configuration'};
 t.after(async()=>{await databases.close();detach();clearVault(f.vault);assert.equal(path.dirname(directory),parent);assert.ok(path.basename(directory).startsWith('observanda-configuration-read-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const section=i=>({id:randomUUID(),profileId:null,key:'section-'+i,label:'Observation '+i,description:'Retained schema',enabled:true,fields:[]}),small={profiles:[],sections:[section(0)]};
 const configure=value=>workspace.withLock(()=>workspace.catalogue(async store=>{
  const head=await store.head(),snapshot=await store.indexed(await store.snapshot(head)),metadata=structuredClone(snapshot.metadata),documents=new ConfigurationDocuments(store);
  metadata.notebooks[0].configuration=await documents.retainInline(owner,value);
  metadata.projects.find(value=>value.id===notebook.projectId).labBookTemplate={name:'Read compatibility',configuration:await documents.retainInline({...owner,notebookId:null,slot:'labBookTemplate'},small)};
  await store.validateMetadata(snapshot,metadata);await store.commitChanges(head,snapshot,metadata,[]);return {head:await store.head(),reference:metadata.notebooks[0].configuration};
 }));
 const first=await configure(small),complete=await workspace.read();assert.equal(complete.etag,first.head);assert.deepEqual(complete.book.notebooks[0].configuration,small);assert.deepEqual(complete.book.projects.find(value=>value.id===notebook.projectId).labBookTemplate,{name:'Read compatibility',configuration:small});validateNotebook(complete.book);
 const large={profiles:[],sections:Array.from({length:450},(_,i)=>({...section(i),description:'\u20ac'.repeat(2000)}))},fullBytes=Buffer.byteLength(serialize(large));assert.ok(fullBytes>MAX_BYTES);
 const second=await configure(large),originalRead=RecordValueTree.prototype.read,originalJSON=RecordValueTree.prototype.json,originalRecord=ResearchCatalogue.prototype.record;let emitted=0,recordReads=0;
 RecordValueTree.prototype.read=async function(root){if(this.storage instanceof ConfigurationValueBlocks)assert.notEqual(root,second.reference.root,'Full oversized schema was hydrated');return originalRead.call(this,root);};
 RecordValueTree.prototype.json=async function*(root,options){for await(const chunk of originalJSON.call(this,root,options)){if(this.storage instanceof ConfigurationValueBlocks&&root===second.reference.root)emitted+=Buffer.byteLength(chunk);yield chunk;}};
 ResearchCatalogue.prototype.record=async function(...args){recordReads++;return originalRecord.apply(this,args);};
 try{await assert.rejects(workspace.read(),{code:'WORKSPACE_READ_LIMIT'});}finally{RecordValueTree.prototype.read=originalRead;RecordValueTree.prototype.json=originalJSON;ResearchCatalogue.prototype.record=originalRecord;}
 assert.equal(recordReads,0);assert.ok(emitted>0&&emitted<fullBytes,{emitted,fullBytes});assert.equal((await workspace.outline()).etag,second.head);
 const selected=await new ConfigurationCommands(workspace).open(owner);assert.equal(selected.header.counts.sections,450);
 const retained=await workspace.catalogue(store=>store.read(first.head));assert.deepEqual(retained.book.notebooks[0].configuration,small);validateNotebook(retained.book);
 t.diagnostic(JSON.stringify({configurationBytes:fullBytes,stoppedAfterBytes:emitted,recordReads}));
});
