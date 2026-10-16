import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook} from '../src/model.js';
import {clearVault} from '../src/encryption.js';
import {ResearchMaterials,validColumns,EVIDENCE_CHUNK} from '../src/research-materials.js';
import {exactRational,blankClock,blankQuantity,validTime} from '../src/web/measurement-model.js';
import {plotCoordinate} from '../src/measurement-plot.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {Workspace} from '../src/storage.js';
import {copyWorkspace,copyPlan} from '../src/locations.js';
import {contentBuffer} from '../src/file-content.js';
import {readDataset} from '../src/dataset-reader.js';
import {createFigure} from '../src/web/figure-model.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {attemptFixture} from './fixtures/attempts.js';
import {buildPublication} from '../src/publication.js';
import {randomUUID} from 'node:crypto';
const column=(name,representation='text',extra={})=>({name,representation,radix:10,unit:'',missing:[{value:'',meaning:'Not acquired'}],time:{kind:'unknown',reference:'',resolution:'',uncertainty:''},...extra});
async function fixture(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-measurement-')),book=upgradeNotebook(sampleNotebook()),f=await encryptedFixture(directory,book);
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 const materials=new ResearchMaterials(f.workspace),recordId=book.entries[0].id;
 const upload=async(name,bytes)=>{const s=await materials.startImport({recordId,name,size:bytes.length});for(let at=0;at<bytes.length;at+=EVIDENCE_CHUNK)await materials.appendImport(s.id,at/EVIDENCE_CHUNK,[bytes.subarray(at,at+EVIDENCE_CHUNK)]);return materials.finishImport(s.id);};
 return {...f,directory,book,materials,recordId,upload};
}
test('exact rational identities, unsupported spelling, raw codes and clock declarations remain distinct',()=>{
 assert.deepEqual(exactRational('18446744073709551615','integer'),{numerator:18446744073709551615n,denominator:1n});
 assert.deepEqual(exactRational('15.3','radix-fraction',6),{numerator:23n,denominator:2n});
 assert.deepEqual(exactRational('0.1','radix-fraction',6),{numerator:1n,denominator:6n});
 assert.deepEqual(exactRational('-0.00e+20'),{numerator:0n,denominator:1n});
 for(const value of ['6.1','1/3','NaN','1e999999'])assert.throws(()=>exactRational(value,'radix-fraction',6));
 assert.equal(validColumns([column('Opaque','unsupported')],1),true);
 assert.equal(validColumns([column('ADC','integer',{unit:'V',quantity:{...blankQuantity(),origin:'raw-code'}})],1),false);
 const time={kind:'counter',reference:'device A',resolution:'one tick',uncertainty:'unknown',clock:{...blankClock(),width:8,frequency:'1000.000',wrap:'modulo',reset:'observed',epoch:'Reset before acquisition row 4'}};
 assert.equal(validTime(time),true);assert.equal(validTime({...time,kind:'external'}),false);
 assert.equal(validTime({kind:'external',reference:'',resolution:'',uncertainty:''}),false);
 assert.throws(()=>plotCoordinate('18446744073709551615',column('C','integer')),{code:'MATERIAL_PRECISION'});
 assert.equal(plotCoordinate('0.1',column('S','radix-fraction',{radix:6}),'approximate'),'0.16666666666666666');
 assert.throws(()=>plotCoordinate('1e-999',column('Tiny','decimal'),'approximate'),{code:'MATERIAL_PRECISION'});
 assert.throws(()=>plotCoordinate('1e999',column('Huge','decimal'),'approximate'),{code:'MATERIAL_PRECISION'});
});
test('UTF-8 CSV locators recover precise original row bytes across BOM, CRLF and quoted newlines',async()=>{
 const bytes=Buffer.from('\ufeffName,Note\r\nOne,"é\r\n🐝"\r\nTwo,last');
 for(const chunkSize of [1,2,3,7,100]){
  async function* chunks(){for(let i=0;i<bytes.length;i+=chunkSize)yield bytes.subarray(i,i+chunkSize);}
  const rows=[];for await(const r of readDataset(chunks()))if(r.cells)rows.push(r);
  assert.equal(bytes.subarray(rows[0].locator.byteOffset,rows[0].locator.byteOffset+rows[0].locator.byteLength).toString(),'One,"é\r\n🐝"\r');
  assert.equal(bytes.subarray(rows[1].locator.byteOffset,rows[1].locator.byteOffset+rows[1].locator.byteLength).toString(),'Two,last');
 }
});
test('retained exception follows exact cells, native bytes, decoder and calibration; revisions restore unchanged',async t=>{
 const f=await fixture(t),m=f.materials,bytes=Buffer.from(Array.from({length:9000},(_,i)=>i%256)),native=await f.upload('native.bin',bytes),calibration=await f.upload('calibration.txt',Buffer.from('declared reference, not executed'));
 const csv=await f.upload('decoded.csv',Buffer.from('Counter,Reading,Offset,Length,ID\n255,15.3,64,4,r1\n0,0.1,68,4,r2\n1,,72,4,r3\n0,0,76,4,r4\n2,unknown,80,4,r5'));
 const columns=[column('Counter','integer',{time:{kind:'counter',reference:'device A',resolution:'1 tick',uncertainty:'unknown',clock:{...blankClock(),width:8,frequency:'1000',wrap:'modulo',reset:'observed',epoch:'Reset before r4'}}}),column('Reading','unsupported',{quantity:{...blankQuantity(),origin:'raw-code'}}),column('Offset','integer'),column('Length','integer'),column('ID')];
 const dataset=await m.dataset({recordId:f.recordId,title:'Decoded capture',artifact:csv,columns,nativeMapping:{artifact:native,offsetColumn:2,lengthColumn:3,pointerColumn:null,idColumn:4}}),source={ref:dataset,selector:{kind:'cell',page:0,row:1,column:1}};
 const read=ResearchCatalogue.prototype.read;ResearchCatalogue.prototype.read=()=>{throw Error('Whole workspace loaded');};
 try{
  const inspection=await m.measurements.inspect(source);assert.equal(inspection.value.spelling,'0.1');assert.equal(inspection.value.representation,'unsupported');assert.equal(inspection.native.selector.nativeId,'r2');assert.equal(inspection.surrounding.length,4);
  const raw=await m.measurements.inspect(inspection.native);assert.deepEqual(Buffer.from(raw.base64,'base64'),bytes.subarray(68,72));
  const original=await m.measurements.inspect(inspection.original);assert.match(Buffer.from(original.base64,'base64').toString(),/^0,0.1,68,4,r2/);
  const seed=await m.measurements.seed(source),measurement={version:1,...seed,value:{...seed.value,spelling:'1.1666666666666666666666666667',representation:'decimal',unit:'V'},quantity:{origin:'derived',conversion:calibration,calibration},references:{decoder:calibration,schema:calibration},decoderVersion:'decoder-fixture-1',integrity:'not-checked',completion:'partial',note:'Recognition unresolved; one acquired row, no inferred pass.'};
  const command={recordId:f.recordId,title:'Exception at r2',id:randomUUID(),measurement},result=await m.measurements.save(command);
  assert.deepEqual(await m.measurements.save(command),result);
  const attempt=attemptFixture();attempt.assessments[1].references=[{...result,workspaceId:f.book.id,label:'PRIVATE_NATIVE_DIAGNOSTIC'}];
  const previous=f.book.entries[0],record={...previous,attempt};
  await new ResearchRecords(f.workspace,{}).save({workspaceId:f.book.id,baseEtag:await f.workspace.catalogue(store=>store.head()),changes:[{id:record.id,expectedRevision:recordRevision(previous),record}]},{compact:true});
  const retained=await f.workspace.catalogue(async store=>{const member=await store.member(await store.snapshot(),record.id);return store.record(member.id,member.revision);});
  const assessment=retained.attempt.assessments[1],criterion=retained.attempt.preparations[0].criteria.find(c=>c.id===assessment.criterionId);assert.equal(criterion.label,'Recognition');
  const linked=await m.read(assessment.references[0]),contributor=await m.measurements.inspect(linked.content.measurement.sources[0]),located=await m.measurements.inspect(contributor.native);assert.deepEqual(Buffer.from(located.base64,'base64'),bytes.subarray(68,72));
  const publication=buildPublication({...f.book,entries:[{...record,share:true}]});for(const [name,value] of publication.files)if(/\.(html|json|xml|txt|csv)$/.test(name))assert.ok(!String(value).includes('PRIVATE_NATIVE_DIAGNOSTIC'),name);
  const revised=await m.measurements.save({recordId:f.recordId,title:'Exception at r2',id:result.id,expectedRevision:result.revision,measurement:{...measurement,note:'Reviewed without changing source.'}});
  assert.equal((await m.read(revised)).previous,result.revision);assert.equal((await m.read(result)).content.measurement.note,measurement.note);
  const invalid=structuredClone(measurement);invalid.quantity.conversion=null;await assert.rejects(m.measurements.save({recordId:f.recordId,title:'No implicit voltage',measurement:invalid}),{code:'MEASUREMENT_INVALID'});
  const time={kind:'external',reference:'Declared external time scale',resolution:'unchanged source precision',uncertainty:'unknown',clock:{...blankClock(),model:calibration,referenceData:native}};
  const timed=await m.measurements.save({recordId:f.recordId,title:'Pinned time representation',measurement:{...measurement,time}});
  assert.deepEqual((await m.read(timed)).content.measurement.time,time);
  await assert.rejects(m.measurements.save({recordId:f.recordId,title:'Unpinned reference data',measurement:{...measurement,time:{...time,clock:{...time.clock,referenceData:null}}}}),{code:'MEASUREMENT_INVALID'});
  const missing=await m.measurements.inspect({ref:dataset,selector:{...source.selector,row:2}});assert.equal(missing.value.presence,'missing');
  const zero=await m.measurements.inspect({ref:dataset,selector:{...source.selector,row:3}});assert.equal(zero.value.presence,'value');assert.equal(zero.value.spelling,'0');
 }finally{ResearchCatalogue.prototype.read=read;}
 const copy=await copyWorkspace(await copyPlan(f.workspace.root,path.join(f.directory,'restored')),{vault:f.vault}),restored=new ResearchMaterials(new Workspace(copy,f.vault));
 await restored.verify();assert.deepEqual(await contentBuffer((await restored.artifact(native)).content),bytes);
 assert.deepEqual((await restored.measurements.inspect(source)).value,(await m.measurements.inspect(source)).value);
 await assert.rejects(m.measurements.inspect({ref:native,selector:{kind:'bytes',offset:9000,length:1}}),{code:'MEASUREMENT_INVALID'});
 const one=await m.measurements.inspect({ref:native,selector:{kind:'whole'}});assert.equal(one.length,4096);assert.equal(one.next,4096);
 assert.deepEqual(Buffer.from((await m.measurements.inspect({ref:native,selector:{kind:'whole'}},{offset:8192})).base64,'base64'),bytes.subarray(8192));
});
test('structured selectors retain numeric tokens, absent values and unsupported native identities; plots require explicit rounding',async t=>{
 const f=await fixture(t),m=f.materials,artifact=await f.upload('structured.json',Buffer.from('{"rows":[{"v":18446744073709551615,"s":"0.1"},{"v":null,"s":"0"},{"s":"1.0"}]}'));
 const dataset=await m.dataset({recordId:f.recordId,title:'Exact values',artifact,sourceMapping:{format:'json',rowsPath:'/rows',fields:[{name:'Counter',path:'/v'},{name:'Senary',path:'/s'}]},columns:[column('Counter','integer'),column('Senary','radix-fraction',{radix:6})]});
 const inspect=await m.measurements.inspect({ref:dataset,selector:{kind:'cell',page:0,row:0,column:0}});
 assert.equal(inspect.exact.numerator,'18446744073709551615');assert.equal((await m.measurements.inspect(inspect.original)).text,'18446744073709551615');
 for(const [row,presence] of [[1,'null'],[2,'absent']])assert.equal((await m.measurements.inspect({ref:dataset,selector:{kind:'cell',page:0,row,column:0}})).value.presence,presence);
 assert.equal((await m.measurements.inspect({ref:artifact,selector:{kind:'native-record',nativeId:'unmapped record'}})).kind,'unresolved');
 const command={recordId:f.recordId,title:'Approximate preview',dataset,mapping:{x:1,xKind:'number',values:[{column:1,error:null}],group:null,operation:'raw',kind:'line',order:'source',mode:'replace',decimal:'.'},base:createFigure()};
 await assert.rejects(m.plot(command),{code:'MATERIAL_PRECISION'});
 const plotted=await m.plot({...command,mapping:{...command.mapping,numericPolicy:'approximate'}});
 assert.equal((await m.read(plotted.ref)).content.numericTransform.policy,'approximate');assert.equal((await m.datasetRows(dataset))[0].cells[1],'0.1');
 const signal=AbortSignal.abort();await assert.rejects(m.measurements.inspect(inspect.original,{signal}),{name:'AbortError'});
});

test('decimal precision policy and single-step approximation retain the exact source and conversion identity',async t=>{
 const f=await fixture(t),m=f.materials,spellings=['1e-12','9007199254740993.0','1.000000000000000000001','1e-100'];
 const bytes=Buffer.from('X,Y\n'+spellings.map((raw,i)=>i+','+raw).join('\n')),artifact=await f.upload('precise-decimals.csv',bytes);
 const dataset=await m.dataset({recordId:f.recordId,title:'Exact decimal sources',artifact,columns:[column('X','integer'),column('Y','decimal')]});
 const command={recordId:f.recordId,title:'Declared display projection',dataset,mapping:{x:0,xKind:'number',values:[{column:1,error:null}],group:null,operation:'raw',kind:'line',order:'source',mode:'replace',decimal:'.'},base:createFigure()};
 await assert.rejects(m.plot(command),{code:'MATERIAL_PRECISION'});
 const result=await m.plot({...command,mapping:{...command.mapping,numericPolicy:'approximate'}}),retained=await m.read(result.ref);
 assert.deepEqual(result.figure.series[0].points.map(p=>p.y),spellings.map(Number));
 assert.deepEqual(retained.content.numericTransform,{algorithm:'exact-rational-to-binary64',version:2,policy:'approximate',significantDigits:17});
 assert.deepEqual((await m.datasetRows(dataset)).map(r=>r.cells[1]),spellings);
 assert.deepEqual(await contentBuffer((await m.artifact(artifact)).content),bytes);
 const copy=await copyWorkspace(await copyPlan(f.workspace.root,path.join(f.directory,'projection-restored')),{vault:f.vault}),restored=new ResearchMaterials(new Workspace(copy,f.vault));
 assert.deepEqual((await restored.read(result.ref)).content,retained.content);
 assert.deepEqual((await restored.datasetRows(dataset)).map(r=>r.cells[1]),spellings);
});
test('context crosses byte-bounded dataset page edges without traversing unrelated pages',async t=>{
 const f=await fixture(t),m=f.materials,artifact=await f.upload('wide-records.csv',Buffer.from('Value,Payload\n'+Array.from({length:18},(_,i)=>i+','+'x'.repeat(140000)).join('\n'))),dataset=await m.dataset({recordId:f.recordId,title:'Large rows',artifact});
 const doc=await m.read(dataset),first=await m.retainedDatasetPage(doc,0),reads=[],original=m.retainedDatasetPage;
 m.retainedDatasetPage=async function(d,p){reads.push(p);return original.call(this,d,p);};
 const selected=await m.measurements.inspect({ref:dataset,selector:{kind:'cell',page:0,row:first.rows.length-1,column:0}});
 assert.ok(selected.surrounding.some(r=>r.page===1));assert.equal(selected.surrounding.length,5);assert.ok(reads.every(p=>p===0||p===1));
});
