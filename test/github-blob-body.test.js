import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {GithubBlobBody} from '../src/github-blob-body.js';
import {FileContent} from '../src/file-content.js';
import {Publisher} from '../src/publishing.js';
import {AppError} from '../src/errors.js';
import {repositoryFixture,sha} from './github-fixture.js';

async function collect(body){const chunks=await Array.fromAsync(body.chunks());assert.ok(chunks.every(chunk=>chunk.length<=65536));const text=chunks.join('');assert.equal(Buffer.byteLength(text),body.length);const value=JSON.parse(text);assert.equal(value.encoding,'base64');return Buffer.from(value.content,'base64');}
test('streamed GitHub JSON preserves arbitrary base64 and UTF-8 boundaries in bounded windows',async()=>{
 for(const length of [0,1,2,3,4,49151,49152,49153,300000]){const bytes=randomBytes(length);assert.deepEqual(await collect(new GithubBlobBody(bytes)),bytes);}
 for(const text of ['\u{1f41d}'.repeat(50000),'x'.repeat(49151)+'\u{1f41d}'+'\ud800', '"\\\n\u754c'])assert.deepEqual(await collect(new GithubBlobBody(text)),Buffer.from(text));
 class Fragmented extends FileContent{async *read(){for(const byte of Buffer.from('single-byte input'))yield Buffer.from([byte]);}}
 assert.deepEqual(await collect(new GithubBlobBody(new Fragmented({},'unused',17,'unused'))),Buffer.from('single-byte input'));
});

test('streamed GitHub uploads release specialized source owners on interruption and reject size drift',async()=>{
 let closed=false,reads=0;const controller=new AbortController(),reason=Error('cancel upload');
 class Source extends FileContent{async *read(_start,_end,{signal}={}){try{for(let i=0;i<10;i++){signal.throwIfAborted();reads++;yield Buffer.alloc(100000);}}finally{closed=true;}}}
 const iterator=new GithubBlobBody(new Source({},'unused',1000000,'unused')).chunks({signal:controller.signal});await iterator.next();await iterator.next();controller.abort(reason);await assert.rejects(iterator.next(),error=>error===reason);assert.equal(closed,true);assert.ok(reads<=2,'Only the active chunk and the stream read-ahead may be read');
 class WrongSize extends FileContent{async *read(){yield Buffer.from('abc');}}
 for(const size of [2,4])await assert.rejects(collect(new GithubBlobBody(new WrongSize({},'unused',size,'unused'))),{code:'MEDIA_INVALID'});
});

function publisher(request){const value=Object.create(Publisher.prototype);value.token='synthetic-test-token';value.request=request;return value;}
test('publisher streams JSON with bounded backpressure and preserves the response body',async t=>{
 const bytes=randomBytes(200000);let received;
 const server=createServer(async(req,res)=>{const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=Buffer.concat(chunks);assert.equal(body.length,Number(req.headers['content-length']));received=Buffer.from(JSON.parse(body).content,'base64');res.writeHead(201,{'Content-Type':'application/json'});res.write('{"sha":');setTimeout(()=>res.end('"result"}'),10);});
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
 const client=publisher((_url,options)=>fetch('http://127.0.0.1:'+server.address().port,options));
 assert.deepEqual(await client.github('/git/blobs','POST',new GithubBlobBody(bytes)),{sha:'result'});assert.deepEqual(received,bytes);
});

test('publisher keeps source admission errors and closes sources on early remote rejection',async()=>{
 const error=new AppError('ACCESS_LOCKED');class Denied extends FileContent{async *read(){throw error;}}
 const client=publisher(async(_url,options)=>{await Array.fromAsync(options.body);return new Response('{}');});
 await assert.rejects(client.github('/git/blobs','POST',new GithubBlobBody(new Denied({},'unused',3,'unused'))),value=>value===error);
 let closed=false;class Source extends FileContent{async *read(){try{yield Buffer.alloc(100000);}finally{closed=true;}}}
 const rejected=publisher(async(_url,options)=>{await options.body.next();await options.body.next();return new Response('',{status:403});});
 await assert.rejects(rejected.github('/git/blobs','POST',new GithubBlobBody(new Source({},'unused',100000,'unused'))),{code:'GITHUB_PERMISSION'});assert.equal(closed,true);
});

test('repository setup fixture forwards a streamed body once to its Git object transport',async()=>{
 const remote=repositoryFixture({exists:true}),bytes=Buffer.from('retained upload'),client=publisher(remote.request);
 assert.deepEqual(await client.github('/repos/example/notebook/git/blobs','POST',new GithubBlobBody(bytes)),{sha:sha('blob',bytes)});
});
