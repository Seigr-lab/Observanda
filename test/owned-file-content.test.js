import {test} from 'node:test';
import assert from 'node:assert/strict';
import {FileContent,contentBuffer} from '../src/file-content.js';
import {OwnedFileContent} from '../src/owned-file-content.js';

test('deferred file owners drain cancellation and errors without retaining a read lease',async()=>{
 let active=0,closed=0,produced=0,broken=false;
 class Source extends FileContent{
  async *read(){try{for(let i=0;i<100;i++){assert.equal(active,1);produced++;if(broken)throw Error('Owner failed');yield Buffer.alloc(1024*1024,i);}}finally{closed++;}}
  async verify(){assert.equal(active,1);if(broken)throw Error('Verification failed');}
 }
 const content=new OwnedFileContent(null,'source',100*1024*1024,'unused',async consume=>{active++;try{return await consume(new Source());}finally{active--;}});
 await content.verify();assert.equal(active,0);
 for await(const chunk of content.read()){assert.equal(chunk.length,1024*1024);assert.equal(active,1);break;}
 assert.equal(active,0);assert.equal(closed,1);assert.ok(produced<=5,'Consumer exit buffered the complete original');
 broken=true;await assert.rejects(contentBuffer(content),/Owner failed/);assert.equal(active,0);assert.equal(closed,2);
 await assert.rejects(content.verify(),/Verification failed/);assert.equal(active,0);
 const controller=new AbortController();controller.abort();await assert.rejects(async()=>{for await(const chunk of content.read(0,4,{signal:controller.signal}))void chunk;},{name:'AbortError'});assert.equal(active,0);assert.equal(closed,2);
});
