import test from 'node:test';
import assert from 'node:assert/strict';
import {MaterialSequence} from '../src/material-sequence.js';
import {retainDatasetCell,readDatasetCell} from '../src/dataset-cell-storage.js';
import {recordOwnerMetadataDependencies} from '../src/record-owner-resources.js';
import {ResearchTransfer} from '../src/collaboration/research-transfer.js';
import {defaultDatasetResourcePolicy} from '../src/web/dataset-resource-policy.js';
const prefix='.observanda/materials/sequences/';
function fixture(){const values=new Map(),workspace={readMetadata:async key=>values.get(key)??null,writeMetadata:async(key,text)=>values.set(key,text)},materials={sequences:new MaterialSequence(workspace)},store={object:async key=>values.has(key.slice(9))?{text:values.get(key.slice(9))}:null};return {values,workspace,materials,store};}
async function sequence(materials,kind,items){const builder=materials.sequences.builder(kind,fn=>fn());for(const item of items)await builder.append(item);return builder.finish();}
async function closure(f,content){const start='.observanda/materials/objects/model/revision.json',pending=[start],found=new Set();f.values.set(start,JSON.stringify({content}));while(pending.length){const name=pending.pop();if(found.has(name))continue;found.add(name);for(const dependency of await recordOwnerMetadataDependencies(f.store,name,f.values.get(name)))if(dependency.kind==='object')pending.push(dependency.key.slice(9));}return found;}
const rootName=descriptor=>prefix+'nodes/'+descriptor.root.hash+'.json';
const scalar=value=>({spelling:value,representation:'integer',radix:10});

test('selected-record dependencies and sharing carry nested clock anchors and complete long validity text',async()=>{
 const f=fixture(),long='0'.repeat(9000)+'1',cell=await retainDatasetCell(f.materials,{kind:'string',value:long},fn=>fn()),anchors=await sequence(f.materials,'clock-sync-anchors',[{source:{selected:'first'},reference:{selected:'paired-first'}},{source:{selected:'last'},reference:{selected:'paired-last'}}]),segment={version:1,kind:'clock-sync-segment',id:'segment',anchorsIndex:anchors,resourcePolicy:defaultDatasetResourcePolicy(),validity:{lower:scalar(cell.value),upper:scalar('5')}};
 const segments=await sequence(f.materials,'clock-sync-segments',[segment]),found=await closure(f,{tool:'Observanda clock synchronization',version:2,segmentsIndex:segments});
 for(const descriptor of [segments,anchors,cell.value.parts])assert.ok(found.has(rootName(descriptor)));
 const emitted=new Map(),transfer=Object.assign(Object.create(ResearchTransfer.prototype),{materials:f.materials,sequenceNodes:new Set(),emit:async part=>{assert.equal(part.kind,'metadata');emitted.set(part.name,part.content);}});await transfer.sequence(segments);
 for(const descriptor of [segments,anchors,cell.value.parts])assert.ok(emitted.has(rootName(descriptor)));
 const restored={sequences:new MaterialSequence({readMetadata:async name=>emitted.get(name)??null})},selected=await restored.sequences.item(segments,0);assert.deepEqual(await restored.sequences.item(selected.anchorsIndex,1),{source:{selected:'last'},reference:{selected:'paired-last'}});
 let recovered='',offset=0;do{const page=await readDatasetCell(restored,selected.validity.lower.spelling,{offset,limit:4096});recovered+=page.text;offset=page.next;}while(offset!==null);assert.equal(recovered,long);
 for(const name of emitted.keys())assert.ok(found.has(name),'Owner retention must cover every emitted block');
});

test('uncertainty definitions and receipts retain their referenced input, covariance and scalar resources',async()=>{
 const f=fixture(),long='0'.repeat(9000)+'2',cell=await retainDatasetCell(f.materials,{kind:'string',value:long},fn=>fn()),policy=defaultDatasetResourcePolicy(),entry={kind:'statistical-uncertainty-covariance',resourcePolicy:policy,item:{value:{kind:'declared',scalar:scalar(cell.value)}}},inputs=await sequence(f.materials,'uncertainty-inputs',[{kind:'statistical-uncertainty-input'}]),covariance=await sequence(f.materials,'uncertainty-covariance',[entry]),references=await sequence(f.materials,'references',[{kind:'analysis',id:'owned-input'}]);
 const definition=await closure(f,{tool:'Observanda uncertainty definition',version:1,uncertaintyInputsIndex:inputs,uncertaintyCovarianceIndex:covariance,inputsIndex:references});for(const descriptor of [inputs,covariance,references,cell.value.parts])assert.ok(definition.has(rootName(descriptor)));
 const receipt=await closure(f,{tool:'Observanda statistical uncertainty',version:1,inputsIndex:references,result:{resourcePolicy:policy,nominal:{scalar:scalar(cell.value)}}});for(const descriptor of [references,cell.value.parts])assert.ok(receipt.has(rootName(descriptor)));
 const unrelated=await closure(f,{note:'Observanda uncertainty definition',uncertaintyInputsIndex:inputs});assert.equal(unrelated.size,1);
});

test('a retained schema owns all ordered frame axes independently of private definition reads',async()=>{
 const f=fixture(),axes=Array.from({length:19},(_,index)=>({id:'axis-'+index,name:'Axis '+(index+1)})),axesIndex=await sequence(f.materials,'coordinate-frame-axes',axes),columns=await sequence(f.materials,'columns',[{name:'Selected position',coordinateFrame:{version:1,axesIndex,frame:{kind:'analysis',id:'frame-definition'}}}]);
 const found=await closure(f,{datasetFormat:3,schemaIndex:columns});assert.ok(found.has(rootName(axesIndex)));
 const emitted=new Map(),transfer=Object.assign(Object.create(ResearchTransfer.prototype),{materials:f.materials,sequenceNodes:new Set(),emit:async part=>emitted.set(part.name,part.content)});await transfer.sequence(columns);
 const restored={sequences:new MaterialSequence({readMetadata:async name=>emitted.get(name)??null})},column=await restored.sequences.item(columns,0),items=[];
 for(let offset=0;offset<axes.length;offset+=16)items.push(...(await restored.sequences.page(column.coordinateFrame.axesIndex,{offset,limit:16})).items);
 assert.deepEqual(items,axes);for(const name of emitted.keys())assert.ok(found.has(name),'Owner retention must cover every shared axis block');
});
