import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PdfLayoutLibrary} from '../src/pdf-layout-library.js';
import {pdfLayoutPreset} from '../src/web/pdf-layout-model.js';
function fixture(){const data=new Map(),library=new PdfLayoutLibrary({domain:'pdf',object:async key=>structuredClone(data.get(key)??null),putObject:async(key,value)=>{data.set(key,structuredClone(value));},async *objectIdEntries(prefix){for(const key of [...data.keys()].sort())if(key.startsWith(prefix))yield key;}});return {data,library};}
const create=name=>({id:randomUUID(),commandId:randomUUID(),expectedRevision:null,operation:{type:'save',name,layout:pdfLayoutPreset()}});
test('saved PDF layouts retain revisions, reject stale updates and keep retries idempotent',async()=>{
 const {data,library}=fixture(),command=create('Field notes'),saved=await library.change(command);
 assert.equal((await library.change(command)).replayed,true);assert.equal((await library.list()).items.length,1);
 await assert.rejects(library.change({...command,operation:{...command.operation,name:'Another name'}}),{code:'MODULE_REPLAY'});
 const revised=await library.change({id:command.id,commandId:randomUUID(),expectedRevision:saved.revision,operation:{...command.operation,layout:{...command.operation.layout,widthMm:180}}});
 assert.equal((await library.value(saved.revision)).layout.widthMm,210);assert.equal((await library.list()).items[0].layout.widthMm,180);
 await assert.rejects(library.change({id:command.id,commandId:randomUUID(),expectedRevision:saved.revision,operation:{type:'remove'}}),{code:'CONFLICT'});
 assert.deepEqual(await library.verify(),{layouts:1});await library.change({id:command.id,commandId:randomUUID(),expectedRevision:revised.revision,operation:{type:'remove'}});assert.deepEqual(await library.list(),{items:[],next:null});assert.deepEqual(await library.verify(),{layouts:0});
 data.delete('pdf-layout:value:'+saved.revision);await assert.rejects(library.verify(),{code:'CATALOGUE_DAMAGED'});
});
test('layout lists traverse every saved layout through bounded pages',async()=>{
 const {library}=fixture();for(let i=0;i<37;i++)await library.change(create('Layout '+i));
 let after=null;const ids=[];do{const page=await library.list({after,limit:7});ids.push(...page.items.map(item=>item.id));after=page.next;}while(after!==null);
 assert.equal(ids.length,37);assert.equal(new Set(ids).size,37);assert.deepEqual(await library.verify(),{layouts:37});
});
