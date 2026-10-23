import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Workspace} from '../src/storage.js';
import {MaterialSequence} from '../src/material-sequence.js';
import {ResearchTransfer} from '../src/collaboration/research-transfer.js';
import {recordOwnerMetadataDependencies} from '../src/record-owner-resources.js';
import {digest,serialize} from '../src/storage-format.js';
import {defaultDatasetResourcePolicy} from '../src/web/dataset-resource-policy.js';
import {defaultColumn} from '../src/web/dataset-schema.js';
import {blankQuantity,blankClock} from '../src/web/measurement-model.js';
import {blankUnitDefinition} from '../src/web/measurement-unit-model.js';
import {defaultDomain} from '../src/web/measurement-domain-model.js';
import {retainScalarDefinitions,resolveScalarDefinitions} from '../src/measurement-scalar-storage.js';
import {retainDomainValue,domainValuePage,verifyDomainValue} from '../src/measurement-domain-storage.js';

const scalar=spelling=>({spelling,representation:'integer',radix:10});
function policy(){const value=defaultDatasetResourcePolicy();value.resources.maxScalarCharacters=12000;value.resources.maxOperations=200000;return value;}
function fixture(){const values=new Map(),workspace=new Workspace('scalar-transfer-memory');workspace.storageKind=undefined;workspace.readMetadata=async key=>values.get(key)??null;workspace.writeMetadata=async(key,text)=>{values.set(key,text);};return {values,workspace,materials:{workspace,sequences:new MaterialSequence(workspace)}};}
async function sequence(f,kind,items){const builder=f.materials.sequences.builder(kind,fn=>fn());for(const value of items)await builder.append(value);return builder.finish();}
async function declarations(f){
 const spelling='0'.repeat(9000)+'1',unit=await retainScalarDefinitions(f.materials,{...blankUnitDefinition(),version:2,resourcePolicy:policy(),scale:scalar(spelling)},fn=>fn());
 const clock=await retainScalarDefinitions(f.materials,{version:2,resourcePolicy:policy(),modulus:scalar('0'.repeat(9000)+'7'),rate:null},fn=>fn());
 const column={...defaultColumn({label:'Counter'}),representation:'integer',quantity:{...blankQuantity(),unitDefinition:unit},time:{kind:'counter',reference:'',resolution:'',uncertainty:'',clock:{...blankClock(),definition:clock}}};
 const node={id:'22222222-2222-4222-8222-222222222222',kind:'constant',value:{constant:'1',representation:'integer',radix:10,unit:'',quantity:{...blankQuantity(),unitDefinition:unit}}};
 const measurement={version:2,resourcePolicy:policy(),value:{...scalar(spelling),unit:'count',presence:'value'},quantity:blankQuantity(),time:{kind:'none',reference:'',resolution:'',uncertainty:''},sources:[{ref:{kind:'artifact',id:'11111111-1111-4111-8111-111111111111',revision:'1'.repeat(64)},selector:{kind:'whole'}}],references:{decoder:null,schema:null},decoderVersion:'',integrity:'unknown',completion:'unknown',note:''};
 const retainedMeasurement=await retainScalarDefinitions(f.materials,measurement,fn=>fn());
 return {spelling,unit,clock,column,node,measurement:retainedMeasurement};
}
test('selected transfer follows policy declarations and domain component text completely without widening its closure',async()=>{
 const source=fixture(),d=await declarations(source),domain={...defaultDomain('vector'),version:2,resourcePolicy:policy()},value=await retainDomainValue(source.materials,{kind:'string',value:JSON.stringify([d.spelling,'2'])},domain,fn=>fn());
 const schema=await sequence(source,'columns-policy',[d.column]),nodes=await sequence(source,'calculation-nodes',[d.node]),cells=await sequence(source,'cells',[{value}]);
 const unrelated=await sequence(source,'cell-text',['Unrelated private scalar']);
 const target=fixture(),emitted=[],transfer=new ResearchTransfer(source.workspace,[],[],async part=>{assert.equal(part.kind,'metadata');assert.ok(!target.values.has(part.name));emitted.push(part.name);target.values.set(part.name,part.content);});
 await transfer.sequence(schema);await transfer.sequence(nodes);await transfer.sequence(cells);await transfer.declaration(d.measurement);
 const restoredColumn=(await target.materials.sequences.page(schema,{limit:1})).items[0],restored=await resolveScalarDefinitions(target.materials,restoredColumn);
 assert.equal(restored.quantity.unitDefinition.scale.spelling,d.spelling);assert.equal(restored.time.clock.definition.modulus.spelling,'0'.repeat(9000)+'7');
 assert.equal((await resolveScalarDefinitions(target.materials,(await target.materials.sequences.page(nodes,{limit:1})).items[0])).value.quantity.unitDefinition.scale.spelling,d.spelling);
 assert.equal((await resolveScalarDefinitions(target.materials,d.measurement)).value.spelling,d.spelling);
 const copiedValue=(await target.materials.sequences.page(cells,{limit:1})).items[0].value;await verifyDomainValue(target.materials,copiedValue);assert.equal((await domainValuePage(target.materials,copiedValue,{limit:1,resolve:true})).items[0].exact,'1/1');
 assert.equal(d.unit.scale.spelling.sha256,createHash('sha256').update(d.spelling,'utf16le').digest('hex'));
 assert.ok(!emitted.includes('.observanda/materials/sequences/nodes/'+unrelated.root.hash+'.json'));
 const root=await target.materials.sequences.tree().node(d.unit.scale.spelling.parts.root),missing='.observanda/materials/sequences/chunks/'+root.revision+'.json';target.values.delete(missing);
 await assert.rejects(resolveScalarDefinitions(target.materials,restoredColumn),{code:'MATERIAL_MISSING'});
 const unavailable=new ResearchTransfer(target.workspace,[],[],()=>{});await assert.rejects(unavailable.sequence(schema),{code:'MATERIAL_MISSING'});
});
test('cleanup dependencies retain exact scalar roots for schemas, graph nodes, standalone measurements and component text',async()=>{
 const f=fixture(),d=await declarations(f),descriptor=d.unit.scale.spelling,rootKey=ref=>'metadata:.observanda/materials/sequences/nodes/'+ref.root.hash+'.json';
 const store={object:async key=>{const text=f.values.get(key.slice('metadata:'.length));return text===undefined?null:{text};}};
 const expected=async refs=>Promise.all(refs.map(async ref=>{const key=rootKey(ref);return {kind:'object',key,revision:digest(serialize(await store.object(key)))};}));
 const dependencies=(name,value)=>recordOwnerMetadataDependencies(store,name,JSON.stringify(value));
 for(const kind of ['columns','columns-policy'])assert.deepEqual(await dependencies('.observanda/materials/sequences/chunks/declared.json',{kind,items:[d.column]}),await expected([descriptor.parts,d.clock.modulus.spelling.parts]));
 assert.deepEqual(await dependencies('.observanda/materials/sequences/chunks/nodes.json',{kind:'calculation-nodes',items:[d.node]}),await expected([descriptor.parts]));
 assert.deepEqual(await dependencies('.observanda/materials/sequences/chunks/components.json',{kind:'domain-components',items:[{spelling:descriptor}]}),await expected([descriptor.parts]));
 assert.deepEqual(await dependencies('.observanda/materials/objects/measurement/revision.json',{content:{measurement:d.measurement}}),await expected([d.measurement.value.spelling.parts]));
 assert.deepEqual(await dependencies('.observanda/materials/sequences/chunks/unrelated.json',{kind:'cell-text',items:[{quantity:d.column.quantity,spelling:descriptor}]}),[]);
});
