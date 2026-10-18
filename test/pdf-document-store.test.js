import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PdfDocumentStore} from '../src/pdf-document-store.js';
import {pdfLayoutPreset} from '../src/web/pdf-layout-model.js';
const section=(title='First',content='Exact observation')=>({id:randomUUID(),title,content,layout:null,start:null});
const creation=(name='Report')=>{const id=randomUUID();return {id,commandId:randomUUID(),expectedRevision:null,operation:{type:'create',header:{version:1,id,name,language:'en',direction:'ltr',layout:pdfLayoutPreset()},section:section()}};};
function memory(){const data=new Map(),owner={domain:'pdf',async object(id){return structuredClone(data.get(id)??null);},async putObject(id,value){data.set(id,structuredClone(value));},async *objectIdEntries(prefix){for(const key of [...data.keys()].sort())if(key.startsWith(prefix))yield key;}};return {owner,data,documents:new PdfDocumentStore(owner)};}
test('independent PDF documents preserve selected edits, page order, old editions and command retries',async()=>{
 const {documents:d}=memory(),create=creation(),created=await d.change(create),other=creation('Another report'),otherHead=await d.change(other);assert.equal((await d.list()).items.length,2);
 const id=create.id,first=create.operation.section,second=section('Second','Retained second text'),append={id,commandId:randomUUID(),expectedRevision:created.revision,operation:{type:'append',section:second}},added=await d.change(append);
 assert.deepEqual(await d.change(append),{revision:added.revision,replayed:true});await assert.rejects(d.change({...append,operation:{type:'append',section:section('Changed retry')}}),{code:'MODULE_REPLAY'});
 const moved=await d.change({id,commandId:randomUUID(),expectedRevision:added.revision,operation:{type:'move',sectionId:second.id,direction:-1}});
 assert.deepEqual((await d.sections(id)).items.map(v=>v.id),[second.id,first.id]);assert.deepEqual((await d.sections(id,{revision:added.revision})).items.map(v=>v.id),[first.id,second.id]);
 await assert.rejects(d.change({id,commandId:randomUUID(),expectedRevision:created.revision,operation:{type:'section',section:second}}),{code:'CONFLICT'});
 const revised=await d.change({id,commandId:randomUUID(),expectedRevision:moved.revision,operation:{type:'section',section:{...second,content:'New text'}}});assert.equal((await d.section(id,second.id)).section.content,'New text');assert.equal((await d.section(id,second.id,{revision:added.revision})).section.content,'Retained second text');assert.equal((await d.open(other.id)).revision,otherHead.revision);
 const removed=await d.change({id,commandId:randomUUID(),expectedRevision:revised.revision,operation:{type:'remove-section',sectionId:first.id}});assert.equal((await d.open(id)).count,1);assert.equal((await d.open(id,{revision:created.revision})).count,1);
 assert.deepEqual(await d.verify(),{documents:2,editions:6});await d.change({id,commandId:randomUUID(),expectedRevision:removed.revision,operation:{type:'remove'}});assert.equal((await d.list()).items.length,1);await assert.rejects(d.open(id),{code:'NOT_FOUND'});assert.deepEqual(await d.verify(),{documents:1,editions:7});
});
test('PDF section and document windows retain complete traversal and detect missing or substituted content',async()=>{
 const {documents:d,data}=memory(),create=creation();let saved=await d.change(create);
 for(let i=0;i<38;i++)saved=await d.change({id:create.id,commandId:randomUUID(),expectedRevision:saved.revision,operation:{type:'append',section:section('Section '+i,'value '+i)}});
 const ids=[];let offset=0;do{const page=await d.sections(create.id,{offset,limit:7});ids.push(...page.items.map(v=>v.id));offset=page.next;}while(offset!==null);assert.equal(ids.length,39);assert.equal(new Set(ids).size,39);assert.equal((await d.section(create.id,ids.at(-1))).section.content,'value 37');
 const revisionKey='pdf:revision:'+create.id+':'+saved.revision,original=data.get(revisionKey);data.set(revisionKey,{...original,header:{...original.header,name:'Substituted'}});await assert.rejects(d.open(create.id),{code:'CATALOGUE_DAMAGED'});data.set(revisionKey,original);
 const headKey='pdf:head:'+create.id,head=data.get(headKey);data.delete(headKey);await assert.rejects(d.verify(),{code:'CATALOGUE_DAMAGED'});data.set(headKey,head);assert.equal((await d.verify()).documents,1);
});
