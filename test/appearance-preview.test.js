import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook} from '../src/model.js';
import {appearancePreviewSource,appearancePreviewPage,appearancePreviewChoices} from '../src/appearance-preview.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {publicProjection} from '../src/publication.js';
import {clearVault} from '../src/encryption.js';

async function fixture(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-appearance-source-')),book=upgradeNotebook(sampleNotebook()),seed=book.entries[0];
 book.entries=Array.from({length:320},(_,i)=>({...structuredClone(seed),id:randomUUID(),title:'Private specimen '+i,body:'Private original '+i,share:false,attachments:[],figures:[],relations:[],sections:[]}));
 for(const i of [3,100,319]){book.entries[i].share=true;book.entries[i].title='Public specimen '+i;book.entries[i].body='Selected original '+i;}
 const hidden={...structuredClone(book.projects[0]),id:randomUUID(),title:'Private project',share:false};book.projects.push(hidden);
 const notebook={...structuredClone(book.notebooks[0]),id:randomUUID(),projectId:hidden.id};book.notebooks.push(notebook);book.entries[100].notebookId=notebook.id;
 const f=await encryptedFixture(directory,book),etag=(await f.workspace.outline()).etag;
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 return {...f,book,command:{workspaceId:book.id,etag,mode:'auto',appearance:{...book.appearance,accent:'#123456'}}};
}

test('appearance uses saved public revisions without loading private bodies or a whole-book manifest',async t=>{
 const f=await fixture(t),record=ResearchCatalogue.prototype.record,read=ResearchCatalogue.prototype.read,manifest=ResearchCatalogue.prototype.manifest,loaded=[];
 ResearchCatalogue.prototype.read=ResearchCatalogue.prototype.manifest=()=>{throw Error('Complete book requested');};
 ResearchCatalogue.prototype.record=function(id,...args){loaded.push(id);assert.ok([f.book.entries[3].id,f.book.entries[319].id].includes(id));return record.call(this,id,...args);};
 t.after(()=>{ResearchCatalogue.prototype.record=record;ResearchCatalogue.prototype.read=read;ResearchCatalogue.prototype.manifest=manifest;});
 const example=await appearancePreviewSource(f.workspace,{...f.command,mode:'examples'});assert.equal(example.source,'examples');assert.deepEqual(loaded,[]);
 const result=await appearancePreviewSource(f.workspace,f.command);assert.equal(result.source,'website');assert.equal(result.book.entries.length,0);assert.equal(loaded.length,0);
 const choices=await appearancePreviewChoices(f.workspace,f.command);assert.equal(choices.pages.filter(p=>p.path.startsWith('entries/')).length,2);assert.equal(loaded.length,0);
 const context=await appearancePreviewPage(f.workspace,f.command,'entries/'+f.book.entries[3].id+'.html');assert.deepEqual(loaded,[f.book.entries[3].id]);
 assert.deepEqual(context.entries,publicProjection({...f.book,appearance:f.command.appearance}).entries.filter(r=>r.id===f.book.entries[3].id));
 assert.equal((await f.workspace.outline()).etag,f.command.etag);
});

test('appearance preview remains pinned after edits, rejects malformed commands and honours cancellation',async t=>{
 const f=await fixture(t),original=f.book.entries[3];
 await new ResearchRecords(f.workspace,{}).save({workspaceId:f.book.id,changes:[{id:original.id,expectedRevision:recordRevision(original),record:{...original,body:'Newer unsaved preview source',share:false}}]},{compact:true});
 const result=await appearancePreviewPage(f.workspace,f.command,'entries/'+original.id+'.html');assert.equal(result.entries.find(r=>r.id===original.id).body,original.body);
 for(const invalid of [{...f.command,book:f.book},{...f.command,workspaceContent:true},{...f.command,designTarget:'home'},{...f.command,mode:'anything'},{...f.command,appearance:{...f.command.appearance,accent:'url(https://invalid)'}}])await assert.rejects(appearancePreviewSource(f.workspace,invalid),{code:'INVALID'});
 await assert.rejects(appearancePreviewSource(f.workspace,{...f.command,workspaceId:randomUUID()}),{code:'WORKSPACE_CHANGED'});
 const controller=new AbortController();controller.abort();await assert.rejects(appearancePreviewSource(f.workspace,f.command,{signal:controller.signal}),{name:'AbortError'});
 const current=await appearancePreviewChoices(f.workspace,{...f.command,etag:(await f.workspace.outline()).etag});assert.equal(current.pages.filter(p=>p.path.startsWith('entries/')).length,1);
 await assert.rejects(appearancePreviewPage(f.workspace,{...f.command,etag:(await f.workspace.outline()).etag},'entries/'+original.id+'.html'),{code:'NOT_FOUND'});
});
