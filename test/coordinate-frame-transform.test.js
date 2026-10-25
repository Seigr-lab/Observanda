import {registerHooks} from 'node:module';
import {CalculationGraphs} from '../src/calculation-graphs.js';
import {CalculationLineage} from '../src/calculation-lineage.js';
import {graphCellSources} from '../src/calculation-graph-lineage.js';
import {validGraphNode,validGraphCalculation} from '../src/web/dataset-calculation-graph-model.js';
import {materialRequest} from '../src/material-requests.js';
import {CoordinateFrames,coordinateFrameRequest} from '../src/coordinate-frame-requests.js';
import {coordinateFrameGraphColumn,assertCoordinateFrameGraphVersion,assertCoordinateFrameComparison,coordinateTransformLineage,validCoordinateTransformLineage,coordinateComponentLineage,validCoordinateComponentLineage} from '../src/coordinate-frame-graph.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {AppError} from '../src/errors.js';
import {MaterialSequence} from '../src/material-sequence.js';
import {DatasetResourceBudget} from '../src/dataset-resource-budget.js';
import {retainDomainValue,domainValuePage,verifyDomainValue} from '../src/measurement-domain-storage.js';
import {defaultDomain} from '../src/web/measurement-domain-model.js';
import {defaultColumn} from '../src/web/dataset-schema.js';
import {blankQuantity} from '../src/web/measurement-model.js';
import {blankUnitDefinition,exactUnitScalar} from '../src/web/measurement-unit-model.js';
import {defaultDatasetResourcePolicy} from '../src/web/dataset-resource-policy.js';
import {materialReferenceKey} from '../src/web/material-reference.js';
import {COORDINATE_FRAME_TOOL,COORDINATE_FRAME_TRANSFORM_TOOL,COORDINATE_FRAME_METHOD,validCoordinateFrame,validCoordinateFrameAxes,validCoordinateFrameAxis,validCoordinateFrameTransform,validCoordinateFrameDescriptor} from '../src/web/coordinate-frame-model.js';
import {verifyCoordinateFrameTransform,coordinateFrameTransformColumn,calculateCoordinateFrameTransformNode,validateCoordinateFrameColumn,validateCoordinateFrameDefinition} from '../src/coordinate-frame-transform.js';
const ref=kind=>({kind,id:randomUUID(),revision:'a'.repeat(64)});
const unit=(scale='1',dimensions=[{axis:'length',exponent:1}])=>({...blankUnitDefinition(),dimensions,scale:exactUnitScalar(scale,scale.includes('/')?'rational':'integer')});
const locate=ref=>({ref,selector:{kind:'cell',page:0,row:0,column:0}});
async function fixture({matrix=[['0','-1'],['1','0']],offset=['10','20'],input=['2','3'],inputUnit=unit(),targetUnit=unit(),component={version:1,representation:'integer',radix:10},policy:provided}={}){
 const n=matrix.length,policy=structuredClone(provided??defaultDatasetResourcePolicy());Object.assign(policy.resources,{maxOperations:1000000,maxMilliseconds:30000});
 const data=new Map(),docs=new Map(),selected=new Map(),axes=new Map(),scratch=new Map(),reads=[],stats={pages:[],active:0,maximum:0,gets:0,puts:0},workspace={readMetadata:async key=>data.get(key)??null,writeMetadata:async(key,text)=>data.set(key,text)},sequences=new MaterialSequence(workspace);
 const originalValidate=sequences.validate.bind(sequences),originalItem=sequences.item.bind(sequences),originalPage=sequences.page.bind(sequences);
 sequences.validate=value=>value?.kind==='coordinate-frame-axes'?(assert.equal(validCoordinateFrameAxes(value),true),value):originalValidate(value);
 sequences.item=async(value,index)=>value.kind==='coordinate-frame-axes'?structuredClone(axes.get(value.root.key)[index]):originalItem(value,index);
 sequences.page=async(value,options)=>{stats.pages.push({kind:value.kind,...options});return originalPage(value,options);};
 const makeAxes=names=>{const items=names.map(name=>({id:randomUUID(),name})),key=createHash('sha256').update(JSON.stringify(items)).digest('hex');axes.set(key,items);return {format:1,kind:'coordinate-frame-axes',count:items.length,chunkSize:1,root:{count:items.length,height:1,key,hash:key}};};
 const sourceRef=ref('analysis'),targetRef=ref('analysis'),model=ref('analysis');
 const frame=(namespace,definition)=>({tool:COORDINATE_FRAME_TOOL,version:1,namespace,dimension:n,axesIndex:makeAxes(Array.from({length:n},(_,i)=>'Declared axis '+i)),unit:'declared length',unitDefinition:definition,rationale:'Explicit ordered synthetic frame; no physical reference system inferred.',resourcePolicy:structuredClone(policy)}),source=frame('source-frame',unit()),target=frame('target-frame',targetUnit);
 docs.set(sourceRef.id,{kind:'analysis',content:source});docs.set(targetRef.id,{kind:'analysis',content:target});
 const work={remove:async key=>scratch.delete(key),get:async key=>{stats.gets++;return structuredClone(scratch.get(key));},put:async(key,value)=>{stats.puts++;assert.ok(value===null||typeof value==='string'||typeof value==='boolean');scratch.set(key,structuredClone(value));}};
 const materials={workspace,sequences,read:async reference=>{reads.push(structuredClone(reference));const doc=docs.get(reference.id);if(!doc)throw new AppError('MATERIAL_MISSING');return doc;},measurements:{cell:async locator=>{stats.maximum=Math.max(stats.maximum,++stats.active);try{const value=selected.get(materialReferenceKey(locator.ref));if(!value)throw new AppError('MATERIAL_MISSING');return {row:{excluded:value.excluded??null},value:{presence:value.presence??'value'},column:value.column,cellReference:value.cell.value};}finally{stats.active--;}}}};
 const operand=async(codec,shape,values,namespace,definition,frameRef,context=component)=>{
  const domain={...defaultDomain(codec),version:2,resourcePolicy:structuredClone(policy),namespace,shape,component:context},column={...defaultColumn({label:'Declared components'}),representation:'domain',domain,unit:'declared length',quantity:{...blankQuantity(),unitDefinition:definition},...(frameRef?{coordinateFrame:{version:1,frame:frameRef}}:{})},cell={kind:'string',value:await retainDomainValue(materials,{kind:'string',value:JSON.stringify(values)},domain,fn=>fn())},reference=ref('dataset');
  const result={column,cell,ref:reference};docs.set(reference.id,{kind:'dataset',content:{}});selected.set(materialReferenceKey(reference),result);return result;
 };
 const a=await operand('matrix',[n,n],matrix,'authored-coefficient-space',unit('1',[]),null,{version:1,representation:'integer',radix:10}),b=await operand('vector',[n],offset,'target-frame',targetUnit,targetRef,{version:1,representation:'integer',radix:10}),x=await operand('vector',[n],input,'source-frame',inputUnit,sourceRef),content={tool:COORDINATE_FRAME_TRANSFORM_TOOL,version:1,method:COORDINATE_FRAME_METHOD,sourceFrame:sourceRef,targetFrame:targetRef,matrix:locate(a.ref),offset:locate(b.ref),rationale:'Matrix row i is target axis i and column j is source axis j; translation uses target axes.',resourcePolicy:policy};
 docs.set(model.id,{kind:'analysis',content});const node={id:randomUUID(),kind:'coordinate-transform',model};
 return {materials,source,target,sourceRef,targetRef,model,content,node,a,b,x,policy,work,scratch,axes,docs,reads,stats,operand,verify:options=>verifyCoordinateFrameTransform(materials,content,{model,work,...options}),run:(verified,options={})=>calculateCoordinateFrameTransformNode(materials,node,x.cell,x.column,{verified,work,...options})};
}
async function spellings(materials,cell){const result=[];for(let offset=0;;){const page=await domainValuePage(materials,cell.value,{offset,limit:16,resolve:true});result.push(...page.items.map(item=>item.spelling));if(page.next===null)return result;offset=page.next;}}

test('frame declarations pin an explicit ordered axis sequence and exact references',async()=>{
 const f=await fixture();assert.equal(validCoordinateFrame(f.source),true);assert.equal(validCoordinateFrameTransform(f.content),true);assert.equal(validCoordinateFrameDescriptor(f.x.column.coordinateFrame),true);assert.equal(validCoordinateFrameAxis({id:randomUUID(),name:'x'}),true);
 for(const bad of [{...f.source,dimension:3},{...f.source,namespace:''},{...f.source,dimension:Number.MAX_SAFE_INTEGER},{...f.source,unitDefinition:{...unit(),kind:'absolute'}}])assert.equal(validCoordinateFrame(bad),false);
 assert.equal(validCoordinateFrameTransform({...f.content,inverse:true}),false);assert.equal(validCoordinateFrameTransform({...f.content,rationale:'Declared axes.\nExplicit translation.'}),true);assert.equal(validCoordinateFrame({...f.source,rationale:'Axis rationale.\nSecond line.'}),true);assert.equal(validCoordinateFrame({...f.source,rationale:'Bad\u0008control'}),false);assert.equal(validCoordinateFrameDescriptor({version:1,frame:f.sourceRef,transform:f.model}),false);
 const duplicate=f.axes.get(f.source.axesIndex.root.key);duplicate[1].id=duplicate[0].id;await assert.rejects(f.verify(),{code:'COORDINATE_FRAME_INVALID'});
});

test('exact rotation, row pivot and translation produce retained native vector [7,22]',async()=>{
 const f=await fixture(),original=structuredClone(f.a.cell),verified=await f.verify(),column=coordinateFrameTransformColumn(f.node,f.x.column,verified),result=await f.run(verified);
 assert.deepEqual(await spellings(f.materials,result),['7/1','22/1']);assert.equal(result.value.definition.version,2);assert.deepEqual(column.coordinateFrame,{version:1,frame:f.targetRef,axesIndex:f.target.axesIndex,sourceFrame:f.sourceRef,transform:f.model});assert.equal(column.domain.namespace,'target-frame');assert.deepEqual(f.a.cell,original);assert.equal(verified.dimension,2);assert.equal(Object.hasOwn(verified,'components'),false);await verifyDomainValue(f.materials,result.value);
 const other=await fixture({matrix:[['2','1'],['1','1']],offset:['0','0']});assert.deepEqual(await spellings(other.materials,await other.run(await other.verify())),['7/1','5/1']);
});

test('homogeneous source/translation/target units convert exactly without an implicit origin offset',async()=>{
 const f=await fixture({input:['200','300'],inputUnit:unit('1/100')}),verified=await f.verify();assert.deepEqual(await spellings(f.materials,await f.run(verified)),['7/1','22/1']);
 const centimeters=await fixture({input:['200','300'],inputUnit:unit('1/100'),targetUnit:unit('1/100'),offset:['1000','2000']});assert.deepEqual(await spellings(centimeters.materials,await centimeters.run(await centimeters.verify())),['700/1','2200/1']);
 for(const mutate of [f=>f.a.column.quantity.unitDefinition=unit(),f=>f.b.column.quantity.unitDefinition=unit('1',[{axis:'time',exponent:1}]),f=>f.target.unitDefinition={...unit(),offset:exactUnitScalar('1')},f=>f.a.column.quantity.unitDefinition.kind='absolute']){const bad=await fixture();mutate(bad);await assert.rejects(bad.verify());}
 const incompatible=await fixture(),context=await incompatible.verify();incompatible.x.column.quantity.unitDefinition=unit('1',[{axis:'time',exponent:1}]);await assert.rejects(incompatible.run(context),{code:'COORDINATE_FRAME_UNITS'});
});

test('singular, incomplete or excluded coefficient/translation models refuse before producing values',async()=>{
 for(const matrix of [[['1','2'],['2','4']],[['0','0'],['0','0']],[['1',null],['0','1']]]){const f=await fixture({matrix});await assert.rejects(f.verify(),{code:matrix.flat().includes(null)?'COORDINATE_FRAME_INPUT':'COORDINATE_FRAME_SINGULAR'});}
 for(const mutate of [f=>f.a.excluded='Excluded evidence',f=>f.b.presence='missing',f=>f.a.column.domain.shape=[1,4],f=>f.b.column.coordinateFrame.frame={...f.targetRef,revision:'b'.repeat(64)}]){const f=await fixture();mutate(f);await assert.rejects(f.verify());}
 const f=await fixture({offset:['10',null]});await assert.rejects(f.verify(),{code:'COORDINATE_FRAME_INPUT'});
});

test('input frame namespace and revision are exact, while typed null/absence remain distinct',async()=>{
 const f=await fixture(),verified=await f.verify();
 for(const mutate of [column=>delete column.coordinateFrame,column=>column.coordinateFrame.frame={...f.sourceRef,revision:'b'.repeat(64)},column=>column.domain.namespace='different-frame']){const column=structuredClone(f.x.column);mutate(column);await assert.rejects(calculateCoordinateFrameTransformNode(f.materials,f.node,f.x.cell,column,{verified,work:f.work}),{code:'COORDINATE_FRAME_INCOMPATIBLE'});}
 for(const kind of ['null','absent'])assert.deepEqual(await calculateCoordinateFrameTransformNode(f.materials,f.node,{kind,value:''},f.x.column,{verified,work:f.work}),{kind,value:''});
 const partial=await fixture({matrix:[['1','0'],['0','1']],input:['2',null]}),result=await partial.run(await partial.verify());assert.deepEqual(await spellings(partial.materials,result),[null,null]);assert.equal(result.value.complete,false);
});

test('mixed-radix components and approximate input provenance remain explicit',async()=>{
 const f=await fixture({input:['2','0.3'],component:{version:1,representation:'radix-fraction',radix:6}});f.a.column.computation={version:1,kind:'approximate-inputs'};const verified=await f.verify(),output=coordinateFrameTransformColumn(f.node,f.x.column,verified);assert.deepEqual(output.computation,{version:1,kind:'approximate-inputs'});assert.deepEqual(await spellings(f.materials,await f.run(verified)),['19/2','22/1']);
 const exact=await fixture(),context=await exact.verify();exact.x.column.computation={version:1,kind:'approximate',recipe:exact.model};assert.deepEqual(coordinateFrameTransformColumn(exact.node,exact.x.column,context).computation,{version:1,kind:'approximate-inputs'});
});

test('larger vectors and long retained components use bounded pages and streamed outputs',async()=>{
 const n=17,f=await fixture({matrix:Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>i===j?'1':'0')),offset:Array(n).fill('0'),input:Array.from({length:n},(_,i)=>String(i))});f.stats.pages.length=0;const context=await f.verify(),result=await f.run(context);assert.deepEqual(await spellings(f.materials,result),Array.from({length:n},(_,i)=>i+'/1'));assert.equal(f.stats.maximum,1);assert.ok(f.stats.pages.every(page=>page.limit<=16));assert.ok(f.scratch.size<=2*n*n+4*n);assert.ok(JSON.stringify(context).length<15000);
 const policy=defaultDatasetResourcePolicy();Object.assign(policy.resources,{maxScalarCharacters:12000,maxExponent:12000});const long='0'.repeat(9000)+'2',g=await fixture({input:[long,'3'],policy});assert.equal(g.x.cell.value.version,3);assert.deepEqual(await spellings(g.materials,await g.run(await g.verify())),['7/1','22/1']);
});

test('source and cumulative operation limits remain owned through validation and result writing',async()=>{
 const f=await fixture(),tight=structuredClone(f.policy);tight.resources.maxOperations=10;await assert.rejects(f.verify({policy:tight}),{code:'DATASET_CALCULATION_RESOURCE'});
 const verified=await f.verify(),caller=new DatasetResourceBudget(tight);await assert.rejects(f.run(verified,{budget:caller}),{code:'DATASET_CALCULATION_RESOURCE'});
 const small=await fixture();small.a.column.domain.resourcePolicy.resources.maxScalarCharacters=16;small.a.cell.value.definition=structuredClone(small.a.column.domain);small.a.cell.value.components=(await small.operand('matrix',[2,2],[['0'.repeat(17),'-1'],['1','0']],'authored-coefficient-space',unit('1',[]),null)).cell.value.components;await assert.rejects(small.verify(),{code:'DATASET_CALCULATION_RESOURCE'});
 const original=await fixture(),context=await original.verify();const consumed=new DatasetResourceBudget(original.policy);consumed.operations=consumed.maxOperations-1;await assert.rejects(original.run(context,{budget:consumed}),{code:'DATASET_CALCULATION_RESOURCE'});
});

test('output resource policy remains the intersection of model and caller allowances',async()=>{
 const f=await fixture();f.content.resourcePolicy.resources.maxScalarCharacters=32;const context=await f.verify(),caller=new DatasetResourceBudget(defaultDatasetResourcePolicy()),column=coordinateFrameTransformColumn(f.node,f.x.column,context,{budget:caller});assert.equal(column.domain.resourcePolicy.resources.maxScalarCharacters,32);
});

test('permission and cancellation checks remain active across scratch I/O and repeated use',async t=>{
 const f=await fixture(),verified=await f.verify(),controller=new AbortController();controller.abort();await assert.rejects(f.run(verified,{signal:controller.signal}),{name:'AbortError'});
 const read=f.materials.read,denied=new AppError('MATERIAL_MISSING');f.materials.read=async ref=>{if(ref.id===f.targetRef.id)throw denied;return read(ref);};await assert.rejects(f.run(verified),error=>error===denied);
 const changed=await fixture(),context=await changed.verify();changed.content.rationale='Different model content';await assert.rejects(changed.run(context),{code:'COORDINATE_FRAME_INVALID'});
 const during=await fixture(),abort=new AbortController(),put=during.work.put;let count=0;during.work.put=async(...args)=>{await put(...args);if(++count===5)abort.abort();};await assert.rejects(during.verify({signal:abort.signal}),{name:'AbortError'});assert.equal(count,5);
 let clock=0;t.mock.method(Date,'now',()=>clock);const waits=await fixture(),get=waits.work.get;waits.work.get=async key=>{clock+=100000;return get(key);};assert.deepEqual(await spellings(waits.materials,await waits.run(await waits.verify())),['7/1','22/1']);
});


test('rational coefficients keep tiny nonzero pivots and captured frame declarations cannot change',async()=>{
 const f=await fixture(),a=await f.operand('matrix',[2,2],[['1/1000000000000000000000000000000','0/1'],['0/1','1/1']],'authored-coefficient-space',unit('1',[]),null,{version:1,representation:'rational',radix:10});f.content.matrix=locate(a.ref);const verified=await f.verify(),count=f.scratch.size;
 assert.deepEqual(await spellings(f.materials,await f.run(verified)),['5000000000000000000000000000001/500000000000000000000000000000','23/1']);assert.equal(f.scratch.size,count);
 f.target.unitDefinition=unit('2');await assert.rejects(f.run(verified),{code:'COORDINATE_FRAME_INVALID'});
 const g=await fixture(),context=await g.verify(),denied=Object.assign(Error('Access revoked'),{code:'ACCESS_LOCKED'});await assert.rejects(g.run(context,{check:()=>{throw denied;}}),error=>error===denied);
});


test('format3 coefficient selection projects exactly one row and never opens unrelated cell roots',async()=>{
 const f=await fixture(),rows=new Map(),columns=new Map(),forbidden=new Set(),page=f.materials.sequences.page.bind(f.materials.sequences);let projected=0,metadataReads=0;
 for(const operand of [f.a,f.b]){
  const selected=f.materials.sequences.builder('cells',fn=>fn());await selected.append(operand.cell);const cellIndex=await selected.finish(),other=f.materials.sequences.builder('cells',fn=>fn());await other.append({kind:'string',value:'unselected evidence'});const unrelated=await other.finish();forbidden.add(unrelated.root.hash);
  f.docs.set(operand.ref.id,{kind:'dataset',id:operand.ref.id,content:{datasetFormat:3,schemaIndex:{count:1}}});columns.set(operand.ref.id,operand.column);rows.set(operand.ref.id,[{id:randomUUID(),order:1,excluded:null,cellIndex},...Array.from({length:8},(_,i)=>({id:randomUUID(),order:i+2,excluded:null,cellIndex:unrelated}))]);
 }
 f.materials.retainedDatasetPage=async(doc,index,options)=>{assert.equal(index,0);assert.deepEqual(options,{metadataOnly:true});metadataReads++;return {rows:rows.get(doc.id)};};f.materials.datasetColumn=async(doc,index)=>{assert.equal(index,0);return columns.get(doc.id);};f.materials.measurements.cell=async()=>{throw Error('Whole-page selected-cell adapter must not be used for format3');};
 f.materials.sequences.page=async(descriptor,options)=>{assert.equal(forbidden.has(descriptor.root?.hash),false,'unselected cell root was read');if(descriptor.kind==='cells')projected++;return page(descriptor,options);};
 const context=await f.verify();assert.equal(metadataReads,2);assert.equal(projected,2);assert.deepEqual(await spellings(f.materials,await f.run(context)),['7/1','22/1']);
});

// Saved service axes use the real sequence kind, tree and immutable chunks.
// The small kernel fixture's synthetic frame axes retain their local reader.
async function serviceFixture(){
 const f=await fixture(),m=f.materials,history=new Map(),heads=new Map(),recordId=randomUUID(),baseRead=m.read,sequence=m.sequences,baseItem=sequence.item.bind(sequence);let sequenceItems=0;
 sequence.item=async(value,index)=>{sequenceItems++;return value.kind==='coordinate-frame-axes'&&!f.axes.has(value.root?.key)?MaterialSequence.prototype.item.call(sequence,value,index):baseItem(value,index);};
 m.workspace.withCatalogueConnections=async fn=>fn();m.workspace.withLock=async fn=>fn();m.assertOwner=async()=>{};m.current=async id=>heads.get(id)??null;m.read=async ref=>history.get(materialReferenceKey(ref))??baseRead(ref);m.checkReference=async ref=>{const doc=await m.read(ref);await m.assertOwner(doc.recordId);};
 m.commit=async({kind,id=randomUUID(),recordId,title,content,expectedRevision})=>{if(expectedRevision!==undefined&&(heads.get(id)?.revision??null)!==expectedRevision)throw new AppError('MATERIAL_CHANGED');const revision=createHash('sha256').update(JSON.stringify({kind,id,recordId,title,content})).digest('hex'),reference={kind,id,revision},doc={...reference,recordId,title,content:structuredClone(content)};history.set(materialReferenceKey(reference),doc);heads.set(id,doc);return reference;};
 const withWork=async operation=>{const data=new Map();return operation({get:async key=>structuredClone(data.get(key)),put:async(key,value)=>data.set(key,structuredClone(value)),remove:async key=>data.delete(key)});};
 const service=new CoordinateFrames(m,{withWork}),empty=await sequence.builder('references',fn=>fn()).finish();for(const doc of f.docs.values()){doc.recordId=recordId;if([COORDINATE_FRAME_TOOL,COORDINATE_FRAME_TRANSFORM_TOOL].includes(doc.content.tool))doc.content.inputsIndex=empty;}
 const header=()=>Object.fromEntries(['version','namespace','dimension','unit','unitDefinition','rationale','resourcePolicy'].map(key=>[key,structuredClone(f.source[key])]));
 return {...f,m,service,recordId,history,heads,header,items:()=>sequenceItems};
}

test('paged frame authoring preserves immutable revisions, stable axes and bounded edit reads',async()=>{
 const f=await serviceFixture(),header={...f.header(),dimension:21};let ref=await f.service.create({recordId:f.recordId,title:'Synthetic frame',frame:header});const empty=ref,ids=[];
 for(let i=0;i<21;i++){const item={id:randomUUID(),name:'Axis '+i};ids.push(item.id);const before=f.items();ref=await f.service.change({ref,collection:'axes',offset:i,item});assert.equal(f.items(),before);}
 const full=ref,page=await f.service.page({ref,offset:16,limit:16});assert.equal(page.items.length,5);assert.equal(page.total,21);assert.equal(page.next,null);assert.equal((await f.service.page({ref:empty})).total,0);
 ref=await f.service.change({ref,collection:'axes',offset:20,move:0});assert.equal((await f.service.page({ref,limit:1})).items[0].id,ids[20]);ref=await f.service.change({ref,collection:'axes',offset:10,remove:true});assert.equal((await f.service.page({ref})).total,20);assert.equal((await f.service.page({ref:full,offset:16})).items[4].id,ids[20]);
 await assert.rejects(f.service.change({ref:full,collection:'settings',frame:header}),{code:'MATERIAL_CHANGED'});await assert.rejects(f.service.change({ref,collection:'axes',offset:0,item:{id:randomUUID(),name:'Replaced identity'}}),{code:'COORDINATE_FRAME_INVALID'});await assert.rejects(f.service.change({ref,collection:'settings',frame:{...header,dimension:19}}));await assert.rejects(f.service.page({ref,limit:17}));await f.service.verify(await f.m.read(ref));
});

test('draft duplicate axes cannot certify a complete frame and unit scalar retention is paged',async()=>{
 const f=await serviceFixture(),header=f.header(),policy=structuredClone(f.policy);policy.resources.maxScalarCharacters=12000;header.resourcePolicy=policy;header.unitDefinition={...unit(),version:2,resourcePolicy:policy,scale:exactUnitScalar('0'.repeat(9000)+'1')};let ref=await f.service.create({recordId:f.recordId,title:'Long scalar frame',frame:header});const first=await f.service.scalar({ref,field:'unitDefinition.scale.spelling',offset:8990,limit:16});assert.equal(first.text,'0'.repeat(10)+'1');assert.equal(first.next,null);assert.equal(typeof(await f.m.read(ref)).content.unitDefinition.scale.spelling,'object');
 const item={id:randomUUID(),name:'Same axis'};ref=await f.service.change({ref,collection:'axes',offset:0,item});ref=await f.service.change({ref,collection:'axes',offset:1,item});await f.service.verify(await f.m.read(ref));await assert.rejects(validateCoordinateFrameDefinition(f.m,(await f.m.read(ref)).content,{complete:true,scanAxes:true,work:f.work}),{code:'COORDINATE_FRAME_INVALID'});await assert.rejects(f.service.scalar({ref,field:'rationale',limit:16}));
});

test('transform service pins exact references, preserves prior revisions and checks closure',async()=>{
 const f=await serviceFixture(),transform=Object.fromEntries(['version','method','sourceFrame','targetFrame','matrix','offset','rationale','resourcePolicy'].map(key=>[key,structuredClone(f.content[key])])),first=await f.service.transformSave({recordId:f.recordId,title:'Affine frame transform',transform}),second=await f.service.transformSave({recordId:f.recordId,title:'Revised rationale',id:first.id,expectedRevision:first.revision,transform:{...transform,rationale:'Explicit second rationale'}});
 const original=await f.service.transformRead({ref:first}),current=await f.service.transformRead({ref:second});assert.equal(original.isCurrent,false);assert.equal(current.isCurrent,true);assert.equal(original.transform.rationale,transform.rationale);assert.deepEqual(original.sourceFrame.ref,f.sourceRef);assert.equal(original.transform.inputsIndex.count,4);await f.service.verify(await f.m.read(first));
 await assert.rejects(f.service.transformSave({recordId:f.recordId,title:'Stale',id:first.id,expectedRevision:first.revision,transform}),{code:'MATERIAL_CHANGED'});const damaged=structuredClone(await f.m.read(first));damaged.content.inputsIndex=await f.m.sequences.builder('references',fn=>fn()).finish();await assert.rejects(f.service.verify(damaged),{code:'MATERIAL_MISSING'});
});

test('bounded column admission authenticates frame and transform pins without matrix reads',async()=>{
 const f=await fixture(),context=await f.verify(),column=coordinateFrameTransformColumn(f.node,f.x.column,context);f.stats.pages.length=0;f.reads.length=0;const validated=await validateCoordinateFrameColumn(f.materials,column,{work:f.work});assert.deepEqual(validated.coordinateFrame,column.coordinateFrame);assert.equal(f.stats.pages.length,0);assert.ok(!f.reads.some(ref=>ref.id===f.a.ref.id||ref.id===f.b.ref.id));
 for(const mutate of [value=>value.coordinateFrame.sourceFrame=f.targetRef,value=>value.domain.namespace='wrong',value=>value.domain.shape=[3],value=>value.quantity.unitDefinition.kind='absolute']){const bad=structuredClone(column);mutate(bad);await assert.rejects(validateCoordinateFrameColumn(f.materials,bad,{work:f.work}));}
});

test('binding a source frame streams and refuses duplicate axes even when draft shapes are valid',async()=>{
 const f=await fixture(),axes=f.axes.get(f.source.axesIndex.root.key);axes[1].id=axes[0].id;await validateCoordinateFrameDefinition(f.materials,f.source,{scanAxes:true});await assert.rejects(validateCoordinateFrameColumn(f.materials,f.x.column,{work:f.work}),{code:'COORDINATE_FRAME_INVALID'});
});

test('graph frame guards preserve explicit identity and refuse implicit axis or frame changes',async()=>{
 const f=await fixture(),left=f.x.column,right=structuredClone(left),out={...left};delete out.coordinateFrame;
 assert.throws(()=>assertCoordinateFrameGraphVersion(left,12),{code:'COORDINATE_FRAME_INCOMPATIBLE'});assert.equal(assertCoordinateFrameGraphVersion(left,13),left);
 for(const node of [{kind:'domain',operation:'copy'},{kind:'domain',operation:'choose'},{kind:'domain-arithmetic',operation:'add'},{kind:'domain-arithmetic',operation:'subtract'}])assert.deepEqual(coordinateFrameGraphColumn(node,[left,right],out).coordinateFrame,left.coordinateFrame);
 const other=structuredClone(right);other.coordinateFrame.frame={...f.sourceRef,revision:'b'.repeat(64)};for(const operation of ['choose','add','subtract'])assert.throws(()=>coordinateFrameGraphColumn({kind:operation==='choose'?'domain':'domain-arithmetic',operation},[left,other],out));assert.throws(()=>assertCoordinateFrameComparison(left,other));assert.doesNotThrow(()=>assertCoordinateFrameComparison(left,right));
 for(const node of [{kind:'domain-permute',axes:[1,0]},{kind:'domain-reshape',shape:[1,2]},{kind:'domain-arithmetic',operation:'multiply'},{kind:'domain-arithmetic',operation:'dot'},{kind:'scalar',operation:'copy'}])assert.throws(()=>coordinateFrameGraphColumn(node,[left,right],out));
 const extract={id:randomUUID(),kind:'domain',operation:'extract',component:[1]},scalar=coordinateFrameGraphColumn(extract,[left],{representation:'rational'});assert.equal(scalar.coordinateFrame,undefined);assert.deepEqual(coordinateComponentLineage(extract,2,left),{version:1,node:{id:extract.id,position:2},frame:f.sourceRef,axis:1});assert.equal(validCoordinateComponentLineage(coordinateComponentLineage(extract,2,left)),true);const descriptor=coordinateTransformLineage(f.node,3,await f.verify());assert.equal(validCoordinateTransformLineage(descriptor),true);assert.equal(validCoordinateTransformLineage({...descriptor,matrix:null}),false);
});

test('frame requests retain access, cancellation and strict command boundaries',async()=>{
 const f=await serviceFixture(),controller=new AbortController();controller.abort();await assert.rejects(f.service.create({recordId:f.recordId,title:'Cancelled',frame:f.header()},{signal:controller.signal}),{name:'AbortError'});assert.equal(f.heads.size,0);const denied=new AppError('ACCESS_LOCKED');f.m.assertOwner=async()=>{throw denied;};await assert.rejects(f.service.create({recordId:f.recordId,title:'Denied',frame:f.header()}),error=>error===denied);assert.equal(f.heads.size,0);await assert.rejects(coordinateFrameRequest(f.m,'coordinate-frame-create',{recordId:f.recordId,title:'Extra',frame:f.header(),axes:[]}));
});

async function graphFixture(){
 const f=await serviceFixture(),m=f.m,columns=[f.x.column],binding={id:randomUUID(),source:f.x.ref,view:'observations',match:null},address=position=>({id:nodes[position].id,position}),nodes=[{id:randomUUID(),kind:'column',binding:{id:binding.id,position:0},column:0}];nodes.push({id:randomUUID(),kind:'coordinate-transform',left:address(0),model:f.model});nodes.push({id:randomUUID(),kind:'domain',operation:'extract',left:address(1),right:null,condition:null,component:[1]});
 const source=f.docs.get(f.x.ref.id);Object.assign(source,f.x.ref);source.content.columns=columns;m.datasetColumn=async(doc,index)=>structuredClone(doc.content.columns[index]);m.datasetColumns=async doc=>structuredClone(doc.content.columns);
 const sequence=async(kind,items)=>{const builder=m.sequences.builder(kind,fn=>fn());for(const item of items)await builder.append(item);return builder.finish();},makeWork=()=>{const values=new Map();return {get:async key=>structuredClone(values.get(key)),put:async(key,value)=>values.set(key,structuredClone(value)),remove:async key=>values.delete(key),add:async key=>{if(values.has(key))return false;values.set(key,true);return true;}};};
 const document=async({version=13,selectedNodes=nodes,bindings=[binding],output=selectedNodes.length-1}={})=>({kind:'analysis',content:{tool:'Observanda calculation graph',graphVersion:version,...(version>=5?{policy:f.policy}:{}),graphBindingsIndex:await sequence('calculation-bindings',bindings),graphNodesIndex:await sequence('calculation-nodes',selectedNodes),graphOutputsIndex:await sequence('calculation-outputs',[{id:randomUUID(),name:'Selected result',node:{id:selectedNodes[output].id,position:output}}]),where:null,selectionReason:''}});
 return {...f,columns,binding,nodes,address,sequence,makeWork,document,graphs:new CalculationGraphs(m)};
}

test('graph13 strict admission and inherited recipe16 retain earlier generation refusal',async()=>{
 const f=await graphFixture();assert.equal(validGraphCalculation({version:16,graph:f.model}),true);for(const version of [18,19,20])assert.equal(validGraphCalculation({version,graph:f.model}),true);assert.equal(validGraphCalculation({version:21,graph:f.model}),false);assert.equal(validGraphNode(f.nodes[1],1,13,f.policy),true);assert.equal(validGraphNode(f.nodes[1],1,12,f.policy),false);assert.equal(validGraphNode({...f.nodes[1],inverse:true},1,13,f.policy),false);assert.equal(validGraphNode({...f.nodes[1],left:f.address(1)},1,13,f.policy),false);
 for(const version of [1,2,3,4,5,6,7,8,9,10,11,12])await assert.rejects(f.graphs.compile(await f.document({version,selectedNodes:[f.nodes[0]]}),f.makeWork()),{code:'COORDINATE_FRAME_INCOMPATIBLE'});
 const plain=structuredClone(f.columns[0]);delete plain.coordinateFrame;f.columns[0]=plain;await f.graphs.compile(await f.document({version:12,selectedNodes:[f.nodes[0]]}),f.makeWork());
 for(const [route,write]of [['coordinate-frame-create',true],['coordinate-frame-change',true],['coordinate-frame-transform-save',true],['coordinate-frame-page',false],['coordinate-frame-scalar',false],['coordinate-frame-transform-read',false]])assert.equal(materialRequest('/api/research/materials/'+route).write,write);
});

test('real graph compiler retains frame context and authenticated transform/component lineage',async()=>{
 const f=await graphFixture(),doc=await f.document(),work=f.makeWork();await f.graphs.compile(doc,work,{lineage:true});const transformed=await work.get('node:1'),extracted=await work.get('node:2');assert.deepEqual(transformed.column.coordinateFrame.frame,f.targetRef);assert.equal(extracted.column.coordinateFrame,undefined);assert.equal(extracted.column.representation,'rational');
 const leaves=new CalculationLineage(f.m.sequences),page=await leaves.page(extracted.leaves,{limit:16});assert.equal(page.items.length,3);assert.equal(page.items.filter(item=>item.coordinateTransform).length,1);assert.equal(page.items.filter(item=>item.coordinateComponent).length,1);await leaves.verify(extracted.leaves);
 const result=await calculateCoordinateFrameTransformNode(f.m,f.nodes[1],f.x.cell,f.x.column,{verified:transformed.coordinateTransform,work,policy:f.policy});assert.deepEqual(await spellings(f.m,result),['7/1','22/1']);
 const again=f.makeWork();await f.graphs.compile(doc,again,{lineage:true});assert.deepEqual((await again.get('node:2')).leaves,extracted.leaves);
 const graphRef=ref('analysis');f.docs.set(graphRef.id,{...doc,...graphRef});const rowId=randomUUID(),location={kind:'dataset',page:0,row:0,id:rowId,excluded:null},bindingsIndex=await f.sequence('calculation-row-bindings',[{binding:{id:f.binding.id,position:0},location}]),row={calculationLineage:{version:1,graph:graphRef,bindingsIndex,outputExcluded:false}},retained={content:{calculation:{version:16,graph:graphRef}}};f.m.retainedDatasetPage=async()=>({rows:[{id:rowId,cells:[f.x.cell.value],valueKinds:['string']}]});
 const inspected=await graphCellSources(f.m,retained,row,{lineage:{version:1,node:f.address(2),leaves:extracted.leaves}}),transform=inspected.items.find(item=>item.coordinateTransform),component=inspected.items.find(item=>item.coordinateComponent);assert.equal(transform.sources.length,6);assert.deepEqual(transform.sources.map(source=>source.ref),[f.x.ref,f.model,f.a.ref,f.b.ref,f.sourceRef,f.targetRef]);assert.equal(component.coordinateComponent.axis,1);assert.deepEqual(component.coordinateComponent.frame,f.targetRef);assert.equal(component.sources.length,2);
});

test('compiler refuses silent frame erasure and mismatched frame revisions on ordinary operations and joins',async()=>{
 const f=await graphFixture(),other=ref('analysis');f.docs.set(other.id,{kind:'analysis',recordId:f.recordId,content:structuredClone(f.source)});f.columns.push({...structuredClone(f.x.column),coordinateFrame:{version:1,frame:other}});const right={...f.nodes[0],id:randomUUID(),column:1};
 for(const operation of ['add','subtract']){const selectedNodes=[f.nodes[0],right,{id:randomUUID(),kind:'domain-arithmetic',operation,left:f.address(0),right:{id:right.id,position:1}}];await assert.rejects(f.graphs.compile(await f.document({selectedNodes}),f.makeWork()),{code:'COORDINATE_FRAME_INCOMPATIBLE'});}
 for(const node of [{kind:'domain-permute',axes:[0]},{kind:'domain-reshape',shape:[2]}])await assert.rejects(f.graphs.compile(await f.document({selectedNodes:[f.nodes[0],{id:randomUUID(),...node,left:f.address(0)}]}),f.makeWork()),{code:'COORDINATE_FRAME_INCOMPATIBLE'});
 const keys=await f.sequence('calculation-edges',[{left:f.address(0),right:1,semantics:'domain'}]),joined={...f.binding,id:randomUUID(),match:{keysIndex:keys,unmatched:'keep'}};await assert.rejects(f.graphs.compile(await f.document({selectedNodes:[f.nodes[0]],bindings:[f.binding,joined]}),f.makeWork()),{code:'COORDINATE_FRAME_INCOMPATIBLE'});
});

test('stored frame axes preserve exact ordered interpretation and cannot substitute names or IDs',async()=>{
 const f=await serviceFixture(),column=structuredClone(f.x.column);await assert.rejects(validateCoordinateFrameColumn(f.m,column,{work:f.work,requireAxes:true}),{code:'COORDINATE_FRAME_INVALID'});column.coordinateFrame.axesIndex=f.source.axesIndex;await validateCoordinateFrameColumn(f.m,column,{work:f.work,requireAxes:true});
 const copied=f.m.sequences.builder('coordinate-frame-axes',fn=>fn());for(const axis of f.axes.get(f.source.axesIndex.root.key))await copied.append(axis);column.coordinateFrame.axesIndex=await copied.finish();await validateCoordinateFrameColumn(f.m,column,{work:f.work,requireAxes:true});
 const changed=f.m.sequences.builder('coordinate-frame-axes',fn=>fn());for(const axis of f.axes.get(f.source.axesIndex.root.key))await changed.append({...axis,name:axis.name+' changed'});column.coordinateFrame.axesIndex=await changed.finish();await assert.rejects(validateCoordinateFrameColumn(f.m,column,{work:f.work,requireAxes:true}),{code:'COORDINATE_FRAME_INVALID'});
});

test('connected graph rows preserve exact vectors, nulls, exclusions and public preview context',async()=>{
 const f=await graphFixture(),doc=await f.document({selectedNodes:f.nodes.slice(0,2)}),graph=ref('analysis'),key='frameRows_'+randomUUID().replaceAll('-','');f.docs.set(graph.id,{...doc,...graph});const rows=[{kind:'string',value:f.x.cell.value},{kind:'null',value:''},{kind:'absent',value:''},{kind:'string',value:f.x.cell.value}].map((cell,index)=>({id:randomUUID(),line:index+1,excluded:index===3?'Explicit source exclusion':null,cells:[cell.value],valueKinds:[cell.kind]}));f.m.datasetPageCount=()=>1;f.m.retainedDatasetPage=async()=>({rows});globalThis[key]=create=>create(f.makeWork());
 const hooks=registerHooks({resolve(specifier,context,next){return specifier==='./scratch-iterator.js'&&context.parentURL?.includes('frame-pure=')?{url:'frame-pure:'+key,shortCircuit:true}:next(specifier,context);},load(url,context,next){return url==='frame-pure:'+key?{format:'module',shortCircuit:true,source:'export const scratchIterator=create=>globalThis['+JSON.stringify(key)+'](create);'}:next(url,context);}});
 try{const {GraphCalculations}=await import('../src/calculation-graph-evaluation.js?frame-pure='+key),engine=new GraphCalculations(f.m),command={calculation:{version:16,graph}},actual=[];for await(const row of engine.rows(command,doc)){if(row.columnCount!==undefined)continue;const cells=[];for await(const cell of row.cells())cells.push(cell);actual.push({row,cells});}assert.deepEqual(await spellings(f.m,actual[0].cells[0]),['7/1','22/1']);assert.deepEqual(actual.slice(1).map(item=>item.cells[0].kind),['null','absent','absent']);assert.equal(actual[3].row.calculationLineage.outputExcluded,true);assert.equal(actual[0].row.calculationLineage.outputExcluded,false);
  engine.validate=async()=>doc;const preview=await engine.previewScoped(command);assert.equal(preview.formats[0].frameContext.namespace,f.target.namespace);assert.equal(preview.formats[0].frameContext.method,COORDINATE_FRAME_METHOD);assert.equal(JSON.stringify(preview.formats[0].frameContext).includes(f.targetRef.id),false);
 }finally{hooks.deregister();delete globalThis[key];}
});
