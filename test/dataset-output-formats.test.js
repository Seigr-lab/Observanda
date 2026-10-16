import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {defaultColumn} from '../src/web/dataset-schema.js';
import {exactRational} from '../src/web/measurement-model.js';
import {validCalculation} from '../src/web/dataset-calculation-model.js';
import {validAggregation} from '../src/web/dataset-aggregation-model.js';
import {retainedTable} from '../src/retained-tables.js';
import {PublicationJobs} from '../src/publication-jobs.js';
import {contentBuffer} from '../src/file-content.js';
import {createFigure} from '../src/web/figure-model.js';
import {copyPlan,copyWorkspace} from '../src/locations.js';
import {Workspace} from '../src/storage.js';
import {clearVault} from '../src/encryption.js';
const output=(representation,radix=10)=>({version:1,representation,radix});
const senary=output('radix-fraction',6),col=(label,representation='text',radix=10)=>({...defaultColumn({label}),representation,radix});
const recipe=source=>({version:1,source,view:'observations',joins:[],steps:[],where:null,selectionReason:'',calibration:null,note:''});
const step=(name,operation,column,constant=null,format=senary)=>({name,operation,unit:'',left:{column},right:constant===null?null:{constant,unit:'',representation:'rational',radix:10},condition:null,output:format});
async function fixture(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-result-formats-')),f=await encryptedFixture(directory,sampleNotebook()),m=new ResearchMaterials(f.workspace),recordId=(await f.workspace.read()).book.entries[0].id;
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 async function dataset(text,columns){const bytes=Buffer.from(text),upload=await m.startImport({recordId,name:'readings.csv',size:bytes.length});await m.appendImport(upload.id,0,[bytes]);return m.dataset({recordId,title:'Source readings',artifact:await m.finishImport(upload.id),columns});}
 return {...f,m,recordId,directory,dataset};
}

test('declared result formats survive grouped reduction, dependent calculations, source inspection, publication and recovery',async t=>{
 const f=await fixture(t),source=await f.dataset('State,Reading,Private\n'+Array.from({length:6},(_,i)=>'A,'+(i%2?'0.3':'0.1')+',PRIVATE_SENTINEL').join('\n')+'\nB,-0.3,PRIVATE_SENTINEL\nB,-0.1,PRIVATE_SENTINEL',[col('State'),col('Reading','radix-fraction',6),col('Private')]);
 const aggregation={version:1,source,keys:[0],values:[{column:1,operation:'median',name:'Median',output:senary},{column:1,operation:'count',name:'Count',output:output('radix',6)}],missing:'skip',note:'Exact medians and base-six counts.'};
 const medians=await f.m.dataset({recordId:f.recordId,title:'Native medians',aggregation});
 assert.deepEqual((await f.m.datasetPage(medians)).rows.map(r=>r.cells),[['A','0.2','10'],['B','-0.2','2']]);
 const grouped=await f.m.measurements.inspect({ref:medians,selector:{kind:'cell',page:0,row:0,column:1}});assert.deepEqual(grouped.exact,{numerator:'1',denominator:'3'});assert.equal(grouped.aggregation.members.length,6);assert.equal(grouped.aggregation.source.revision,source.revision);
 const calculation=recipe(medians);calculation.steps=[step('Adjusted','add',1,'1/6'),step('Doubled','multiply',3,'2/1'),step('Decimal count','copy',2,null,output('decimal'))];
 const derived=await f.m.dataset({recordId:f.recordId,title:'Native results',calculation}),rows=(await f.m.datasetPage(derived)).rows;
 assert.deepEqual(rows[0].cells,['A','0.2','10','0.3','1','6']);assert.deepEqual(rows[1].cells,['B','-0.2','2','-0.1','-0.2','2']);
 const schema=await f.m.datasetColumns(await f.m.read(derived));assert.deepEqual(schema.slice(3).map(c=>[c.representation,c.radix]),[['radix-fraction',6],['radix-fraction',6],['decimal',10]]);
 const inspection=await f.m.measurements.inspect({ref:derived,selector:{kind:'cell',page:0,row:1,column:4}});assert.deepEqual(inspection.exact,{numerator:'-1',denominator:'3'});assert.equal(inspection.derivedSources[0].ref.revision,medians.revision);assert.equal(inspection.derivedSources[0].selector.column,1);
 const table=await retainedTable(f.m,{ref:derived,selection:{columns:[0,3,4,5],offset:0,count:20,includeExcluded:false}});assert.equal(table.version,2);assert.deepEqual(table.formats[1],{representation:'radix-fraction',radix:6});
 const legacy=await retainedTable(f.m,{ref:derived,selection:table.selection,version:1});assert.equal(legacy.formats,undefined);
 const record=(await f.workspace.read()).book.entries.find(r=>r.id===f.recordId),statement=(table,title)=>({id:randomUUID(),kind:'table',basis:'retained',source:derived,title,text:'Exact retained values.',limitations:'Synthetic qualification.',table}),next={...record,share:true,results:{version:1,statements:[statement(legacy,'Earlier snapshot'),statement(table,'Native results')]}};
 const records=new ResearchRecords(f.workspace,{}),workspaceId=(await f.workspace.read()).book.id;
 const bad=structuredClone(next);bad.results.statements[1].table.formats[1].radix=8;
 await assert.rejects(records.save({workspaceId,changes:[{id:record.id,expectedRevision:recordRevision(record),record:bad}]}),{code:'DATASET_TABLE'});
 await records.save({workspaceId,changes:[{id:record.id,expectedRevision:recordRevision(record),record:next}]});
 const publication=await new PublicationJobs(f.workspace).inline({etag:(await f.workspace.outline()).etag}),html=(await contentBuffer(publication.files.get('entries/'+record.id+'.html'))).toString();assert.match(html,/Adjusted \(base 6\)/);assert.match(html,/>-0\.2</);assert.ok(!html.includes('PRIVATE_SENTINEL'));assert.ok(!html.includes(source.id));
 const figure=await f.m.plot({recordId:f.recordId,title:'Native differences',dataset:derived,base:createFigure(),mapping:{x:0,xKind:'category',values:[{column:3,error:null}],group:null,operation:'raw',order:'source',kind:'bar',numericPolicy:'approximate'}});assert.equal(figure.figure.series[0].points[0].y,0.5);assert.equal(figure.figure.series[0].points[1].y,-1/6);
 const revised=structuredClone(calculation);revised.steps[0].output=output('rational');const newRef=await f.m.dataset({recordId:f.recordId,id:derived.id,expectedRevision:derived.revision,title:'Recalculated fractions',calculation:revised});assert.equal((await f.m.datasetPage(newRef)).rows[0].cells[3],'1/2');assert.equal((await f.m.datasetPage(derived)).rows[0].cells[3],'0.3');assert.deepEqual((await f.m.read(derived)).content.calculation,calculation);
 const restoredRoot=await copyWorkspace(await copyPlan(f.workspace.root,path.join(f.directory,'restored')),{vault:f.vault}),restored=new ResearchMaterials(new Workspace(restoredRoot,f.vault));assert.deepEqual(await retainedTable(restored,{ref:derived,selection:table.selection}),table);assert.deepEqual((await restored.read(medians)).content.aggregation,aggregation);assert.deepEqual((await restored.measurements.inspect({ref:derived,selector:{kind:'cell',page:0,row:1,column:4}})).exact,inspection.exact);await restored.verify();
});

test('result format refusals preserve current revisions, absent values and earlier recipes',async t=>{
 const f=await fixture(t),source=await f.dataset('State,Reading\n'+Array.from({length:5},(_,i)=>i+',2').join('\n')+'\n5,1',[col('State'),col('Reading','integer')]),calculation=recipe(source);calculation.steps=[step('Half','divide',1,'2/1',output('rational'))];
 const retained=await f.m.dataset({recordId:f.recordId,title:'Complete exact fractions',calculation}),command={recordId:f.recordId,id:retained.id,expectedRevision:retained.revision,title:'Integer results',calculation:structuredClone(calculation)};command.calculation.steps[0].output=output('integer');
 assert.equal((await f.m.previewDataset(command)).rows.length,5);
 await assert.rejects(f.m.dataset(command),{code:'NUMERAL_RESULT_INEXACT'});assert.equal((await f.m.current(retained.id)).revision,retained.revision);assert.equal((await f.m.datasetPage(retained)).rows.at(-1).cells.at(-1),'1/2');
 command.id=randomUUID();command.expectedRevision=null;await assert.rejects(f.m.dataset(command),{code:'NUMERAL_RESULT_INEXACT'});assert.equal(await f.m.current(command.id),null);
 for(const context of [output('radix',1),output('decimal',6),{...senary,round:3},null]){const c=structuredClone(calculation);c.steps[0].output=context;assert.equal(!!validCalculation(c),false);}
 const input=await f.dataset('State,Reading\nA,1\nA,0\nA,0\nB,',[col('State'),col('Reading','integer')]),aggregation={version:1,source:input,keys:[0],values:[{column:1,operation:'mean',name:'Mean',output:output('decimal')},{column:1,operation:'count',name:'Count',output:output('radix',6)}],missing:'skip',note:''},id=randomUUID();
 await assert.rejects(f.m.dataset({recordId:f.recordId,id,title:'Nonterminating decimal',aggregation}),{code:'NUMERAL_RESULT_INEXACT'});assert.equal(await f.m.current(id),null);aggregation.values[0].output=senary;
 const fixed=await f.m.dataset({recordId:f.recordId,id,title:'Exact senary means',aggregation}),rows=(await f.m.datasetPage(fixed)).rows;assert.deepEqual(rows.map(r=>r.cells),[['A','0.2','3'],['B','','0']]);assert.equal(rows[1].valueKinds[1],'absent');
 const bad=structuredClone(aggregation);bad.values[0].output={...senary,version:2};assert.equal(!!validAggregation(bad),false);
 const large=await f.dataset('Counter\n-9007199254740993123456789',[col('Counter','integer')]),c=recipe(large);c.steps=[step('Native counter','copy',0,null,output('radix',6))];const converted=await f.m.dataset({recordId:f.recordId,title:'Exact large counter',calculation:c}),value=(await f.m.datasetPage(converted)).rows[0].cells[1];assert.deepEqual(exactRational(value,'radix',6),exactRational('-9007199254740993123456789','integer'));await f.m.verify();
});
