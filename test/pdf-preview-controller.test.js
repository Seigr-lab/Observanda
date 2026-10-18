import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pdfPreviewController} from '../src/web/pdf-preview-controller.js';
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){const calls=[],revoked=[];let serial=0;const preview=pdfPreviewController({delay:10,request:(id,revision,signal)=>{const reply=deferred();calls.push({id,revision,signal,...reply});return reply.promise;},createURL:()=>`blob:preview-${++serial}`,revokeURL:url=>revoked.push(url)});return {preview,calls,revoked};}

test('obsolete PDF renders cannot replace a newer preview and URLs are released',async()=>{
 const {preview,calls,revoked}=fixture(),first=preview.show('document','first');await turn();const rejected=assert.rejects(first,{name:'AbortError'}),second=preview.show('document','second');await turn();assert.equal(calls[0].signal.aborted,true);
 calls[1].resolve({});assert.equal((await second).revision,'second');calls[0].resolve({});await rejected;assert.equal(preview.state().current.revision,'second');
 const third=preview.render('document','third');await turn();calls[2].resolve({});await third;assert.deepEqual(revoked,['blob:preview-1']);preview.reset();assert.deepEqual(revoked,['blob:preview-1','blob:preview-2']);assert.equal(preview.state().current,null);
});

test('automatic preview refresh debounces saved editions and stops when closed',async()=>{
 const {preview,calls}=fixture(),first=preview.show('document','first');await turn();calls[0].resolve({});await first;
 preview.refresh('document','second');preview.refresh('document','third');await new Promise(resolve=>setTimeout(resolve,30));assert.deepEqual(calls.map(call=>call.revision),['first','third']);calls[1].resolve({});await turn();
 preview.refresh('document','fourth');preview.close();await new Promise(resolve=>setTimeout(resolve,30));assert.equal(calls.length,2);assert.equal(preview.state().visible,false);
});

test('preview and download reuse one pending render and a failed refresh preserves the last PDF',async()=>{
 const {preview,calls}=fixture(),first=preview.show('document','first');assert.equal(preview.render('document','first'),first);await turn();calls[0].resolve({});await first;
 const failed=preview.render('document','second'),rejected=assert.rejects(failed,/Renderer unavailable/);await turn();calls[1].reject(Error('Renderer unavailable'));await rejected;assert.equal(preview.state().current.revision,'first');assert.equal(preview.state().error,'Renderer unavailable');
 const retry=preview.render('document','second');await turn();calls[2].resolve({});await retry;assert.equal(preview.state().current.revision,'second');assert.equal(preview.state().error,'');preview.reset();
});
