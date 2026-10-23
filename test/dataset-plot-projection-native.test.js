import test from 'node:test';
import assert from 'node:assert/strict';
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
 const command={recordId,title:'Adjacent exact counters',dataset:source,mapping,base:createFigure()},raw=await m.plot(command),doc=await m.read(raw.ref);assert.equal(doc.content.version,'8');assert.deepEqual(doc.content.denominator.columnIndices,[0,valueColumn,errorColumn]);assert.deepEqual(doc.content.figure.series[0].points.map(p=>p.x),Array.from({length:count},(_,i)=>i+1));assert.equal(doc.content.plotPointsIndex.chunkSize,1);
 const listed=await plotPointPage(m,raw.ref);assert.equal(listed.items.length,16);assert.equal(listed.next,16);assert.equal(Object.hasOwn(listed.items[0],'coordinates'),false);
 const exact=await inspectPlotPoint(m,raw.ref,0);assert.equal(exact.coordinate.y,.1);assert.equal(exact.coordinate.error,.05);assert.deepEqual(exact.members[0].position,{page:0,row:19});assert.deepEqual(exact.coordinates.y.error,{numerator:'1',denominator:'1801439850948198400'});
 const y=exact.members[0].cells.find(c=>c.field==='y');assert.equal(y.source.selector.column,299);assert.equal((await m.measurements.inspect(y.source)).value.spelling,'1000.01');
 const sumMapping={...mapping,x:1,operation:'sum',values:[{column:valueColumn,error:null}],projection:{version:1,y:transform('1000','.1')}},sum=await m.plot({...command,title:'Reduced exact values',mapping:sumMapping}),sumDoc=await m.read(sum.ref);
 const first=await inspectPlotPoint(m,sum.ref,0),last=await inspectPlotPoint(m,sum.ref,0,{offset:16});assert.equal(first.total,20);assert.equal(first.members.length,16);assert.equal(first.next,16);assert.equal(last.members.length,4);assert.equal(last.next,null);assert.equal(first.coordinate.y,190002);assert.equal(first.coordinates.y.exact,'100001/5');assert.deepEqual(last.members.map(v=>v.position.row),[16,17,18,19]);
 await assert.rejects(()=>inspectPlotPoint(m,sum.ref,0,{offset:21}),{code:'INVALID'});
 const counted=await m.plot({...command,title:'Transformed row count',mapping:{...sumMapping,operation:'count',values:[],projection:{version:1,y:transform('0','1')}}}),countDoc=await m.read(counted.ref);assert.equal(countDoc.content.figure.series[0].points[0].y,20);
 const item=m.sequences.item.bind(m.sequences);let tamper=null;m.sequences.item=async(sequence,index)=>{const value=await item(sequence,index);return tamper&&sequence.root?.hash===tamper.root&&index===0?tamper.change(structuredClone(value)):value;};
 try{
  for(const change of [r=>({...r,source:{page:0,row:0}}),r=>{r.coordinates.y.error.numerator='2';return r;}]){tamper={root:doc.content.plotPointsIndex.root.hash,change};await assert.rejects(()=>verifyPlotProjection(m,doc),{code:'CATALOGUE_DAMAGED'});}
  tamper={root:countDoc.content.plotPointsIndex.root.hash,change:r=>{r.coordinates.y.exact='19/1';return r;}};const forged=structuredClone(countDoc);forged.content.figure.series[0].points[0].y=19;await assert.rejects(()=>verifyPlotProjection(m,forged),{code:'CATALOGUE_DAMAGED'});
 }finally{m.sequences.item=item;}
 const changed=structuredClone(doc);changed.content.denominator.columnIndices[0]=1;await assert.rejects(()=>verifySelectedPlot(m,changed),{code:'CATALOGUE_DAMAGED'});
 const abort=new AbortController();abort.abort(new DOMException('Cancelled','AbortError'));const before=(await m.list({recordId,kind:'analysis'})).items.length;await assert.rejects(()=>m.plot({...command,title:'Cancelled projection'},{signal:abort.signal}),{name:'AbortError'});assert.equal((await m.list({recordId,kind:'analysis'})).items.length,before);
 const reopened=new ResearchMaterials(new Workspace(f.workspace.root,f.vault));await reopened.verify();assert.deepEqual((await inspectPlotPoint(reopened,sum.ref,0,{offset:16})).members,last.members);
 const parts=new Map(),transfer=new ResearchTransfer(f.workspace,new Set([recordId]),[book.entries[0].notebookId],part=>parts.set(part.name,part));await transfer.copy([],[(await m.current(raw.ref.id)),(await m.current(sum.ref.id))]);for(const index of [doc.content.plotPointsIndex,sumDoc.content.plotPointsIndex,sumDoc.content.plotMembersIndex])assert.ok(parts.has('.observanda/materials/sequences/nodes/'+index.root.hash+'.json'));
 const access=await createWorkspaceAccess('','',new TestDeviceStore({file:path.join(directory,'recovered-device')})),vault=takeCreatedVault(access);
 try{const copied=await encryptedCopy(await copyPlan(f.workspace.root,path.join(directory,'recovered')),access,vault,f.vault),restored=new ResearchMaterials(new Workspace(copied,vault));await restored.verify();assert.deepEqual((await inspectPlotPoint(restored,raw.ref,0)).coordinates,exact.coordinates);assert.deepEqual((await inspectPlotPoint(restored,sum.ref,0,{offset:16})).members,last.members);assert.deepEqual((await restored.read(raw.ref)).content.mapping.projection,mapping.projection);}finally{clearVault(vault);}
});
