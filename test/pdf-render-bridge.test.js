import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createHash} from 'node:crypto';
import {pdfRenderBridge} from '../src/pdf-render-bridge.js';
import {PDF_ARCHIVAL_VALIDATOR_SHA256} from '../src/web/pdf-archival-model.js';
const bytes=Buffer.from('%PDF-test transport only'),sha256=createHash('sha256').update(bytes).digest('hex'),preflight={version:1,status:'ok',findings:[],truncated:false};
const receipt={version:1,profile:'pdfa-2u',sha256,validator:'veraPDF',validatorVersion:'1.30.3',validatorSha256:PDF_ARCHIVAL_VALIDATOR_SHA256,passedRules:1,passedChecks:1};
function fixture(){const channel=new EventEmitter();channel.connected=true;const sent=[];channel.send=value=>sent.push(value);const bridge=pdfRenderBridge(channel);return {bridge,sent,reply(value){channel.emit('message',{type:'pdf-result',id:sent.at(-1).id,bytes:bytes.toString('base64'),sha256,preflight,...value});}};}
test('archival bridge binds validation to the requested final bytes and ordinary output accepts no receipt',async()=>{
 const f=fixture();try{
  const accepted=f.bridge.render({outputProfile:'pdfa-2u'});f.reply({validation:receipt});assert.deepEqual((await accepted).validation,receipt);
  for(const validation of [undefined,{...receipt,sha256:'0'.repeat(64)},{...receipt,validatorSha256:'0'.repeat(64)},{...receipt,passedChecks:0}]){const result=f.bridge.render({outputProfile:'pdfa-2u'});f.reply({validation});await assert.rejects(result,{code:'PDF_OUTPUT'});}
  const ordinary=f.bridge.render({});f.reply({validation:receipt});await assert.rejects(ordinary,{code:'PDF_OUTPUT'});
  const mismatch=f.bridge.render({});f.reply({sha256:'0'.repeat(64)});await assert.rejects(mismatch,{code:'PDF_OUTPUT'});
  const preflightOnly=f.bridge.render({outputProfile:'pdfa-2u',preflightOnly:true});f.reply({bytes:null,sha256:null});assert.equal((await preflightOnly).bytes,null);
 }finally{f.bridge.close();}
});
test('accessible bridge preserves the automated-only boundary and rejects a different profile receipt',async()=>{
 const f=fixture(),accessible={...receipt,profile:'pdfua-1',automatedOnly:true};try{
  const accepted=f.bridge.render({outputProfile:'pdfua-1'});f.reply({validation:accessible});const result=await accepted;assert.deepEqual(result.validation,accessible);assert.deepEqual(result.conformance,[]);
  for(const [profile,validation] of [['pdfua-1',receipt],['pdfa-2u',accessible],['pdfua-1',{...accessible,automatedOnly:false}],['pdfua-1',{...accessible,sha256:'0'.repeat(64)}]]){const rejected=f.bridge.render({outputProfile:profile});f.reply({validation});await assert.rejects(rejected,{code:'PDF_OUTPUT'});}
 }finally{f.bridge.close();}
});
test('capability queries do not reserve or cancel the renderer',async()=>{
 const f=fixture();try{const render=f.bridge.render({}),id=f.sent.at(-1).id,cap=f.bridge.capabilities();const capId=f.sent.at(-1).id;f.reply({type:'pdf-capabilities-result',id:capId,archival:true});assert.deepEqual(await cap,{archival:true});await assert.rejects(f.bridge.render({}),{code:'PDF_BUSY'});f.reply({id});assert.equal((await render).sha256,sha256);}finally{f.bridge.close();}
});
