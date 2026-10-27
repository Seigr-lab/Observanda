import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {buildBrowser} from '../scripts/browser-build.js';
import {createApplicationAssets} from '../src/application-assets.js';
import {testServer} from './device-fixture.js';

test('only verified application chunks receive immutable caching and stale chunk URLs never fall back',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-assets-http-'));let app;
 t.after(async()=>{await app?.close();assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-assets-http-'));await rm(directory,{recursive:true,force:true});});
 const out=path.join(directory,'frontend'),built=await buildBrowser({out}),assets=await createApplicationAssets({builtDirectory:pathToFileURL(out+path.sep)});
 app=await testServer({port:0,preferencesFile:path.join(directory,'preferences.json'),browserAssets:assets});
 const get=(url,headers)=>fetch(app.origin+url,{headers});
 const entry=await get('/'+built.manifest.entry);assert.equal(entry.status,200);assert.match(entry.headers.get('cache-control'),/immutable/);const etag=entry.headers.get('etag');assert.match(etag,/^"[a-f0-9]{64}"$/);await entry.arrayBuffer();
 const cached=await get('/'+built.manifest.entry,{'If-None-Match':etag});assert.equal(cached.status,304);assert.equal((await cached.arrayBuffer()).byteLength,0);assert.equal(cached.headers.get('etag'),etag);
 for(const name of ['/','/startup.js','/app.js','/api/health','/api/workspace','/api/diagnostics']){
  const response=await get(name);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('etag'),null);await response.arrayBuffer();
 }
 for(const name of ['/assets/app-OLD.js','/assets/../../outside.js','/assets/%2e%2e%2fprivate.js']){const response=await get(name);assert.ok(response.status>=400);assert.equal(response.headers.get('cache-control'),'no-store');assert.ok(!(await response.text()).includes('<!doctype html>'));}
});
