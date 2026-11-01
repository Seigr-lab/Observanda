import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DownloadCapabilities} from '../src/download-capabilities.js';
import {sessionPreview} from '../src/web/session-preview.js';

test('download capabilities expire, bind the complete target and workspace, and authorize one GET only',()=>{
 let now=0;const tickets=new DownloadCapabilities({now:()=>now,lifetime:10,maximum:2}),session='a'.repeat(64),context='workspace-a',target='/api/media/test?context=workspace-a',token=tickets.issue(session,context,target);
 for(const [scope,path] of [[context,'/api/notebook'],['workspace-b',target],[context,target+'&extra=1']])assert.throws(()=>tickets.consume(token,scope,path),{code:'AUTH'});
 assert.equal(tickets.consume(token,context,target),session);assert.throws(()=>tickets.consume(token,context,target),{code:'AUTH'});
 const expires=tickets.issue(session,context,target);now=10;assert.throws(()=>tickets.consume(expires,context,target),{code:'AUTH'});
 const first=tickets.issue(session,context,target);tickets.issue(session,context,target);assert.throws(()=>tickets.issue(session,context,target),{code:'WORKLOAD_BUSY'});tickets.clear();assert.throws(()=>tickets.consume(first,context,target),{code:'AUTH'});
 for(const path of ['/api/session','/api/session/download','https://example.org/','/app.js','/api/'+'a'.repeat(8192)])assert.throws(()=>tickets.issue(session,context,path),{code:'INVALID'});
});

test('preview session injection preserves streamed Unicode content and never buffers a complete page',async()=>{
 const html='<!DOCTYPE html><html><head><title>研究</title></head><body>α🌱'.repeat(3)+'</body></html>',bytes=new TextEncoder().encode(html),stream=new ReadableStream({start(controller){for(let i=0;i<bytes.length;i+=2)controller.enqueue(bytes.subarray(i,i+2));controller.close();}}),original=new Response(stream,{headers:{'Content-Type':'text/html; charset=utf-8','Content-Length':String(bytes.length),'ETag':'unmodified'}}),result=sessionPreview(original),text=await result.text();
 assert.equal(text.replace('<script type="module" src="/session-download.js" data-observanda-session></script>',''),html);assert.equal((text.match(/data-observanda-session/g)??[]).length,1);assert.equal(result.headers.get('content-length'),null);assert.equal(result.headers.get('etag'),null);
 const small=new Response('short',{headers:{'Content-Type':'text/html'}});assert.equal(await sessionPreview(small).text(),'short');
 const partial=new Response('partial',{status:206,headers:{'Content-Type':'text/html'}});assert.equal(sessionPreview(partial),partial);
 const binary=new Response(bytes,{headers:{'Content-Type':'image/png'}});assert.equal(sessionPreview(binary),binary);
});
