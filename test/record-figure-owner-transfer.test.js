import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {projectTreeFixture} from './project-tree-fixture.js';
import {LabBookStorage} from '../src/lab-book-storage.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {ResearchDrafts} from '../src/research-drafts.js';
import {RecordValues} from '../src/record-values.js';
import {RecordValueDrafts} from '../src/record-value-drafts.js';
import {RecordFigureDrafts} from '../src/record-figure-drafts.js';
import {RetainedFigureAuthoring} from '../src/retained-figure-authoring.js';
import {RetainedFigureDocuments} from '../src/retained-figure-document.js';
import {RecordOwnerTransfer} from '../src/record-owner-transfer.js';
import {verifyResearchDrafts} from '../src/research-draft-verification.js';
import {createFigure} from '../src/web/figure-model.js';
import {createComposition} from '../src/web/figure-composition.js';
import {figureCopyChoices} from '../src/record-figure-copy-values.js';
import {withRecordDocument} from '../src/record-document.js';
const media={get:async()=>{throw Error('Unexpected media');}};
const selection=value=>({field:value.field,revision:value.revision,storageRevision:value.storageRevision});
const collect=async reader=>{let json='';for await(const chunk of reader.json())json+=chunk;return JSON.parse(json);};

test('selected record transfer retains unsaved manual figure blocks and nested authored checkpoints through cancellation and recovery',{timeout:240000},async t=>{
 const f=await projectTreeFixture(t),[from,to]=f.books,source=new LabBookStorage(from.root,from.labBookId,from.key),target=new LabBookStorage(to.root,to.labBookId,to.key);
 const original=structuredClone(from.before.book.entries[0]),sourceFigure=createFigure();sourceFigure.series[0].points=[{x:11,y:13,error:null}];const linked={id:randomUUID(),kind:'figure',figureId:sourceFigure.id,title:'Original copied result',text:'One exact observation.',limitations:'Synthetic transfer only.',basis:'authored',source:null},record={...original,figures:[sourceFigure],results:{version:1,statements:[linked]}};await new ResearchRecords(source,media).save({workspaceId:from.namespaceId,changes:[{id:record.id,expectedRevision:recordRevision(original),record}]});
 const values=new RecordValues(source),figureId=randomUUID(),base=await values.read({workspaceId:from.namespaceId,recordId:record.id,field:'figure:'+figureId}),draftId=randomUUID(),drafts=new RecordFigureDrafts(source),command={id:draftId,workspaceId:from.namespaceId,recordId:record.id,selection:selection(base)};
 let saved=await drafts.start({...command,expectedRevision:null,operationId:randomUUID(),create:'plot'});
 const read=(operation,scope)=>drafts.read({id:draftId,workspaceId:from.namespaceId,expectedRevision:saved.revision,operation,selection:scope});
 const panel=(await read('window',{collection:'panels',limit:1})).items[0],series=(await read('window',{collection:'series',plotId:panel.plotId,limit:1})).items[0];
 saved=await drafts.change({...command,expectedRevision:saved.revision,operationId:randomUUID(),operation:{type:'append',collection:'points',plotId:panel.plotId,seriesId:series.id,value:{x:null,y:7,error:null}}});
 const point=(await read('window',{collection:'points',plotId:panel.plotId,limit:1})).items[0],draftFigure=saved.value.value,unique='.observanda/materials/figures/value/'+draftFigure.document.data.root+'.json';
 assert.notEqual(await source.readMetadata(unique,65536),null);assert.equal(await target.readMetadata(unique,65536),null);assert.equal((await values.read({workspaceId:from.namespaceId,recordId:record.id,field:base.field})).value.value,null);
 // An inline composition can contain a separately retained authored child.
 // Its selected checkpoint must verify each retained descendant, not the outer
 // inline composition as though that wrapper itself were a retained document.
 const inline=createFigure();inline.series[0].points=[{x:1,y:2,error:null}];const authoring=new RetainedFigureAuthoring(source,{write:operation=>source.withLock(operation)}),child=await authoring.finish(await authoring.start(inline)),other=createFigure();other.series[0].points=[{x:3,y:4,error:null}];const composed=createComposition([child,other]),nestedId=randomUUID(),nestedBase=await values.read({workspaceId:from.namespaceId,recordId:record.id,field:'figure:'+composed.id});
 await new RecordValueDrafts(source).write({id:nestedId,workspaceId:from.namespaceId,recordId:record.id,selection:selection(nestedBase),expectedRevision:null,value:{value:composed}});
 const nested=await new ResearchDrafts(source).read(nestedId,{header:true});assert.deepEqual((await new RecordValueDrafts(source).read({id:nestedId,workspaceId:from.namespaceId,expectedRevision:nested.revision})).value.value,composed);
 const choices=await figureCopyChoices(source,{workspaceId:from.namespaceId,recordId:record.id,source:null,offset:0}),copyId=randomUUID(),copyFigureId=randomUUID(),copyBase=await values.read({workspaceId:from.namespaceId,recordId:record.id,field:'figure:'+copyFigureId}),copyCommand={id:copyId,workspaceId:from.namespaceId,recordId:record.id,selection:selection(copyBase)};
 let copied=await drafts.start({...copyCommand,expectedRevision:null,operationId:randomUUID(),create:'plot'});copied=await drafts.import({...copyCommand,expectedRevision:copied.revision,operationId:randomUUID(),source:{ref:choices.source,figureId:sourceFigure.id,plotId:sourceFigure.id},mode:'replace',plotId:copyFigureId});assert.equal(copied.value.copies.length,1);assert.equal(copied.value.copies[0].source.workspaceId,from.namespaceId);
 const sourceOwner={projectId:from.projectId,labBookId:from.labBookId,workspaceId:from.namespaceId},targetOwner={projectId:to.projectId,labBookId:to.labBookId,workspaceId:to.namespaceId},transfer=new RecordOwnerTransfer(source,target,{registry:f.registry,sourceOwner,targetOwner});
 const move={id:randomUUID(),workspaceId:from.namespaceId,recordId:record.id,sourceNotebookId:from.labBookId,expectedStorageRevision:base.storageRevision,targetWorkspaceId:to.namespaceId,targetNotebookId:to.labBookId},status=id=>({workspaceId:from.namespaceId,recordId:record.id,id});
 await assert.rejects(transfer.start(move,{checkpoint:async stage=>{if(stage==='verified')throw Error('Pause at verified manual figure transfer');}}),/Pause at verified manual figure transfer/);
 assert.equal((await transfer.status(status(move.id))).phase,'verified');assert.notEqual(await target.readMetadata(unique,65536),null);assert.equal(await new ResearchDrafts(target).read(draftId,{header:true}),null);
 await transfer.cancel(status(move.id));assert.equal(await target.readMetadata(unique,65536),null);assert.equal((await new ResearchDrafts(target).list({workspaceId:to.namespaceId})).drafts.length,0);assert.equal((await new ResearchDrafts(source).read(draftId,{header:true})).revision,saved.revision);
 const completed=await transfer.start({...move,id:randomUUID()});assert.equal(completed.phase,'complete');
 const reopened=new LabBookStorage(to.root,to.labBookId,to.key),receivingDrafts=new ResearchDrafts(reopened),received=await receivingDrafts.read(draftId,{header:true});
 assert.deepEqual((await new RecordValueDrafts(reopened).read({id:draftId,workspaceId:to.namespaceId,expectedRevision:received.revision})).value,saved.value);
 const migratedNested=await receivingDrafts.read(nestedId,{header:true});assert.deepEqual((await new RecordValueDrafts(reopened).read({id:nestedId,workspaceId:to.namespaceId,expectedRevision:migratedNested.revision})).value.value,composed);
 const receivingValues=new RecordValues(reopened),targetValue={workspaceId:to.namespaceId,recordId:record.id,field:base.field};assert.equal((await receivingValues.read(targetValue)).value.value,null);
 const receiving=new RecordFigureDrafts(reopened),receivedCommand={id:draftId,workspaceId:to.namespaceId,recordId:record.id,selection:received.draft.selection};
 let continued=await receiving.change({...receivedCommand,expectedRevision:received.revision,operationId:randomUUID(),operation:{type:'patch',collection:'points',plotId:panel.plotId,id:point.id,patch:{x:2}}});
 continued=await receiving.finish({...receivedCommand,expectedRevision:continued.revision,operationId:randomUUID()});const current=await receivingValues.read(targetValue);await receivingValues.save({...targetValue,expectedRevision:current.revision,value:continued.value});
 const final=(await receivingValues.read(targetValue)).value.value;assert.equal(final.document.format,'figure-document');assert.deepEqual((await collect(await new RetainedFigureDocuments(reopened,{readOnly:true}).open(final))).series[0].points,[{x:2,y:7,error:null}]);
 const copiedHeader=await receivingDrafts.read(copyId,{header:true}),copiedValue=await new RecordValueDrafts(reopened).read({id:copyId,workspaceId:to.namespaceId,expectedRevision:copiedHeader.revision});assert.deepEqual(copiedValue.value,copied.value);assert.equal(copiedHeader.draft.figureCopies[0].source.workspaceId,from.namespaceId);await reopened.catalogue(store=>verifyResearchDrafts(store));
 const finishedCopy=await receiving.finish({id:copyId,workspaceId:to.namespaceId,recordId:record.id,selection:copiedHeader.draft.selection,expectedRevision:copiedHeader.revision,operationId:randomUUID()}),copyTarget={workspaceId:to.namespaceId,recordId:record.id,field:'figure:'+copyFigureId},currentCopy=await receivingValues.read(copyTarget);await receivingValues.save({...copyTarget,expectedRevision:currentCopy.revision,value:finishedCopy.value});
 await reopened.catalogue(async store=>{const row=await store.member(await store.snapshot(),record.id);await withRecordDocument(store,row.id,row.revision,async document=>{const statements=(await document.field(['results','statements'])).value;assert.equal(statements.length,2);assert.deepEqual(statements.find(value=>value.id===linked.id),linked);const retained=statements.find(value=>value.figureId===copyFigureId);assert.equal(retained.text,linked.text);assert.equal(retained.limitations,linked.limitations);assert.notEqual(retained.id,linked.id);});await verifyResearchDrafts(store);});assert.equal(await new ResearchDrafts(source).read(draftId,{header:true}),null);

});
