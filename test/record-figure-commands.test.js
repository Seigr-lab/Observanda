import {catalogueFormat,catalogueRequiresNativeNumericalModels} from '../src/catalogue-format.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {figureValueFixture} from './record-figure-values-fixture.js';
import {RecordFigureCommands} from '../src/record-figure-commands.js';
import {RetainedFigureDocuments} from '../src/retained-figure-document.js';
import {RecordValues} from '../src/record-values.js';
import {RecordValueDrafts} from '../src/record-value-drafts.js';
import {RecordWriting} from '../src/record-writing.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {RecordContent} from '../src/record-content.js';
import {withRecordDocument} from '../src/record-document.js';
import {createFigure} from '../src/web/figure-model.js';
import {createAccess,takeCreatedVault} from '../src/access.js';
import {clearVault} from '../src/encryption.js';
import {copyPlan,encryptedCopy} from '../src/locations.js';
import {Workspace} from '../src/storage.js';
const forbidRecord=t=>t.mock.method(ResearchCatalogue.prototype,'record',()=>{throw Error('Figure commands reconstructed a full record');});
const command=(f,base,action)=>({workspaceId:f.book.id,recordId:f.record.id,id:randomUUID(),figureId:base.value.value.id,action,expectedRevision:base.revision});
const inspect=(f,callback)=>f.workspace.catalogue(async store=>{const row=await store.member(await store.snapshot(),f.record.id);return withRecordDocument(store,row.id,row.revision,callback);});

test('figure copies retain exact sources and results, keep separate identities, and retry without repeating their effect',async t=>{
 const f=await figureValueFixture();t.after(f.close);forbidRecord(t);const commands=new RecordFigureCommands(f.workspace),base=await f.values.read(f.target(f.record.figures[0].id)),copyCommand=command(f,base,'duplicate'),copy=await commands.run(copyCommand);
 assert.equal(copy.figureId,copyCommand.id);assert.equal(copy.position,9);assert.deepEqual(await commands.run(copyCommand),copy);
 const duplicate=await f.values.read(f.target(copy.figureId));assert.deepEqual(duplicate.value.value.source,f.analysis);assert.notEqual(duplicate.value.value.series[0].id,base.value.value.series[0].id);assert.deepEqual(duplicate.value.value.series[0].points,base.value.value.series[0].points);
 const changed={...duplicate.value.value,title:'Independent duplicate'};await f.save(duplicate,changed);assert.deepEqual(await commands.run(copyCommand),copy);assert.equal((await f.values.read(f.target(copy.figureId))).value.value.title,changed.title);
 const legacy=structuredClone(base.value.value);delete legacy.source;legacy.title='Legacy implicit calculation';await f.save(base,legacy);const legacyBase=await f.values.read(f.target(legacy.id)),legacyCopy=await commands.run(command(f,legacyBase,'duplicate'));assert.deepEqual((await f.values.read(f.target(legacyCopy.figureId))).value.value.source,f.analysis);
 const panelBase=await f.values.read(f.target(f.record.figures[8].id)),panels=await commands.run(command(f,panelBase,'duplicate')),copiedPanels=(await f.values.read(f.target(panels.figureId))).value.value;
 assert.notEqual(copiedPanels.panels[0].id,panelBase.value.value.panels[0].id);assert.notEqual(copiedPanels.panels[0].figure.id,panelBase.value.value.panels[0].figure.id);
 const results=await inspect(f,async doc=>(await doc.field(['results'])).value);assert.equal(results.statements.length,2);assert.equal(results.statements[1].figureId,copiedPanels.panels[0].figure.id);assert.notEqual(results.statements[1].id,results.statements[0].id);assert.equal(results.statements[1].limitations,results.statements[0].limitations);
 await assert.rejects(commands.run(command(f,panelBase,'remove')),{code:'FIGURE_RESULTS'});
 const prior=(await f.workspace.outline()).etag,remove=command(f,await f.values.read(f.target(copy.figureId)),'remove');await commands.run(remove);assert.equal((await f.values.read(f.target(copy.figureId))).value.value,null);
 const empty=await f.values.read(f.target(copy.figureId));await f.save(empty,changed);await commands.run(remove);assert.equal((await f.values.read(f.target(copy.figureId))).value.value.title,changed.title);
 const late=await new RecordContent(f.workspace).read({workspaceId:f.book.id,recordId:f.record.id,snapshotId:prior,pagedHeader:true,windows:{figures:9}});assert.equal(late.header.figures[0].title,changed.title);assert.deepEqual((await f.materials.read(f.analysis)).content.figure.series[0].points,base.value.value.series[0].points);
 await assert.rejects(commands.run({...copyCommand,action:'remove'}),{code:'RECORD_CHANGED'});await assert.rejects(commands.run({...copyCommand,id:randomUUID(),workspaceId:randomUUID()}),{code:'WORKSPACE_CHANGED'});await assert.rejects(commands.run({...copyCommand,action:'__proto__'}),{code:'INVALID'});
 // Native retained compositions must remap every child target, not only the
 // wrapper, while copying root/child result statements in their original order.
 const retained=await f.workspace.withLock(()=>new RetainedFigureDocuments(f.workspace).retain(panelBase.value.value)),source=await f.workspace.withLock(()=>f.materials.commit({kind:'analysis',recordId:f.record.id,title:'Retained comparison',content:{inputs:[],outputs:[],tool:'Synthetic retained comparison',version:'1',parameters:'Exact retained observations',figure:retained}}));await f.save(panelBase,{...retained,source});
 await assert.rejects(commands.run(command(f,await f.values.read(f.target(retained.id)),'remove')),{code:'FIGURE_RESULTS'});
 const rootStatement={...f.record.results.statements[0],id:randomUUID(),figureId:retained.id,title:'Whole comparison'},resultTarget={workspaceId:f.book.id,recordId:f.record.id,field:'result:'+rootStatement.id},resultBase=await f.values.read(resultTarget);await f.values.save({...resultTarget,expectedRevision:resultBase.revision,value:{value:rootStatement}});
 const retainedBase=await f.values.read(f.target(retained.id)),retainedCommand=command(f,retainedBase,'duplicate'),retainedResult=await commands.run(retainedCommand);assert.deepEqual(await commands.run(retainedCommand),retainedResult);const retainedCopy=(await f.values.read(f.target(retainedResult.figureId))).value.value,documents=new RetainedFigureDocuments(f.workspace,{readOnly:true}),reader=await documents.open(retainedCopy),priorReader=await documents.open(retainedBase.value.value);await reader.verify();
 const sourcePanels=(await priorReader.window({collection:'panels',limit:128})).items,copyPanels=(await reader.window({collection:'panels',limit:128})).items;assert.equal(copyPanels.length,sourcePanels.length);
 for(let i=0;i<sourcePanels.length;i++){assert.notEqual(copyPanels[i].id,sourcePanels[i].id);assert.notEqual(copyPanels[i].plotId,sourcePanels[i].plotId);assert.equal(copyPanels[i].value.label,sourcePanels[i].value.label);const a=(await priorReader.window({collection:'points',plotId:sourcePanels[i].plotId,limit:128})).items,b=(await reader.window({collection:'points',plotId:copyPanels[i].plotId,limit:128})).items;assert.equal(a.length,b.length);for(let at=0;at<a.length;at++){assert.deepEqual(b[at].value.source.origin,{ref:source,seriesId:a[at].seriesId,pointId:a[at].id});assert.deepEqual({...b[at].value,source:undefined},{...a[at].value,source:undefined});}}
 const allResults=(await inspect(f,async doc=>(await doc.field(['results'])).value)).statements,tail=allResults.slice(-2);assert.deepEqual(tail.map(item=>item.figureId),[copyPanels[0].plotId,retainedCopy.id]);assert.deepEqual(tail.map(item=>item.title),[f.record.results.statements[0].title,rootStatement.title]);assert.deepEqual((await f.values.read(f.target(retained.id))).value.value,retainedBase.value.value);
 await f.workspace.catalogue(store=>store.verifySnapshot(undefined,f.book.id));
});

test('new figure checkpoints and completed command receipts survive fresh-key recovery on heavy records',async t=>{
 const f=await figureValueFixture({large:true});t.after(f.close);forbidRecord(t);const figure=createFigure(),base=await f.values.read(f.target(figure.id));figure.title='New captured observations';figure.series[0].points=[{x:1,y:5,error:null}];figure.projection={version:1,x:{origin:{spelling:'1000000000000000000000000000000',representation:'decimal',radix:10},scale:{spelling:'0.001',representation:'decimal',radix:10}}};
 const drafts=new RecordValueDrafts(f.workspace),checkpoint={id:randomUUID(),workspaceId:f.book.id,recordId:f.record.id,expectedRevision:null,selection:{field:base.field,revision:base.revision,storageRevision:base.storageRevision},value:{value:figure}},receipt=await drafts.write(checkpoint),lookup={id:checkpoint.id,workspaceId:f.book.id,expectedRevision:receipt.revision};assert.deepEqual((await drafts.read(lookup)).value,checkpoint.value);
 const commands=new RecordFigureCommands(f.workspace),copyCommand=command(f,await f.values.read(f.target(f.record.figures[0].id)),'duplicate'),copied=await commands.run(copyCommand);
 const access=await createAccess('','synthetic figure collection recovery'),vault=takeCreatedVault(access);t.after(()=>clearVault(vault));const root=await encryptedCopy(await copyPlan(f.workspace.root,path.join(f.directory,'recovered')),access,vault,f.vault),workspace=new Workspace(root,vault),recovered=await new RecordValueDrafts(workspace).read(lookup);
 assert.deepEqual(recovered.value,checkpoint.value);assert.equal(await workspace.catalogue(async store=>catalogueRequiresNativeNumericalModels(await catalogueFormat(store.db))),true);await new RecordValues(workspace).save({...f.target(figure.id),expectedRevision:base.revision,value:recovered.value});assert.deepEqual(await new RecordFigureCommands(workspace).run(copyCommand),copied);
 await workspace.catalogue(async store=>{const row=await store.member(await store.snapshot(),f.record.id);await withRecordDocument(store,row.id,row.revision,async doc=>{assert.equal(await doc.tree.arrayLength(doc.root,['figures']),11);assert.deepEqual((await doc.field(['figures','10'])).value,figure);assert.deepEqual((await doc.field(['sections','72'])).value,f.record.sections[72]);});await store.verifySnapshot(undefined,f.book.id);});
});

test('figure removal checks late narrative placements and stale edits; receipt failure rolls back the whole copy',async t=>{
 const f=await figureValueFixture();t.after(f.close);forbidRecord(t);const commands=new RecordFigureCommands(f.workspace),base=await f.values.read(f.target(f.record.figures[1].id)),writing=new RecordWriting(f.workspace),target={workspaceId:f.book.id,recordId:f.record.id,sectionId:f.record.sections[72].id},section=await writing.read(target);
 await writing.save({...target,expectedRevision:section.revision,value:{title:'Placed figure',body:{type:'doc',content:[{type:'book_figure',attrs:{version:1,id:randomUUID(),figureId:base.value.value.id,alternative:'Evidence'}},{type:'paragraph'}]}}});await assert.rejects(commands.run(command(f,base,'remove')),{code:'FIGURE_IN_USE'});
 await f.save(base,{...base.value.value,title:'Changed since review'});await assert.rejects(commands.run(command(f,base,'remove')),{code:'RECORD_CHANGED'});
 const copyCommand=command(f,await f.values.read(f.target(f.record.figures[0].id)),'duplicate'),etag=(await f.workspace.outline()).etag,write=Workspace.prototype.writeMetadata;
 t.mock.method(Workspace.prototype,'writeMetadata',async function(file,...args){const result=await write.call(this,file,...args);if(file.startsWith('.observanda/figure-commands/'))throw Error('Interrupted receipt');return result;});await assert.rejects(commands.run(copyCommand),/Interrupted receipt/);Workspace.prototype.writeMetadata.mock.restore();
 assert.equal((await f.workspace.outline()).etag,etag);assert.equal((await f.values.read(f.target(copyCommand.id))).value.value,null);assert.equal(await f.workspace.readMetadata('.observanda/figure-commands/'+copyCommand.id+'.json',4096),null);await commands.run(copyCommand);await f.workspace.catalogue(store=>store.verifySnapshot(undefined,f.book.id));
});
