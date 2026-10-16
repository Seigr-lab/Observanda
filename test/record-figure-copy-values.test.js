import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {figureValueFixture} from './record-figure-values-fixture.js';
import {figureCopyChoices,figureCopySource} from '../src/record-figure-copy-values.js';
import {RecordValueDrafts} from '../src/record-value-drafts.js';
import {RecordValues} from '../src/record-values.js';
import {ResearchDrafts} from '../src/research-drafts.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {createComposition} from '../src/web/figure-composition.js';
import {catalogueFormat} from '../src/catalogue-format.js';
import {createAccess,takeCreatedVault} from '../src/access.js';
import {clearVault} from '../src/encryption.js';
import {copyPlan,encryptedCopy} from '../src/locations.js';
import {Workspace} from '../src/storage.js';

test('saved plot choices retain exact source windows and result ownership without reconstructing records',async t=>{
 const f=await figureValueFixture({large:true});t.after(f.close);t.mock.method(ResearchCatalogue.prototype,'record',()=>{throw Error('Plot copy reconstructed a record');});
 const target={workspaceId:f.book.id,recordId:f.record.id},page=await figureCopyChoices(f.workspace,{...target,source:null,offset:8});
 assert.equal(page.total,9);assert.equal(page.items.length,3);assert.equal(page.nextOffset,null);assert.equal(page.items[0].plotId,f.record.figures[8].panels[0].figure.id);
 const base=await f.values.read(f.target(f.record.figures[8].id)),edited=structuredClone(base.value.value);edited.panels[0].figure.title='Later source title';edited.panels[0].figure.series[0].points[0].y=2.25;await f.save(base,edited);
 const choice=page.items[0],request={...target,source:page.source,figureId:choice.figureId,plotId:choice.plotId},source=await figureCopySource(f.workspace,request);
 assert.equal(source.statementCount,1);assert.deepEqual(source.figure,f.record.figures[8].panels[0].figure);
 const old=await figureCopyChoices(f.workspace,{...target,source:page.source,offset:0});assert.equal(old.total,9);assert.equal(old.items.length,4);assert.equal(old.nextOffset,4);
 const calculated=await figureCopySource(f.workspace,{...target,source:page.source,figureId:old.items[0].figureId,plotId:old.items[0].plotId});assert.deepEqual(calculated.figure.source,f.analysis);
 for(const patch of [{workspaceId:randomUUID()},{recordId:randomUUID()},{plotId:randomUUID()},{figureId:randomUUID()}])await assert.rejects(figureCopySource(f.workspace,{...request,...patch}));
 await assert.rejects(figureCopyChoices(f.workspace,{...target,source:page.source,offset:0},{signal:AbortSignal.abort()}),{name:'AbortError'});
});

test('panel copy drafts recover with fresh keys and commit retained results atomically with retry receipts',async t=>{
 const f=await figureValueFixture();t.after(f.close);t.mock.method(ResearchCatalogue.prototype,'record',()=>{throw Error('Plot copy reconstructed a record');});
 const target={workspaceId:f.book.id,recordId:f.record.id},page=await figureCopyChoices(f.workspace,{...target,source:null,offset:8}),choice=page.items[0],source=await figureCopySource(f.workspace,{...target,source:page.source,figureId:choice.figureId,plotId:choice.plotId});
 const figure=createComposition([source.figure,source.figure]),base=await f.values.read(f.target(figure.id)),value={value:figure,copies:figure.panels.map(panel=>({source:page.source,figureId:choice.figureId,plotId:choice.plotId,targetId:panel.figure.id}))};
 const selection={field:base.field,revision:base.revision,storageRevision:base.storageRevision},drafts=new RecordValueDrafts(f.workspace),draft={...target,id:randomUUID(),expectedRevision:null,selection,value},checkpoint=await drafts.write(draft);
 assert.equal(await f.workspace.catalogue(store=>catalogueFormat(store.db)),15);
 assert.deepEqual((await drafts.read({workspaceId:f.book.id,id:draft.id,expectedRevision:checkpoint.revision})).value,value);
 await assert.rejects(f.workspace.withLock(()=>f.workspace.catalogue(async store=>{await store.db.run('UPDATE catalogue_format SET version=14');await new ResearchDrafts(f.workspace).read(draft.id,{header:true});})),{code:'CATALOGUE_DAMAGED'});
 const access=await createAccess('','Synthetic copied panel recovery'),vault=takeCreatedVault(access);t.after(()=>clearVault(vault));
 const root=await encryptedCopy(await copyPlan(f.workspace.root,path.join(f.directory,'recovered')),access,vault,f.vault),recovered=new Workspace(root,vault),recovery=new RecordValueDrafts(recovered),header=await new ResearchDrafts(recovered).read(draft.id,{header:true});
 const restored=await recovery.read({workspaceId:f.book.id,id:draft.id,expectedRevision:header.revision});assert.deepEqual(restored.value,value);
 const command={...target,field:base.field,expectedRevision:base.revision,value},values=new RecordValues(recovered),write=recovered.writeMetadata.bind(recovered),before=(await recovered.outline()).etag;
 t.mock.method(recovered,'writeMetadata',async(name,...args)=>{if(name.startsWith('.observanda/figure-copy-values/'))throw Error('Interrupted copy receipt');return write(name,...args);});
 await assert.rejects(values.save(command),/Interrupted copy receipt/);recovered.writeMetadata.mock.restore();assert.equal((await recovered.outline()).etag,before);assert.equal((await values.read({...target,field:base.field})).value.value,null);
 const saved=await values.save(command);assert.deepEqual(await values.save(command),saved);
 const reorder=value=>Array.isArray(value)?value.map(reorder):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).reverse().map(([key,item])=>[key,reorder(item)])):value;
 assert.deepEqual(await values.save(reorder(command)),saved,'A recovered request with reordered JSON properties must reuse its receipt');
 const actual=(await values.read({...target,field:base.field})).value.value;assert.deepEqual(actual,figure);
 await recovered.catalogue(async store=>{
  const row=await store.member(await store.snapshot(),f.record.id);const {withRecordDocument}=await import('../src/record-document.js');
  await withRecordDocument(store,row.id,row.revision,async document=>{const results=(await document.field(['results'])).value.statements;assert.equal(results.length,3);for(const panel of figure.panels){const copied=results.find(s=>s.figureId===panel.figure.id);assert.ok(copied);assert.equal(copied.text,f.record.results.statements[0].text);assert.equal(copied.limitations,f.record.results.statements[0].limitations);assert.notEqual(copied.id,f.record.results.statements[0].id);}});
  await store.verifySnapshot(undefined,f.book.id);
 });
 const invalid=structuredClone(value);invalid.value.panels[0].figure.series[0].points[0].y=999;invalid.value.id=randomUUID();
 const absent=await values.read({...target,field:'figure:'+invalid.value.id});await assert.rejects(values.save({...target,field:absent.field,expectedRevision:absent.revision,value:invalid}),{code:'FIGURE_COPY_CHANGED'});
});
