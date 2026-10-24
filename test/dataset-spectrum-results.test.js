import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {registerHooks} from 'node:module';
const scratchKey='spectrumScratch_'+randomUUID().replaceAll('-','');
globalThis[scratchKey]=operation=>operation(work());
const hooks=registerHooks({resolve(specifier,context,next){return specifier==='./scratch-work.js'&&/\/dataset-spectrum-results\.js$/.test(context.parentURL??'')?{url:'spectrum-backend:scratch',shortCircuit:true}:next(specifier,context);},load(url,context,next){return url==='spectrum-backend:scratch'?{format:'module',shortCircuit:true,source:'export const withScratch=operation=>globalThis['+JSON.stringify(scratchKey)+'](operation);'}:next(url,context);}});
const {DatasetSpectrumResults,spectrumColumns,prepareSpectrumScalars}=await import('../src/dataset-spectrum-results.js');
const {validColumns}=await import('../src/research-materials.js');
const {MaterialSequence}=await import('../src/material-sequence.js');
const {retainDomainComponents,domainValuePage}=await import('../src/measurement-domain-storage.js');
const {defaultColumn}=await import('../src/web/dataset-schema.js');
const {defaultDomain}=await import('../src/web/measurement-domain-model.js');
const {blankUnitDefinition}=await import('../src/web/measurement-unit-model.js');
const {defaultDatasetResourcePolicy}=await import('../src/web/dataset-resource-policy.js');
const {defaultStructuredCalculationPolicy}=await import('../src/web/tools/calculation-policy.js');
const {SPECTRUM_CONVENTIONS}=await import('../src/web/dataset-spectrum-model.js');
const {readScalarDefinition}=await import('../src/measurement-scalar-storage.js');
const {digest}=await import('../src/storage-format.js');
const {revisionText}=await import('../src/web/revision-model.js');
const {validatePolicyScalar}=await import('../src/web/measurement-scalar-policy.js');
hooks.deregister();
after(()=>delete globalThis[scratchKey]);
const source={kind:'dataset',id:randomUUID(),revision:'a'.repeat(64)},recordId=randomUUID(),analysis={kind:'analysis',id:randomUUID(),revision:'b'.repeat(64)},scalar=spelling=>({spelling,representation:'rational',radix:10});
const policy=()=>({...defaultDatasetResourcePolicy(),resources:{...defaultDatasetResourcePolicy().resources,maxOperations:1000000,maxMilliseconds:30000,maxScalarCharacters:12000}});
const unit=(axis,scale='1/1')=>({...blankUnitDefinition(),version:2,resourcePolicy:policy(),dimensions:[{axis,exponent:1}],scale:scalar(scale),offset:scalar('0/1')});
const recipe=(count=4)=>({version:1,method:'radix2-fft-v1',source,column:1,range:{start:0,count},sampling:{step:scalar('1/2'),origin:scalar('10/1'),unitDefinition:unit('time'),coordinateColumn:0},resourcePolicy:policy(),calculationPolicy:{...defaultStructuredCalculationPolicy(),workingDigits:32,displayDigits:4},...SPECTRUM_CONVENTIONS});
function work(){const values=new Map();return {values,get:async key=>structuredClone(values.get(key)),put:async(key,value)=>values.set(key,structuredClone(value)),getMany:async keys=>new Map(keys.filter(key=>values.has(key)).map(key=>[key,structuredClone(values.get(key))])),putMany:async entries=>entries.forEach(([key,value])=>values.set(key,structuredClone(value)))};}
async function fixture(values,{start=0,complex=false,computed=false}={}){
 const files=new Map(),docs=new Map(),heads=new Map(),reads=[],workspace={readMetadata:async key=>files.get(key)??null,writeMetadata:async(key,text)=>files.set(key,text),withCatalogueConnections:async operation=>operation(),withLock:async operation=>operation()},sequences=new MaterialSequence(workspace),columns=[{...defaultColumn({label:'Coordinate'}),representation:'rational',resourcePolicy:policy(),unit:'s',quantity:{origin:'measured',conversion:null,calibration:null,unitDefinition:unit('time')}},{...defaultColumn({label:'Signal'}),representation:complex?'domain':'integer',...(complex?{}:{resourcePolicy:policy()}),unit:'V',quantity:{origin:'measured',conversion:null,calibration:null,unitDefinition:unit('voltage','2/1')},...(complex?{domain:{...defaultDomain('complex'),version:2,resourcePolicy:policy(),component:{version:1,representation:'integer',radix:10}}}:{}),...(computed?{computation:{version:2,kind:'per-cell'}}:{})}],rows=[];
 const sequence=async(kind,items)=>{const builder=sequences.builder(kind,fn=>fn());for(const item of items)await builder.append(item);return builder.finish();};
 for(let index=0;index<start+values.length;index++){let value=index<start?'0':values[index-start];if(complex){const pair=index<start?['0','0']:value;value=await retainDomainComponents({sequences},columns[1].domain,pair.map(spelling=>({spelling})),fn=>fn());}rows.push({id:randomUUID(),order:index+1,excluded:null,cellIndex:await sequence('cells',[{kind:'string',value:(20+index-start)+'/2'},{kind:'string',value,...(computed?{computation:null}:{})}])});}
 const pageIndex=await sequence('pages',Array.from({length:Math.ceil(rows.length/64)},(_,page)=>({hash:'f'.repeat(64),count:Math.min(64,rows.length-page*64),start:page*64,includedStart:page*64,included:Math.min(64,rows.length-page*64)}))),schemaIndex=await sequence('columns-policy',columns),doc={...source,recordId,content:{datasetFormat:3,rowCount:rows.length,includedRowCount:rows.length,pageIndex,schemaIndex,columns}};docs.set(source.id,doc);
 const materials={workspace,sequences,assertOwner:async()=>{},current:async id=>heads.get(id)??null,read:async ref=>{const doc=docs.get(ref.id);if(!doc)throw Error('Missing pinned reference');return doc;},datasetColumn:async(doc,index)=>columns[index],datasetPageCount:doc=>doc.content.pageIndex.count,retainedDatasetPage:async(doc,page,options)=>{assert.equal(options.metadataOnly,true);reads.push(page);return {rows:rows.slice(page*64,(page+1)*64),page};},commit:async value=>{const revision=digest(revisionText(value)),doc={...value};docs.set(value.id,doc);const ref={kind:value.kind,id:value.id,revision};heads.set(value.id,ref);return ref;}};
 return {materials,rows,columns,reads,docs,sequence,service:new DatasetSpectrumResults(materials)};
}
async function evaluate(f,r,options={}){const context=await f.service.context(r,options),scratch=work(),summary=await f.service.evaluate(context,scratch,options);return {context,scratch,summary};}

test('indexed selected range yields exact native complex bins, reciprocal units and complete bounded provenance',async()=>{
 const f=await fixture(['0','1','0','-1'],{start:64}),r=recipe();r.range.start=64;const {context,scratch,summary}=await evaluate(f,r);assert.equal(summary.approximate,false);assert.equal(summary.approximateInputs,false);assert.deepEqual(f.reads,[1]);
 assert.deepEqual(Array.from({length:4},(_,i)=>scratch.values.get('output:'+i)).map(bin=>[bin.signedBin,bin.frequency,bin.real,bin.imaginary,bin.normalizedSquaredMagnitude]),[[0,'0/1','0/1','0/1','0/1'],[1,'1/2','0/1','-2/1','1/4'],[-2,'-1/1','0/1','0/1','0/1'],[-1,'-1/2','0/1','2/1','1/4']]);
 const columns=spectrumColumns(context,analysis);assert.equal(validColumns(columns,4),true);assert.equal(columns[2].domain.codec,'observanda.complex');assert.equal(columns[2].domain.version,2);assert.deepEqual(columns[1].quantity.unitDefinition.dimensions,[{axis:'time',exponent:-1}]);assert.equal(columns[3].quantity.unitDefinition.scale.spelling,'4/1');assert.deepEqual(columns[3].quantity.unitDefinition.dimensions,[{axis:'voltage',exponent:2}]);assert.equal(columns[2].spectrum.coordinateChecked,true);
 const retained=[];for await(const row of f.service.rows(context,scratch,analysis,columns))retained.push(row);assert.deepEqual(retained[2].cellComputations,[undefined,undefined,null,null]);const coefficient=await domainValuePage(f.materials,retained[2].cells[2],{resolve:true});assert.deepEqual(coefficient.items.map(item=>item.spelling),['0/1','-2/1']);
 const command={recordId,id:randomUUID(),expectedRevision:null,title:'Exact declared spectrum',spectrum:r},ref=await f.service.retainAnalysis(command,summary);assert.deepEqual(await f.service.retainAnalysis(command,summary),ref);const inputs=await f.service.inputs({ref,offset:1,limit:2});assert.deepEqual(inputs.ref,ref);assert.equal(inputs.total,4);assert.equal(inputs.next,3);assert.deepEqual(inputs.items[0].source.selector,{kind:'cell',page:1,row:1,column:1});assert.deepEqual(inputs.items[0].coordinate.source.selector,{kind:'cell',page:1,row:1,column:0});assert.equal(inputs.items[0].value,'1');
});

test('native complex input keeps both components and actual selected approximation',async()=>{
 const f=await fixture([['1','0'],['0','1'],['-1','0'],['0','-1']],{complex:true,computed:true}),r=recipe();const row=f.rows[1],cells=(await f.materials.sequences.page(row.cellIndex,{offset:0,limit:2})).items;cells[1].computation={version:1,kind:'approximate-inputs'};row.cellIndex=await f.sequence('cells',cells);
 const result=await evaluate(f,r);assert.equal(result.summary.approximate,false);assert.equal(result.summary.approximateInputs,true);assert.deepEqual([0,1,2,3].map(i=>result.scratch.values.get('output:'+i).real),['0/1','4/1','0/1','0/1']);assert.equal(result.scratch.values.get('output:1').normalizedSquaredMagnitude,'1/1');const columns=spectrumColumns(result.context,analysis),rows=[];for await(const item of f.service.rows(result.context,result.scratch,analysis,columns))if(item.cells)rows.push(item);assert.deepEqual(rows[0].cellComputations[2],{version:1,kind:'approximate-inputs'});
 delete cells[1].computation;row.cellIndex=await f.sequence('cells',cells);await assert.rejects(evaluate(f,r),{code:'DATASET_CELL_COMPUTATION'});
});

test('sampling mismatches, excluded or missing cells and absolute amplitudes refuse before output staging',async()=>{
 for(const alteration of ['coordinate','excluded','missing']){const f=await fixture(['0','1','0','-1']),r=recipe();if(alteration==='excluded')f.rows[2].excluded='Explicitly excluded';else{const cells=(await f.materials.sequences.page(f.rows[2].cellIndex,{offset:0,limit:2})).items;if(alteration==='coordinate')cells[0].value='999/1';else cells[1]={kind:'absent',value:''};f.rows[2].cellIndex=await f.sequence('cells',cells);}const context=await f.service.context(r),scratch=work();await assert.rejects(f.service.evaluate(context,scratch),{code:alteration==='coordinate'?'DATASET_SPECTRUM_SAMPLING':'DATASET_SPECTRUM_MISSING'});assert.equal([...scratch.values.keys()].some(key=>key.startsWith('output:')),false);}
 const f=await fixture(['0','1','0','-1']);await assert.rejects(f.service.context({...recipe(),sampling:{...recipe().sampling,step:scalar('0/1')}}),{code:'DATASET_SPECTRUM_SAMPLING'});f.columns[1].quantity.unitDefinition.kind='absolute';await assert.rejects(f.service.context(recipe()),{code:'DATASET_SPECTRUM_UNITS'});
});

test('non-quarter bins retain complete computational digits and owned approximate recipe markers',async()=>{
 const f=await fixture(['0','1','0','0','0','0','0','0']),r=recipe(8),result=await evaluate(f,r);assert.equal(result.summary.approximate,true);const bin=result.scratch.values.get('output:1');assert.equal(bin.approximate,true);assert.ok(bin.real.length>r.calculationPolicy.displayDigits);const columns=spectrumColumns(result.context,analysis),rows=[];for await(const row of f.service.rows(result.context,result.scratch,analysis,columns))if(row.cells)rows.push(row);assert.deepEqual(rows[1].cellComputations[2],{version:1,kind:'approximate',recipe:analysis});assert.equal(rows[0].cellComputations[2],null);const components=await domainValuePage(f.materials,rows[1].cells[2],{resolve:true});assert.deepEqual(components.items.map(item=>item.spelling),[bin.real,bin.imaginary]);
});

test('cancellation and numerical limits leave no published recipe or result, source access failure keeps identity',async()=>{
 const f=await fixture(['0','1','0','-1']),r=recipe(),controller=new AbortController(),context=await f.service.context(r),scratch=work();await assert.rejects(f.service.evaluate(context,scratch,{signal:controller.signal,progress:async()=>controller.abort()}),{name:'AbortError'});assert.equal(f.docs.size,1);assert.equal([...scratch.values.keys()].some(key=>key.startsWith('output:')),false);
 const limited={...r,resourcePolicy:{...r.resourcePolicy,resources:{...r.resourcePolicy.resources,maxOperations:1}}};await assert.rejects(evaluate(f,limited),{code:'DATASET_CALCULATION_RESOURCE'});const denied=Object.assign(Error('denied'),{code:'RECORD_OWNER_DENIED'});f.materials.read=async()=>{throw denied;};await assert.rejects(f.service.context(r),error=>error===denied);
});

test('coordinate compatibility never reinterprets the authored origin in the coordinate-column scale',async()=>{
 const f=await fixture(['1','2']),r=recipe(2),large='1'+'0'.repeat(1000);r.resourcePolicy.resources.maxBits=4096;r.sampling.step=scalar(large+'/1');r.sampling.origin=scalar(large+'/1');f.columns[0].quantity.unitDefinition.scale=scalar(large+'/1');f.columns[0].quantity.unitDefinition.resourcePolicy.resources.maxBits=4096;
 for(let i=0;i<2;i++){const cells=(await f.materials.sequences.page(f.rows[i].cellIndex,{offset:0,limit:2})).items;cells[0].value=(i+1)+'/1';f.rows[i].cellIndex=await f.sequence('cells',cells);}const result=await evaluate(f,r);assert.equal(result.scratch.values.get('output:0').real,'3/1');assert.equal(result.summary.approximate,false);
});

test('long authored sampling scalars use the existing retained owner and reject unadmitted pointer transfer',async()=>{
 const f=await fixture(['0','1','0','-1']),r=recipe(),long='0'.repeat(9000)+'1/2';r.sampling.step=scalar(long);const command={recordId,id:randomUUID(),expectedRevision:null,title:'Retained authored sampling',spectrum:r},normalized=await prepareSpectrumScalars(f.materials,command,{write:fn=>fn()});assert.equal(normalized.spectrum.sampling.step.spelling.format,'dataset-cell');assert.equal((await readScalarDefinition(f.materials,{spectrum:normalized.spectrum},'spectrum.sampling.step.spelling',{offset:8999,limit:4})).text,'01/2');
 await assert.rejects(prepareSpectrumScalars(f.materials,normalized),{code:'DATASET_SPECTRUM_INVALID'});const accepted=await prepareSpectrumScalars(f.materials,normalized,{base:normalized.spectrum});assert.equal(accepted.spectrum.sampling.step.spelling,long);const result=await evaluate(f,normalized.spectrum);assert.equal(result.scratch.values.get('output:1').frequency,'1/2');
 const unrelated=await prepareSpectrumScalars(f.materials,{...command,spectrum:{...r,sampling:{...r.sampling,step:scalar('0'.repeat(9000)+'2/1')}}},{write:fn=>fn()});await assert.rejects(prepareSpectrumScalars(f.materials,{...normalized,spectrum:{...normalized.spectrum,sampling:{...normalized.spectrum.sampling,step:unrelated.spectrum.sampling.step}}},{base:normalized.spectrum}),{code:'DATASET_SPECTRUM_INVALID'});
});


test('dense selected samples retain every canonical coefficient under unchanged default numerical allowances',async()=>{
 const samples=Array.from({length:32},(_,i)=>(i*17)%23-11),f=await fixture(samples.map(String)),r=recipe(samples.length);r.resourcePolicy=defaultDatasetResourcePolicy();r.calculationPolicy=defaultStructuredCalculationPolicy();const result=await evaluate(f,r);assert.equal(result.summary.approximate,true);assert.equal(result.scratch.values.has('output:32'),false);assert.ok(result.context.budget.operations<=r.resourcePolicy.resources.maxOperations);
 const value=text=>{const parsed=validatePolicyScalar(scalar(text),r.resourcePolicy);return Number(parsed.numerator)/Number(parsed.denominator);};
 for(let k=0;k<samples.length;k++){const bin=result.scratch.values.get('output:'+k);assert.equal(bin.index,k);let real=0,imaginary=0;for(let j=0;j<samples.length;j++){const angle=-2*Math.PI*j*k/samples.length;real+=samples[j]*Math.cos(angle);imaginary+=samples[j]*Math.sin(angle);}assert.ok(Math.abs(value(bin.real)-real)<1e-10);assert.ok(Math.abs(value(bin.imaginary)-imaginary)<1e-10);assert.ok(Math.abs(value(bin.normalizedSquaredMagnitude)-(real*real+imaginary*imaginary)/(samples.length*samples.length))<1e-10);}
});


test('replay and selected inspection retain the authenticated pinned identity when stored documents omit revision',async()=>{
 const f=await fixture(['0','1','0','-1']),r=recipe(),result=await evaluate(f,r),command={recordId,id:randomUUID(),expectedRevision:null,title:'Pinned raw-document replay',spectrum:r},ref=await f.service.retainAnalysis(command,result.summary),analysisDoc=await f.materials.read(ref);assert.equal(Object.hasOwn(analysisDoc,'revision'),false);const columns=spectrumColumns(result.context,ref,analysisDoc.content.capture.columnNames),rows=[];for await(const row of f.service.rows(result.context,result.scratch,ref,columns))if(row.cells)rows.push(row);
 const doc={kind:'dataset',id:command.id,recordId,title:command.title,previous:null,content:{spectrum:{version:1,analysis:ref},algorithm:'observanda-dataset-spectrum',algorithmVersion:1,rowCount:4,includedRowCount:4,columns,pageIndex:{count:1}}},readColumn=f.materials.datasetColumn,readPage=f.materials.retainedDatasetPage;f.materials.datasetColumn=async(value,index)=>value.id===doc.id?columns[index]:readColumn(value,index);f.materials.retainedDatasetPage=async(value,page,options)=>value.id===doc.id?{page,rows}:readPage(value,page,options);f.docs.set(doc.id,doc);
 await f.service.verify(doc);await f.service.verify(analysisDoc);const resultRef={kind:'dataset',id:doc.id,revision:'c'.repeat(64)};assert.deepEqual((await f.service.inputs({ref:resultRef,offset:0,limit:1})).ref,ref);
});
