import {RetainedFigureDocuments} from '../src/retained-figure-document.js';
import {changeRetainedFigureRequest} from '../src/retained-figure-presentation.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {clearVault} from '../src/encryption.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {Workspace} from '../src/storage.js';
import {createFigure} from '../src/web/figure-model.js';
import {plotPointPage,inspectPlotPoint,verifyPlotProjection} from '../src/dataset-plot-provenance.js';
import {verifySelectedPlot} from '../src/dataset-plot-selection.js';
import {copyPlan,encryptedCopy} from '../src/locations.js';
import {createWorkspaceAccess,takeCreatedVault} from '../src/access.js';
import {TestDeviceStore} from './device-fixture.js';
import {ResearchTransfer} from '../src/collaboration/research-transfer.js';
import {transformedPlotDataset,plotCounterOrigin} from './fixtures/transformed-plot-dataset.js';
const q=spelling=>({spelling,representation:'decimal',radix:10}),transform=(origin,scale)=>({origin:q(origin),scale:q(scale)});

test('transformed wide plots retain sorted exact cells, paged reduction members and errors through fresh-key recovery',{timeout:180000},async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-plot-projection-')),book=sampleNotebook(),f=await encryptedFixture(directory,book),m=new ResearchMaterials(f.workspace),recordId=book.entries[0].id;
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 const {source,valueColumn,errorColumn,count}=await transformedPlotDataset(m,recordId),mapping={x:0,xKind:'number',group:null,values:[{column:valueColumn,error:errorColumn}],kind:'scatter',operation:'raw',order:'ascending',projection:{version:1,x:transform(plotCounterOrigin,'.001'),y:transform('1000','.1')}};
 const command={recordId,title:'Adjacent exact counters',dataset:source,mapping,base:createFigure()},raw=await m.plot(command),doc=await m.read(raw.ref);assert.equal(doc.content.version,'9');assert.deepEqual(doc.content.denominator.columnIndices,[0,valueColumn,errorColumn]);const reader=await new RetainedFigureDocuments(m.workspace,{readOnly:true}).open(doc.content.figure),points=await reader.window({collection:'points',limit:128});assert.deepEqual(points.items.map(p=>p.value.x),Array.from({length:count},(_,i)=>i+1));assert.equal(Object.hasOwn(doc.content,'plotPointsIndex'),false);assert.equal(Object.hasOwn(doc.content.figure,'series'),false);
 const listed=await plotPointPage(m,raw.ref);assert.equal(listed.items.length,16);assert.equal(listed.next,16);assert.equal(Object.hasOwn(listed.items[0],'coordinates'),false);
 const exact=await inspectPlotPoint(m,raw.ref,0);assert.equal(exact.coordinate.y,.1);assert.equal(exact.coordinate.error,.05);assert.deepEqual(exact.members[0].position,{page:0,row:19});assert.deepEqual(exact.coordinates.y.error,{numerator:'1',denominator:'1801439850948198400'});
 const y=exact.members[0].cells.find(c=>c.field==='y');assert.equal(y.source.selector.column,299);assert.equal((await m.measurements.inspect(y.source)).value.spelling,'1000.01');
 const sumMapping={...mapping,x:1,operation:'sum',values:[{column:valueColumn,error:null}],projection:{version:1,y:transform('1000','.1')}},sum=await m.plot({...command,title:'Reduced exact values',mapping:sumMapping}),sumDoc=await m.read(sum.ref);
 const first=await inspectPlotPoint(m,sum.ref,0),last=await inspectPlotPoint(m,sum.ref,0,{offset:16});assert.equal(first.total,20);assert.equal(first.members.length,16);assert.equal(first.next,16);assert.equal(last.members.length,4);assert.equal(last.next,null);assert.equal(first.coordinate.y,190002);assert.equal(first.coordinates.y.exact,'100001/5');assert.deepEqual(last.members.map(v=>v.position.row),[16,17,18,19]);
 await assert.rejects(()=>inspectPlotPoint(m,sum.ref,0,{offset:21}),{code:'INVALID'});
 const counted=await m.plot({...command,title:'Transformed row count',mapping:{...sumMapping,operation:'count',values:[],projection:{version:1,y:transform('0','1')}}}),countDoc=await m.read(counted.ref);const countReader=await new RetainedFigureDocuments(m.workspace,{readOnly:true}).open(countDoc.content.figure);assert.equal((await countReader.rawPoint({offset:0})).value.y,20);
 const open=RetainedFigureDocuments.prototype.open,firstPoint=await reader.rawPoint({offset:0}),countPoint=await countReader.rawPoint({offset:0});let tamper=null;
 RetainedFigureDocuments.prototype.open=async function(value){const opened=await open.call(this,value),read=opened.tree.read.bind(opened.tree);opened.tree.read=async revision=>{const data=await read(revision);return tamper&&revision===tamper.root?tamper.change(structuredClone(data)):data;};return opened;};
 try{
  for(const change of [p=>{p.source.source={page:0,row:0};return p;},p=>{p.source.coordinates.y.error.numerator='2';return p;}]){tamper={root:firstPoint.member.body,change};await assert.rejects(()=>verifyPlotProjection(m,doc),{code:'CATALOGUE_DAMAGED'});}
  tamper={root:countPoint.member.body,change:p=>{p.source.coordinates.y.exact='19/1';p.y=19;return p;}};await assert.rejects(()=>verifyPlotProjection(m,countDoc),{code:'CATALOGUE_DAMAGED'});
 }finally{RetainedFigureDocuments.prototype.open=open;}
 const edit={operationId:randomUUID(),recordId,ref:raw.ref,operation:{type:'patch',collection:'series',id:points.items[0].seriesId,patch:{color:'#123456',name:'Retained exact counters'}}},styled=await changeRetainedFigureRequest(m,edit);assert.deepEqual(await changeRetainedFigureRequest(new ResearchMaterials(new Workspace(f.workspace.root,f.vault)),edit),styled);await assert.rejects(()=>changeRetainedFigureRequest(m,{...edit,operation:{...edit.operation,patch:{color:'#111111'}}}),{code:'MATERIAL_CHANGED'});assert.deepEqual(styled.figure.document.data,doc.content.figure.document.data);assert.notDeepEqual(styled.figure.document.presentation,doc.content.figure.document.presentation);assert.deepEqual((await inspectPlotPoint(m,styled.ref,0,{pointId:points.items[0].id,seriesId:points.items[0].seriesId})).coordinates,exact.coordinates);
 const fork=await changeRetainedFigureRequest(m,{operationId:randomUUID(),recordId,ref:raw.ref,operation:{type:'patch',collection:'header',patch:{legend:false}}});assert.notEqual(fork.ref.id,raw.ref.id);assert.equal((await m.current(raw.ref.id)).revision,styled.ref.revision);assert.deepEqual(fork.figure.document.data,doc.content.figure.document.data);
 assert.equal((await m.read(raw.ref)).content.figure.document.presentation.root,doc.content.figure.document.presentation.root);
 const changed=structuredClone(doc);changed.content.denominator.columnIndices[0]=1;await assert.rejects(()=>verifySelectedPlot(m,changed),{code:'CATALOGUE_DAMAGED'});
 const abort=new AbortController();abort.abort(new DOMException('Cancelled','AbortError'));const before=(await m.list({recordId,kind:'analysis'})).items.length;await assert.rejects(()=>m.plot({...command,title:'Cancelled projection'},{signal:abort.signal}),{name:'AbortError'});assert.equal((await m.list({recordId,kind:'analysis'})).items.length,before);
 const reopened=new ResearchMaterials(new Workspace(f.workspace.root,f.vault));await reopened.verify();assert.deepEqual((await inspectPlotPoint(reopened,sum.ref,0,{offset:16})).members,last.members);
 const parts=new Map(),transfer=new ResearchTransfer(f.workspace,new Set([recordId]),[book.entries[0].notebookId],part=>parts.set(part.name,part));await transfer.copy([],[(await m.current(raw.ref.id)),(await m.current(sum.ref.id))]);assert.ok(parts.has('.observanda/materials/sequences/nodes/'+sumDoc.content.plotMembersIndex.root.hash+'.json'));for await(const block of reader.blocks())assert.ok(parts.has(block.path));
 const access=await createWorkspaceAccess('','',new TestDeviceStore({file:path.join(directory,'recovered-device')})),vault=takeCreatedVault(access);
 try{const copied=await encryptedCopy(await copyPlan(f.workspace.root,path.join(directory,'recovered')),access,vault,f.vault),restored=new ResearchMaterials(new Workspace(copied,vault));await restored.verify();assert.deepEqual(await changeRetainedFigureRequest(restored,edit),styled);assert.deepEqual((await inspectPlotPoint(restored,raw.ref,0)).coordinates,exact.coordinates);assert.deepEqual((await inspectPlotPoint(restored,sum.ref,0,{offset:16})).members,last.members);assert.deepEqual((await restored.read(raw.ref)).content.mapping.projection,mapping.projection);}finally{clearVault(vault);}
});


test('retained presentation forks discarded and historical sources and replays exact commands after reopen',{timeout:60000},async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-figure-presentation-')),book=sampleNotebook(),f=await encryptedFixture(directory,book),m=new ResearchMaterials(f.workspace),recordId=book.entries[0].id;
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 const figure=createFigure();figure.series[0].points=[{x:1,y:2,error:null},{x:2,y:3,error:null}];
 const retained=await f.workspace.withLock(()=>new RetainedFigureDocuments(f.workspace).retain(figure)),source=await f.workspace.withLock(()=>m.commit({kind:'analysis',recordId,title:'Presentation source',content:{inputs:[],tool:'Retained presentation fixture',version:'1',parameters:'Known measurements',figure:retained}}));
 const command={operationId:randomUUID(),recordId,ref:{...source,workspaceId:book.id},operation:{type:'text',collection:'header',field:'title',offset:0,remove:figure.title.length,text:'Documented observations'}},first=await changeRetainedFigureRequest(m,command);assert.equal(first.ref.id,source.id);assert.equal((await m.current(source.id)).revision,first.ref.revision);
 const secondCommand={...command,operationId:randomUUID(),operation:{type:'patch',collection:'series',id:figure.series[0].id,patch:{name:'Historical presentation'}}},fork=await changeRetainedFigureRequest(m,secondCommand);assert.notEqual(fork.ref.id,source.id);assert.equal((await m.current(source.id)).revision,first.ref.revision);assert.equal((await m.read(source)).content.figure.document.presentation.root,retained.document.presentation.root);
 for(const result of [first,fork])assert.deepEqual(result.figure.document.data,retained.document.data);
 const reopened=new ResearchMaterials(new Workspace(f.workspace.root,f.vault));assert.deepEqual(await changeRetainedFigureRequest(reopened,command),first);assert.deepEqual(await changeRetainedFigureRequest(reopened,secondCommand),fork);
 assert.equal(first.figure.title,'Documented observations');const longTitle='Long '+('\u03bb'.repeat(1500)),extend={operationId:randomUUID(),recordId,ref:fork.ref,operation:{type:'text',collection:'header',field:'title',offset:0,remove:figure.title.length,text:longTitle}},long=await changeRetainedFigureRequest(reopened,extend);assert.equal(long.figure.title.characters,longTitle.length);
 const shorten={operationId:randomUUID(),recordId,ref:long.ref,operation:{type:'text',collection:'header',field:'title',offset:0,remove:longTitle.length,text:'Short retained title'}},short=await changeRetainedFigureRequest(reopened,shorten);assert.equal(short.figure.title,'Short retained title');const again=new ResearchMaterials(new Workspace(f.workspace.root,f.vault));assert.deepEqual(await changeRetainedFigureRequest(again,extend),long);assert.deepEqual(await changeRetainedFigureRequest(again,shorten),short);const shortReader=await new RetainedFigureDocuments(again.workspace,{readOnly:true}).open((await again.read(short.ref)).content.figure);assert.equal((await shortReader.header()).header.title,'Short retained title');await shortReader.verify();

 await assert.rejects(()=>changeRetainedFigureRequest(reopened,{...secondCommand,operation:{type:'patch',collection:'header',patch:{legend:true}}}),{code:'MATERIAL_CHANGED'});
 const abort=new AbortController();abort.abort(new DOMException('Cancelled','AbortError'));await assert.rejects(()=>changeRetainedFigureRequest(reopened,{...command,operationId:randomUUID()},{signal:abort.signal}),{name:'AbortError'});
 await reopened.verify();
});
