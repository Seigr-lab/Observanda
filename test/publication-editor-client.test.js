import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as id} from 'node:crypto';
import {createNotebook} from '../src/model.js';
import {publicationEditorClient} from '../src/web/publication-editor-client.js';
function fixture(){
 const source=id(),project=id(),book=id(),record=id(),attachment=id(),state={page:'website',websiteId:id(),book:createNotebook('Website host'),etag:'a'.repeat(64),storage:{contextId:'host'},access:{locked:false}};
 state.book.website.researchSources=[{workspaceId:source,projectIds:[project],selection:{defaultShare:false,includeProjects:[project],records:[]}}];
 const payload={workspaceId:state.book.id,recordCount:12,sources:[{workspaceId:source,snapshotId:'b'.repeat(64),projectId:project,labBookId:book}],projects:[{id:project,title:'Project'}],notebooks:[{id:book,title:'Book',projectId:project}],records:[{id:record,title:'Record',notebookId:book,type:'note',attachments:[{id:attachment,kind:'image',share:true,caption:'Photo',alt:'Description',transcript:'Private'}],body:'Original'}]};
 return {state,payload,client:publicationEditorClient({state}),record};
}
test('combined editor labels remain outside the host save document and drop unknown original fields',()=>{
 const {state,payload,client,record}=fixture(),before=structuredClone(state.book);client.accept(payload);
 const display=client.pageBook(state.book);assert.equal(display.entries[0].id,record);assert.equal(client.recordCount(),12);assert.deepEqual(state.book,before);
 assert.equal(Object.hasOwn(client.record(record),'body'),false);assert.equal(Object.hasOwn(client.record(record).attachments[0],'transcript'),false);
 display.entries[0].title='Website label';assert.equal(payload.records[0].title,'Record');
});
test('changing websites, consent or locking drops the foreign display cache',()=>{
 for(const change of [state=>state.websiteId=id(),state=>state.book.website.researchSources[0].selection.includeProjects=[],state=>state.access.locked=true,state=>state.page='dashboard']){
  const {state,payload,client,record}=fixture();client.accept(payload);change(state);assert.equal(client.record(record),null);assert.equal(client.pageBook(state.book).entries.length,0);
 }
});
test('source substitutions, malformed hierarchy and unadmitted attachment metadata are rejected',()=>{
 for(const change of [p=>p.sources[0].workspaceId=id(),p=>p.notebooks[0].projectId=id(),p=>p.records[0].notebookId=id(),p=>p.records[0].attachments[0].share=false,p=>p.recordCount=-1]){
  const {payload,client}=fixture();change(payload);assert.throws(()=>client.accept(payload),/PUBLICATION_EDITOR_RESPONSE/);
 }
});

test('record labels retain the supported 180-character title limit',()=>{
 const {payload,client,record}=fixture();payload.records[0].title='R'.repeat(180);client.accept(payload);assert.equal(client.record(record).title.length,180);
 payload.records[0].title+='R';assert.throws(()=>client.accept(payload),/PUBLICATION_EDITOR_RESPONSE/);
});
