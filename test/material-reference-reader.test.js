import {materialReferenceElements} from '../src/web/material-reference-elements.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {materialReferenceReader,inheritMaterialNamespace,materialOriginalRoute} from '../src/web/material-reference-requests.js';

test('reference reads select their address while edits keep their explicitly selected owner',async()=>{
 const ref={kind:'artifact',id:randomUUID(),revision:'a'.repeat(64),workspaceId:randomUUID()},foreign={...ref,workspaceId:randomUUID()},local=[],addressed=[],owners=[];
 const read=materialReferenceReader({api:async(route,data,options)=>{addressed.push({route,data,options});return {projectId:'resolved-owner',namespaceId:ref.workspaceId,value:{title:'Retained document'}};},local:async(...args)=>{local.push(args);return 'selected-owner';},onOwner:(result,name)=>owners.push([result.projectId,name])});
 assert.equal(await read('measurement-save',{measurement:{sources:[{ref:foreign}]}}),'selected-owner');
 assert.equal(await read('read',{ref:{kind:ref.kind,id:ref.id,revision:ref.revision}}),'selected-owner');
 assert.deepEqual(await read('read',{ref:foreign},{owner:'current-editor',adopt:true}),{title:'Retained document'});
 assert.deepEqual(addressed[0],{route:'/api/projects/material-reference/read',data:{ref:foreign},options:{owner:'current-editor',adopt:false}});
 await read('measurement-inspect',{source:{ref,selector:{kind:'bytes',offset:0,length:4}}});
 assert.equal(addressed[1].route,'/api/projects/material-reference/measurement-inspect');assert.equal(local.length,2);assert.deepEqual(owners,[['resolved-owner','read'],['resolved-owner','measurement-inspect']]);
 const original=structuredClone(foreign);assert.deepEqual(inheritMaterialNamespace(foreign,ref.workspaceId),foreign);assert.deepEqual(foreign,original);
 assert.equal(inheritMaterialNamespace({kind:ref.kind,id:ref.id,revision:ref.revision},ref.workspaceId).workspaceId,ref.workspaceId);
 assert.equal(materialOriginalRoute(foreign),'/api/projects/material-reference/original/'+foreign.workspaceId+'/'+foreign.id+'/'+foreign.revision);
});

test('failed owner authorization never retries a reference against the editor database',async()=>{
 const ref={kind:'artifact',id:randomUUID(),revision:'b'.repeat(64),workspaceId:randomUUID()},denied={code:'ACCESS_LOCKED',projectId:randomUUID()};
 const read=materialReferenceReader({api:async()=>{throw denied;},local:()=>assert.fail('Do not fall back to another owner'),onOwner:()=>assert.fail('Do not adopt an unauthorized owner')});
 await assert.rejects(read('read',{ref}),error=>error===denied);
});


test('displayed embedded evidence resolves exact origin addresses in bounded pages without mutating retained values',async()=>{
 const workspaceId=randomUUID(),origin=randomUUID(),refs=Array.from({length:71},()=>({kind:'artifact',id:randomUUID(),revision:'a'.repeat(64)})),before=structuredClone(refs),foreign={...refs[0],workspaceId:randomUUID()};
 const buttons=[...refs,foreign].map(ref=>({dataset:{ref:JSON.stringify(ref)},disabled:false})),source={ref:refs[0],selector:{kind:'bytes',offset:0,length:1}},measurement={dataset:{source:JSON.stringify(source)},disabled:false},calls=[];
 const root={querySelectorAll:selector=>selector.includes('measurement-inspect')?[measurement]:buttons};
 await materialReferenceElements(root,workspaceId,{resolve:async items=>{calls.push(items.length);assert.ok(buttons[0].disabled||calls.length>1);return {items:items.map(ref=>({...ref,workspaceId:origin}))};}});
 assert.deepEqual(calls,[32,32,8]);assert.deepEqual(refs,before);assert.deepEqual(JSON.parse(buttons.at(-1).dataset.ref),foreign);assert.ok(buttons.every(button=>!button.disabled));
 assert.equal(JSON.parse(buttons[0].dataset.ref).workspaceId,origin);assert.deepEqual(JSON.parse(measurement.dataset.source),{...source,ref:{...source.ref,workspaceId:origin}});
 const malformed={dataset:{ref:JSON.stringify(refs[0])},disabled:false};await assert.rejects(materialReferenceElements({querySelectorAll:selector=>selector.includes('measurement-inspect')?[]:[malformed]},workspaceId,{resolve:async()=>({items:[{...refs[1],workspaceId:origin}]})}),/Invalid retained reference/);assert.equal(malformed.disabled,true);
});


test('selected scalar and component reads keep the exact retained owner and cancellation signal',async()=>{
 const ref={kind:'dataset',id:randomUUID(),revision:'c'.repeat(64),workspaceId:randomUUID()},controller=new AbortController(),calls=[];
 const read=materialReferenceReader({api:async(route,data,options)=>{calls.push({route,data,options});return {value:{text:'0010',offset:0,total:4,next:null,previous:null}};},local:()=>assert.fail('A retained declaration must resolve its own owner')});
 for(const [name,selection] of [['measurement-scalar',{column:17,field:'quantity.unitDefinition.scale.spelling'}],['measurement-component',{selector:{kind:'cell',page:1,row:2,column:17},component:9}]]){
  const data={ref,...selection,offset:0,limit:4096};await read(name,data,{signal:controller.signal,adopt:true});const call=calls.at(-1);assert.equal(call.route,'/api/projects/material-reference/'+name);assert.deepEqual(call.data,data);assert.equal(call.options.signal,controller.signal);assert.equal(call.options.adopt,false);
 }
});


test('selected cross-owner authoring previews retain the explicit destination without bypassing read authorization',async()=>{
 const ref={kind:'dataset',id:randomUUID(),revision:'d'.repeat(64),workspaceId:randomUUID()},calls=[],adopted=[];
 const reader=materialReferenceReader({api:async(route,data,options)=>{calls.push({route,data,options});return {projectId:'reference-owner',value:{kind:'cell'}};},local:async(name,data)=>({name,data}),onOwner:result=>adopted.push(result.projectId)});
 await reader('measurement-inspect',{source:{ref,selector:{kind:'cell',page:0,row:0,column:0}}},{adoptOwner:false});
 assert.equal(calls[0].route,'/api/projects/material-reference/measurement-inspect');assert.equal(calls[0].data.source.ref.workspaceId,ref.workspaceId);assert.equal(calls[0].options.adopt,false);assert.deepEqual(adopted,[]);
 const command={recordId:randomUUID(),synchronization:{source:{ref}}};assert.deepEqual(await reader('clock-synchronization-save',command),{name:'clock-synchronization-save',data:command});
 await reader('read',{ref});assert.deepEqual(adopted,['reference-owner']);
});
