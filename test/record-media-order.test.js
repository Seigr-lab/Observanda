import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mediaValueFixture} from './record-media-values-fixture.js';
import {RecordMediaCommands} from '../src/record-media-commands.js';
import {RecordContent} from '../src/record-content.js';
import {emptyMediaMetadata} from '../src/web/record-media-value.js';

const ids=async f=>(await new RecordContent(f.workspace).read({workspaceId:f.book.id,recordId:f.record.id,pagedHeader:true,windows:{attachments:0}})).header.attachments.map(item=>item.id);
const all=async f=>{const reader=new RecordContent(f.workspace),result=[];for(let offset=0;;){const page=await reader.read({workspaceId:f.book.id,recordId:f.record.id,pagedHeader:true,windows:{attachments:offset}});result.push(...page.header.attachments);offset+=page.header.attachments.length;if(offset>=page.collections.attachments.total)return result;}};

test('gallery order moves one attachment, keeps every value and acknowledges a repeated move',async t=>{
 const f=await mediaValueFixture({count:9});t.after(f.close);
 const commands=new RecordMediaCommands(f.workspace),original=f.record.attachments.map(item=>item.id),moved=original[7];
 const base=await f.values.read(f.target(moved)),details={...emptyMediaMetadata(),creator:'A. Recorder',location:'Private site 7'};
 await f.save(base,{...base.value.value,caption:'Moved photograph',metadata:details});
 const command={workspaceId:f.book.id,recordId:f.record.id,mediaId:moved,action:'move',position:1};
 const receipt=await commands.run(command);assert.equal(receipt.position,1);assert.equal(receipt.total,9);
 const expected=[original[0],moved,...original.slice(1,7),original[8]],after=await all(f);
 assert.deepEqual(after.map(item=>item.id),expected);
 const item=after[1];assert.equal(item.caption,'Moved photograph');assert.deepEqual(item.metadata,details);
 for(const other of after.filter(value=>value.id!==moved))assert.deepEqual(other,f.record.attachments.find(value=>value.id===other.id));
 assert.deepEqual(await commands.run(command),{...receipt,etag:receipt.etag});
 // Later in the order, then to the very end.
 await commands.run({...command,position:8});assert.equal((await all(f)).at(-1).id,moved);
 assert.deepEqual((await ids(f)).slice(0,1),[original[0]]);
});

test('moves outside the gallery or of absent media are refused without writing',async t=>{
 const f=await mediaValueFixture({count:3});t.after(f.close);
 const commands=new RecordMediaCommands(f.workspace),before=(await f.workspace.outline()).etag,base={workspaceId:f.book.id,recordId:f.record.id,mediaId:f.record.attachments[0].id,action:'move'};
 await assert.rejects(commands.run({...base,position:3}),{code:'INVALID'});
 for(const position of [-1,1.5,'1',null])await assert.rejects(commands.run({...base,position}),{code:'INVALID'});
 await assert.rejects(commands.run({...base,position:0,extra:true}),{code:'INVALID'});
 await assert.rejects(commands.run({...base,mediaId:randomUUID(),position:0}),{code:'MISSING'});
 assert.equal((await f.workspace.outline()).etag,before);
});
