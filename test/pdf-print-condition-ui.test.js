import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pdfPrintConditionUI} from '../src/web/pdf-print-condition-ui.js';
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const document=()=>({header:{id:randomUUID(),name:'Original title'},revision:'a'.repeat(64)});
const condition=label=>({version:1,profile:{sha256:'b'.repeat(64),revision:'c'.repeat(64)},label,renderingIntent:'relative-colorimetric'});
const field=(name,value)=>({value,hasAttribute:attribute=>attribute===name});
const fileInput=file=>({files:[file],hasAttribute:attribute=>attribute==='data-pdf-print-profile'});
function harness(post){
 let selected=document(),prepares=0,saves=0,changes=0,draws=0;const busy=[],notices=[],released=deferred();
 const ui=pdfPrintConditionUI({post,getDocument:()=>selected,prepare:async()=>{prepares++;},changed:()=>changes++,saved:()=>saves++,setBusy:value=>{busy.push(value);if(!value)released.resolve();},draw:()=>draws++,notify:message=>notices.push(message),esc:String});
 return {ui,released,busy,notices,get selected(){return selected;},set selected(value){selected=value;},get counts(){return {prepares,saves,changes,draws};}};
}
test('uncertain printer imports retain the exact command through repeated response loss and explicit retry',async t=>{
 for(const second of [new TypeError('Second acknowledgement lost'),new SyntaxError('Truncated JSON acknowledgement')])await t.test(second.name,async()=>{
  const calls=[],bytes=new Uint8Array([1,2,3]),receipt={revision:'d'.repeat(64),printCondition:condition('Explicit condition')};let committed;
  const h=harness(async(operation,command)=>{assert.equal(operation,'print-profile-import');calls.push(structuredClone(command));if(!committed)committed=JSON.stringify(command);else assert.equal(JSON.stringify(command),committed);if(calls.length===1)throw new TypeError('First acknowledgement lost after commit');if(calls.length===2)throw second;return receipt;});
  h.ui.input(field('data-pdf-print-label','Explicit condition'));assert.equal(h.ui.input(fileInput(new File([bytes],'not-retained.icc'))),true);await h.released.promise;
  assert.equal(calls.length,2);assert.equal(h.ui.hasPending(),true);assert.equal(h.selected.revision,'a'.repeat(64));assert.equal(h.counts.saves,0);assert.match(h.ui.view(),/print-condition-retry/);assert.equal(h.notices.length,1);
  // Later authored fields stay in this editor. Recovery acknowledges only the
  // exact committed condition/revision; it must not reinstall an old header.
  h.selected.header.name='Later unsaved title';h.selected.header.localDraft='Preserved local field';
  await h.ui.retry();await h.ui.whenIdle();
  assert.equal(calls.length,3);assert.deepEqual(calls[0],calls[1]);assert.deepEqual(calls[1],calls[2]);assert.equal(calls[0].expectedRevision,'a'.repeat(64));assert.equal(Buffer.from(calls[0].bytes,'base64').equals(Buffer.from(bytes)),true);assert.equal(Object.hasOwn(calls[0],'filename'),false);
  assert.equal(h.ui.hasPending(),false);assert.equal(h.selected.revision,receipt.revision);assert.deepEqual(h.selected.header.printCondition,receipt.printCondition);assert.equal(h.selected.header.name,'Later unsaved title');assert.equal(h.selected.header.localDraft,'Preserved local field');assert.equal(h.counts.prepares,1);assert.equal(h.counts.saves,1);h.ui.dispose();
 });
});
test('printer import navigation recovery reuses its command while coded server failures are not retried',async()=>{
 const calls=[],receipt={revision:'d'.repeat(64),printCondition:condition('Printer colour condition')};
 const h=harness(async(_operation,command)=>{calls.push(structuredClone(command));if(calls.length<=2)throw new TypeError('No acknowledgement');return receipt;});
 h.ui.input(fileInput(new File([new Uint8Array([1])],'not-retained.icc')));await h.released.promise;assert.equal(h.ui.hasPending(),true);await h.ui.whenIdle();assert.equal(h.ui.hasPending(),false);assert.equal(calls.length,3);assert.deepEqual(calls[2],calls[0]);assert.equal(h.selected.revision,receipt.revision);h.ui.dispose();
 let attempts=0;const rejected=harness(async()=>{attempts++;throw Object.assign(new Error('Invalid supplied profile'),{code:'PDF_PRINT_PROFILE'});});rejected.ui.input(fileInput(new File([new Uint8Array([1])],'invalid.icc')));await rejected.released.promise;await rejected.ui.whenIdle();assert.equal(attempts,1);assert.equal(rejected.ui.hasPending(),false);assert.equal(rejected.selected.revision,'a'.repeat(64));assert.equal(rejected.counts.saves,0);assert.equal(rejected.notices.length,1);rejected.ui.dispose();
});
test('disposing a printer import prevents delayed file completion from releasing another editor busy state',async()=>{
 const reading=deferred(),ready=deferred();let posts=0;const h=harness(async()=>{posts++;throw Error('Disposed import must not post');}),file={size:3,arrayBuffer(){ready.resolve();return reading.promise;}};
 h.ui.input(fileInput(file));await ready.promise;assert.deepEqual(h.busy,[true]);h.ui.dispose();h.selected=document();const before=h.counts;reading.resolve(new Uint8Array([1,2,3]).buffer);await turn();await turn();
 assert.equal(posts,0);assert.deepEqual(h.busy,[true]);assert.deepEqual(h.counts,before);assert.deepEqual(h.notices,[]);assert.equal(h.ui.input(fileInput(new File([new Uint8Array([1])],'later.icc'))),false);
});

test('explicit discard clears uncertain import before authoritative reload and settles an active file read',async()=>{
 const calls=[],receipt={revision:'d'.repeat(64),printCondition:condition('Printer colour condition')},h=harness(async(_operation,command)=>{calls.push(structuredClone(command));if(calls.length<=2)throw new TypeError('Lost acknowledgement');return receipt;});
 h.ui.input(fileInput(new File([new Uint8Array([1])],'first.icc')));await h.released.promise;assert.equal(h.ui.hasPending(),true);const previous=h.selected;
 await h.ui.discard();assert.equal(h.ui.hasPending(),false);h.selected=document();await h.ui.whenIdle();assert.equal(calls.length,2);assert.equal(h.selected.header.printCondition,undefined);
 h.ui.input(fileInput(new File([new Uint8Array([2])],'next.icc')));await h.ui.whenIdle();assert.equal(calls.length,3);assert.notEqual(calls[2].commandId,calls[0].commandId);assert.equal(calls[2].id,h.selected.header.id);assert.notEqual(calls[2].id,previous.header.id);assert.equal(h.selected.revision,receipt.revision);
 const reading=deferred(),ready=deferred();h.ui.input(fileInput({size:1,arrayBuffer(){ready.resolve();return reading.promise;}}));await ready.promise;let settled=false;const discarded=h.ui.discard().then(()=>{settled=true;});await turn();assert.equal(settled,false);reading.resolve(new Uint8Array([3]).buffer);await discarded;
 assert.equal(h.ui.hasPending(),false);assert.equal(h.ui.isBusy(),false);assert.equal(h.busy.at(-1),false);assert.equal(calls.length,3);h.selected=document();await h.ui.whenIdle();assert.equal(calls.length,3);h.ui.dispose();
});
