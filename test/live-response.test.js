import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../src/sample.js';
import {validateLiveRecordResponse,liveFileHeaders} from '../src/collaboration/live-response.js';
import {recordRevisionField} from '../src/web/record-revision-view.js';
const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');

test('peer records use the detached schema at every record-bearing response boundary',()=>{
 const book=sampleNotebook(),record=book.entries[0],revision='a'.repeat(64),scope={workspaceId:book.id},data={recordId:record.id};
 const responses=[['read',{record,revision,workspaceId:book.id,role:'reader'}],['link-read',{record,revision,currentRevision:revision}],...['attempt-read','evidence-read'].map(operation=>[operation,{record,revision,reference:{kind:'record',id:record.id,revision}}])];
 for(const [operation,response] of responses){
  assert.equal(validateLiveRecordResponse(operation,response,data,scope),response);
  for(const kind of ['iframe','script','object','img onerror=alert(1)']){
   const bad=structuredClone(response);bad.record.attachments=[{id:randomUUID(),kind,caption:'',alt:'',transcript:'',share:false}];
   assert.throws(()=>validateLiveRecordResponse(operation,bad,data,scope),{code:'COLLABORATION_INVALID'});
  }
  assert.throws(()=>validateLiveRecordResponse(operation,{...response,unexpected:true},data,scope),{code:'COLLABORATION_INVALID'});
 }
 assert.throws(()=>validateLiveRecordResponse('read',responses[0][1],{recordId:randomUUID()},scope),{code:'COLLABORATION_INVALID'});
 assert.throws(()=>validateLiveRecordResponse('list',{record},data,scope),{code:'COLLABORATION_INVALID'});
 const summary={id:record.id,notebookId:record.notebookId,title:record.title,status:record.status,revision};
 for(const removed of [false,true])assert.deepEqual(validateLiveRecordResponse('create',{hash:revision,record:summary,removed},{notebookId:record.notebookId},scope),{hash:revision,record:summary,removed});
 assert.throws(()=>validateLiveRecordResponse('create',{hash:revision,record:{...summary,attachments:[]},removed:false},{notebookId:record.notebookId},scope),{code:'COLLABORATION_INVALID'});
});

test('media rendering dispatches fixed tags even if a caller bypasses response validation',()=>{
 const record=sampleNotebook().entries[0];record.attachments=['iframe','script','object','audio','video'].map(kind=>({id:randomUUID(),kind,caption:'caption',alt:'',transcript:''}));
 const html=recordRevisionField('attachments',record,esc);assert.doesNotMatch(html,/<iframe|<script|<object/);assert.match(html,/<audio /);assert.match(html,/<video /);
});

test('peer bytes cannot choose active application-origin response types or dispositions',()=>{
 for(const type of ['text/html','text/javascript','application/javascript','image/svg+xml','application/pdf','image/png; charset=utf-8',undefined]){
  const peer={'content-type':type,'content-disposition':'inline; filename="attack.html"'};
  assert.throws(()=>liveFileHeaders(peer,{media:true}),{code:'COLLABORATION_INVALID'});
  const artifact=liveFileHeaders(peer);assert.equal(artifact['Content-Type'],'application/octet-stream');assert.match(artifact['Content-Disposition'],/^attachment;/);assert.equal(artifact['Content-Security-Policy'],"default-src 'none'; sandbox");assert.equal(artifact['X-Content-Type-Options'],'nosniff');
 }
 for(const type of ['image/png','audio/wav','video/mp4'])assert.equal(liveFileHeaders({'content-type':type,'content-length':'123'},{media:true})['Content-Type'],type);
 assert.throws(()=>liveFileHeaders({'content-length':['1','2']}),{code:'COLLABORATION_INVALID'});
 assert.throws(()=>liveFileHeaders({'content-length':'-1'}),{code:'COLLABORATION_INVALID'});
 assert.equal(liveFileHeaders({'content-type':'image/svg+xml'},{format:'svg'})['Content-Type'],'application/octet-stream');
});
