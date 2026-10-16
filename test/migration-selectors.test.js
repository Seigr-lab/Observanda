import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {inventorySource} from '../src/migration/inventory.js';
import {validateInventoryManifest} from '../src/migration/adapters.js';
import {selectorLimits} from '../src/migration/selector-contract.js';

async function inspect(t,content,selectors,{links=[]}={}){
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-selectors-'));
 t.after(()=>rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100}));
 const bytes=Buffer.from(content),original={path:'original',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
 const manifest={format:'observanda-source-inventory',version:1,adapter:{id:'declared-logbook',version:1},source:{namespace:'synthetic:selectors',revision:'r1',title:'Selected sources'},
  objects:selectors.map((selector,i)=>({id:'object-'+i,revision:'r1',kind:'record',title:'Object '+i,disposition:'map',mapping:{kind:'record'},audience:'private',urls:[],dates:[],links:links[i]??[],files:[{...original,selector}]}))};
 await writeFile(path.join(root,'original'),bytes);await writeFile(path.join(root,'inventory.observanda-source.json'),JSON.stringify(manifest));
 const report=await inventorySource({source:root});assert.deepEqual(await readFile(path.join(root,'original')),bytes);
 return {report,manifest,root};
}
const json=value=>({kind:'json-pointer',value}),anchor=value=>({kind:'anchor',value});
const verification=o=>o.files[0].verification;

test('JSON targets resolve escaped names, empty keys, Unicode, null and exact values without conversion',async t=>{
 const {report}=await inspect(t,'{"a/b":{"~1":900719925474099312345},"":null,"calls":[0,false,"ø 🐝"]}',[json('/a~1b/~01'),json('/'),json('/calls/2')]);
 assert.equal(report.complete,true);assert.ok(report.objects.every(o=>verification(o).status==='verified'));
 const {report:root}=await inspect(t,'0',[json('')]);assert.equal(root.complete,true);
});
test('missing, noncanonical array indices and prototype names cannot be reported as resolved',async t=>{
 const {report}=await inspect(t,'{"calls":[null]}',[json('/calls/1'),json('/calls/01'),json('/calls/-'),json('/__proto__'),json('/constructor')]);
 assert.equal(report.complete,false);assert.ok(report.objects.every(o=>verification(o).code==='selector-missing'));
 const invalid=await inspect(t,'{}',[json('/valid')]);
 for(const pointer of ['/bad~2','/bad~','not-a-pointer']){
  invalid.manifest.objects[0].files[0].selector.value=pointer;assert.ok(validateInventoryManifest(invalid.manifest).length);
 }
});
test('duplicate requested members and ancestors are ambiguous even when one duplicate lacks the leaf',async t=>{
 const {report}=await inspect(t,'{"parent":{"leaf":1},"parent":{},"other":1,"other":2,"ok":null}',[json('/parent/leaf'),json('/other'),json('/ok')]);
 assert.equal(report.complete,false);assert.equal(verification(report.objects[0]).code,'selector-ambiguous');assert.equal(verification(report.objects[1]).code,'selector-ambiguous');assert.equal(verification(report.objects[2]).status,'verified');
});
test('malformed source tails, invalid UTF-8 and excessive nesting never give partial success',async t=>{
 for(const source of ['{"exists":1} trailing','{"exists":1,}',Buffer.from([0x7b,0xff,0x7d]),'['.repeat(selectorLimits.jsonDepth+1)+'0'+']'.repeat(selectorLimits.jsonDepth+1)]){
  const {report}=await inspect(t,source,[json('')]);assert.equal(report.complete,false);assert.equal(verification(report.objects[0]).status,'blocked');
 }
});
test('HTML targets use parsed elements, escaped attributes and named anchors without running scripts',async t=>{
 const source='<!doctype html><title>Study</title><script>throw Error("must not run"); const fake="<p id=fake>";</script><template><h2 id=hidden>Hidden</h2></template><!-- <b id=comment> -->'+
 '<section id="one&amp;two"><h2>Observation</h2></section><a name=legacy></a><p id="søund">Birds</p>';
 const {report}=await inspect(t,source,[anchor('one&two'),anchor('legacy'),anchor('søund'),anchor('fake'),anchor('hidden'),anchor('comment')]);
 assert.deepEqual(report.objects.map(o=>verification(o).status),['verified','verified','verified','blocked','blocked','blocked']);
 assert.equal(report.objects[0].files[0].verification.element,'section');
});
test('nested anchors and duplicate IDs block independent logical records',async t=>{
 const {report}=await inspect(t,'<!doctype html><section id=outer><p id=inner>Nested</p></section><p id=duplicate></p><p id=duplicate></p>',[anchor('outer'),anchor('inner'),anchor('duplicate')]);
 assert.ok(report.objects[0].issues.some(i=>i.code==='ambiguous-boundary'));assert.ok(report.objects[1].issues.some(i=>i.code==='ambiguous-boundary'));assert.equal(verification(report.objects[2]).code,'selector-ambiguous');assert.equal(report.complete,false);
});
test('HTML size and node budgets leave visible unresolved targets',async t=>{
 for(const content of ['<div id=target>'+('x'.repeat(selectorLimits.htmlBytes))+'</div>','<!doctype html><p id=target></p>'+'<i></i>'.repeat(selectorLimits.htmlNodes)]){
  const {report}=await inspect(t,content,[anchor('target')]);assert.equal(report.complete,false);assert.equal(verification(report.objects[0]).code,'selector-limit');
 }
});
test('selector failures propagate through exact required dependencies',async t=>{
 const {report}=await inspect(t,'{"exists":true}',[json('/missing'),json('/exists')],{links:[[],[{type:'followed',id:'object-0',revision:'r1',required:true}]]});
 assert.equal(report.counts.conflict,2);assert.ok(report.objects[1].issues.some(i=>i.code==='dependency'));
});

test('HTML declaring another encoding remains unresolved instead of silently changing anchor text',async t=>{
 for(const head of ['<meta charset=windows-1252>','<meta http-equiv="Content-Type" content="text/html; charset=ISO-8859-1">']){
  const {report}=await inspect(t,'<!doctype html>'+head+'<p id="ø">Calls</p>',[anchor('ø')]);
  assert.equal(report.complete,false);assert.equal(verification(report.objects[0]).code,'selector-encoding');
 }
 const {report}=await inspect(t,'<!doctype html><meta charset="UTF-8"><p id="ø">Calls</p>',[anchor('ø')]);assert.equal(report.complete,true);
});

test('source changes during target verification abort the result instead of accepting the earlier hash',async t=>{
 const f=await inspect(t,'{"exists":true}',[json('/exists')]);let changed=false;
 await assert.rejects(inventorySource({source:f.root},{onProgress:async progress=>{
  if(progress.phase==='selectors'&&!changed){changed=true;await writeFile(path.join(f.root,'original'),'{"changed":true}');}
 }}),{code:'INVENTORY_CHANGED'});
 const controller=new AbortController();
 await assert.rejects(inventorySource({source:f.root},{signal:controller.signal,onProgress:progress=>{if(progress.phase==='selectors')controller.abort();}}),{code:'INVENTORY_CANCELLED'});
});
