import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {upgradeNotebook} from '../src/model.js';
import {sampleNotebook} from '../src/sample.js';
import {clearVault} from '../src/encryption.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {Laboratory} from '../src/laboratory.js';
import {SampleAnalysisReader} from '../src/sample-analysis-reader.js';
import {materialReference} from '../src/web/material-reference.js';
import {defaultDatasetResourcePolicy} from '../src/web/dataset-resource-policy.js';

test('a result binds one retained cell or measurement and its supporting revisions through review and historical export',async t=>{
  const directory=await mkdtemp(path.join(tmpdir(),'observanda-result-pins-')),book=upgradeNotebook(sampleNotebook());
  const {workspace,vault}=await encryptedFixture(directory,book);
  t.after(async()=>{await clearVault(vault);await rm(directory,{recursive:true,force:true});});
  const materials=new ResearchMaterials(workspace),lab=new Laboratory(workspace),reader=new SampleAnalysisReader(lab);
  const recordId=book.entries[0].id,workspaceId=book.id;
  const pinned=value=>materialReference({...value,workspaceId});
  const upload=async(name,bytes)=>{
    const input=await materials.startImport({recordId,name,size:bytes.length});
    await materials.appendImport(input.id,0,[bytes]);
    return materials.finishImport(input.id);
  };
  const long='0'.repeat(4500)+'1';
  const csv=await upload('readings.csv',Buffer.from('Readout,Status\n0.1,first\n,missing\n0,zero\n'+long+',retained'));
  const calibration=await upload('calibration.txt',Buffer.from('Reference measurement for this run'));
  const method=await materials.pinRecord(recordId,(await materials.recordSummary(recordId)).revision);
  const time={kind:'none',reference:'',resolution:'',uncertainty:''};
  const columns=[{name:'Readout',unit:'',representation:'radix-fraction',radix:6,resourcePolicy:defaultDatasetResourcePolicy(),missing:[{value:'',meaning:'Not measured'}],time},
    {name:'Status',unit:'',representation:'text',radix:10,missing:[],time}];
  const dataset=await materials.dataset({recordId,title:'Instrument run',artifact:csv,columns});
  const cell={ref:pinned(dataset),cell:{page:0,row:0,column:0}};
  const seed=await materials.measurements.seed({ref:dataset,selector:{kind:'cell',...cell.cell}});
  const measurement={version:1,...seed,references:{decoder:null,schema:null},decoderVersion:'',integrity:'not-checked',completion:'complete',note:''};
  const observed=await materials.measurements.save({recordId,title:'Retained reading',measurement});
  const read=(source,role='reading')=>reader.resultSource({workspaceId,role,source});
  const provenance={method:{ref:pinned(method)},calibration:{ref:pinned(calibration)},evidence:{ref:pinned(csv)},reading:cell};
  const exact={spelling:'0.1',representation:'radix-fraction',radix:6,precision:'exact'};
  const bytesRead=t.mock.method(ResearchMaterials.prototype,'artifact',()=>assert.fail('A reference read the artifact payload'));
  const rowsRead=t.mock.method(ResearchMaterials.prototype,'retainedDatasetPage',()=>assert.fail('A reference read dataset rows'));
  try{
    assert.equal((await read(provenance.calibration,'calibration')).title,'calibration.txt');
    assert.equal((await read({ref:pinned(dataset)},'evidence')).title,'Instrument run');
  }finally{bytesRead.mock.restore();rowsRead.mock.restore();}
  assert.deepEqual(await read(cell),{title:'Instrument run',unit:'',value:exact});
  assert.deepEqual((await read({ref:pinned(observed)})).value,exact);
  assert.equal((await read({...cell,cell:{...cell.cell,row:2}})).value.spelling,'0');
  assert.equal((await read({...cell,cell:{...cell.cell,row:3}})).value.spelling,long);
  await assert.rejects(read({...cell,cell:{...cell.cell,row:1}}),{code:'LAB_INVALID'});
  await assert.rejects(read({...cell,cell:{...cell.cell,column:1}}),{code:'LAB_INVALID'});
  await assert.rejects(read({...cell,ref:{...cell.ref,workspaceId:randomUUID()}}),{code:'MATERIAL_INVALID'});
  await assert.rejects(reader.resultSource({workspaceId:randomUUID(),role:'reading',source:cell}),{code:'WORKSPACE_CHANGED'});
  const bounds={spelling:'1/6',representation:'rational',radix:10,precision:'exact'};
  const result={method:'Instrument method',analyte:'Instrument readout',numericVersion:2,kind:'numeric',value:exact,unit:'',lower:bounds,upper:bounds,notes:'',provenance};
  let receipt=await lab.change({etag:'new',action:'create-sample',sample:{code:'S1',material:'Instrument',source:'',receivedOn:'2026-01-01',collectedOn:'2026-01-01'}},{compact:true});
  const sampleId=receipt.selectedId;
  const analysis={code:'R1',sampleId,result};
  await assert.rejects(lab.change({etag:receipt.etag,action:'create-analysis',analysis:{...analysis,result:{...result,value:{...exact,spelling:'0'}}}},{compact:true}),{code:'LAB_INVALID'});
  await assert.rejects(lab.change({etag:receipt.etag,action:'create-analysis',analysis:{...analysis,result:{...result,provenance:{...provenance,reading:{...cell,ref:{...cell.ref,workspaceId:randomUUID()}}}}}},{compact:true}));
  receipt=await lab.change({etag:receipt.etag,action:'create-analysis',analysis},{compact:true});
  const id=receipt.selectedId;
  const change=async(action,extra={})=>receipt=await lab.change({action,id,etag:receipt.etag,...extra},{compact:true});
  await change('save-and-submit',{result});
  await change('review',{reviewer:'Lab reviewer',comment:'Source checked',decision:'approve',checked:true});
  const issued=receipt.etag,selected=await reader.selected({workspaceId,kind:'analysis',id,etag:issued});
  const report=await lab.report(id,issued,[],{retained:true});
  assert.equal(selected.record.result.value.spelling,'0.1');
  assert.match(report,/Within interval/);assert.match(report,/0\.1 \(base 6\)/);assert.match(report,/1\/6 to 1\/6/);
  for(const source of Object.values(provenance)){
    assert.ok(report.includes(source.ref.revision));assert.ok(report.includes(source.ref.workspaceId));
  }
  await change('amend',{reason:'Retain the separate measurement'});
  const revised={...result,provenance:{...provenance,reading:{ref:pinned(observed)}}};
  await change('save-and-submit',{result:revised});
  await change('review',{reviewer:'Lab reviewer',comment:'Read retained measurement',decision:'approve',checked:true});
  const next=await reader.selected({workspaceId,kind:'analysis',id,etag:receipt.etag});
  assert.notEqual(next.record.review.hash,selected.record.review.hash);
  assert.match(await lab.report(id,receipt.etag),new RegExp(observed.revision));
  assert.equal(await lab.report(id,issued,[],{retained:true}),report);
});
