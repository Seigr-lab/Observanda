import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {intakeFixture} from './fixtures/local-intake.js';
import {RecordBlockStore} from '../src/record-block-store.js';
import {RecordDocument} from '../src/record-document.js';
import {copyRecordOwnerDocument,withRecordOwnerDocument} from '../src/record-owner-document.js';

test('document transfer reuses one reader across committed batches and closes it on interruption',{timeout:90000},async t=>{
 const source=await intakeFixture(t),target=await intakeFixture(t),record={...source.record,sections:Array.from({length:160},(_,i)=>({id:randomUUID(),title:'Section '+i,body:'Observation '+i}))};
 const scope=source.record.notebookId,destination=target.record.notebookId;
 let root;
 await source.ws.withLock(()=>source.ws.catalogue(async store=>{
  const key=await store.scopeKey(scope,1,{create:true});try{const blocks=new RecordBlockStore(store,scope,1,key);root=await blocks.tree().retain(record);await blocks.flush();}finally{key.fill(0);}
 }));
 let writing=false,readers=0,closed=0;
 const open=target.ws.openCatalogue.bind(target.ws);
 target.ws.openCatalogue=async()=>{const db=await open();if(!writing){readers++;const close=db.close.bind(db);db.close=async()=>{closed++;return close();};}return db;};
 const write=async operation=>{writing=true;try{return await target.ws.withLock(()=>target.ws.catalogue(operation));}finally{writing=false;}};
 const copy=async options=>source.ws.catalogue(async store=>{
  const key=await store.scopeKey(scope,1);try{return await copyRecordOwnerDocument(new RecordDocument(new RecordBlockStore(store,scope,1,key),root),target.ws,{write,notebookId:destination,transform:doc=>doc.replace(['notebookId'],destination),...options});}finally{key.fill(0);}
 });
 const descriptor=await copy();assert.equal(readers,1);assert.equal(closed,1);
 target.ws.openCatalogue=open;
 await target.ws.catalogue(store=>withRecordOwnerDocument(store,descriptor,async doc=>assert.deepEqual(await doc.tree.read(doc.root),{...record,notebookId:destination})));
 target.ws.openCatalogue=async()=>{const db=await open();if(!writing){readers++;const close=db.close.bind(db);db.close=async()=>{closed++;return close();};}return db;};
 const abort=new AbortController(),reason=new Error('Interrupted document copy');let writes=0;
 await assert.rejects(copy({signal:abort.signal,write:async operation=>{const result=await write(operation);if(++writes===2)abort.abort(reason);return result;}}),error=>error===reason);
 assert.equal(readers,2);assert.equal(closed,2);
 target.ws.openCatalogue=open;
});
