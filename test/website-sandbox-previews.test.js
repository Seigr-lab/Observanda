import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {sandboxPreviews,serveSandboxPreview,sandboxPreviewPath,sandboxPreviewPolicy} from '../src/website-sandbox-previews.js';

const code=fn=>{try{fn();}catch(error){return error.code;}return null;};

test('a kept preview is read back only by its workspace, only while fresh',()=>{
 let time=1000;const store=sandboxPreviews({now:()=>time});
 const token=store.keep('workspace-a','<!doctype html><style>h1{color:red}</style><h1>Preview</h1>');
 assert.match(token,/^[a-f0-9]{48}$/);
 assert.equal(store.read('workspace-a',token),'<!doctype html><style>h1{color:red}</style><h1>Preview</h1>');
 assert.equal(code(()=>store.read('workspace-b',token)),'NOT_FOUND');
 assert.equal(code(()=>store.read('workspace-a','../'+token)),'NOT_FOUND');
 time+=10*60*1000;
 assert.equal(code(()=>store.read('workspace-a',token)),'NOT_FOUND');
});

test('previews are bounded in size and number',()=>{
 const store=sandboxPreviews();
 assert.equal(code(()=>store.keep('w','')),'INVALID');
 assert.equal(code(()=>store.keep('w',{html:'x'})),'INVALID');
 assert.equal(code(()=>store.keep('w','x'.repeat(2*1024*1024+1))),'INVALID');
 const first=store.keep('w','<p>first</p>');
 for(let i=0;i<64;i++)store.keep('w','<p>'+i+'</p>');
 assert.equal(code(()=>store.read('w',first)),'NOT_FOUND');
});

test('a preview is served as its own sandboxed document that allows only its inline styles',async()=>{
 const store=sandboxPreviews(),token=store.keep('w','<style>p{margin:0}</style><p>Layout</p>');
 const headers={},res=Object.assign(new EventEmitter(),{setHeader:(name,value)=>{headers[name.toLowerCase()]=value;},writeHead(status,more){this.status=status;Object.assign(headers,Object.fromEntries(Object.entries(more??{}).map(([k,v])=>[k.toLowerCase(),v])));},end(body){this.body=body;}});
 await serveSandboxPreview({method:'GET',headers:{}},res,{pathname:sandboxPreviewPath+token,contextId:'w',store});
 assert.equal(res.status,200);assert.equal(res.body.toString(),'<style>p{margin:0}</style><p>Layout</p>');
 assert.equal(headers['content-security-policy'],sandboxPreviewPolicy);
 assert.match(sandboxPreviewPolicy,/^sandbox;/);assert.match(sandboxPreviewPolicy,/default-src 'none'/);assert.doesNotMatch(sandboxPreviewPolicy,/script-src/);
 assert.equal(headers['cache-control'],'no-store');assert.equal(headers['x-content-type-options'],'nosniff');
 await assert.rejects(serveSandboxPreview({method:'POST',headers:{}},res,{pathname:sandboxPreviewPath+token,contextId:'w',store}),{code:'NOT_FOUND'});
});
