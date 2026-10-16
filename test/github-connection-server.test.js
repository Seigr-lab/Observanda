import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {startServer} from '../src/server.js';
import {sampleNotebook} from '../src/sample.js';
import {Workspace} from '../src/storage.js';
import {GithubConnections} from '../src/github/connections.js';

test('GitHub account changes require the local session and serialize with publication commands',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-github-api-')),root=path.join(directory,'workspace'),ws=new Workspace(root);await ws.create(sampleNotebook());let release,started;const waiting=new Promise(resolve=>{started=resolve;});
 const connections=new GithubConnections({file:path.join(directory,'github.json'),helper:{available:async()=>true,accounts:async()=>['alice'],credential:async()=>{started();await new Promise(resolve=>{release=resolve;});return {login:'alice',token:'synthetic_token_1234567890'};}},request:async()=>new Response('{"id":1,"login":"alice"}')});
 const app=await startServer({root,port:0,githubConnections:connections});t.after(async()=>{release?.();await app.close();await rm(directory,{recursive:true,force:true});});
 const route='/api/github-connection/choose';const raw=(url,data,headers={})=>fetch(app.origin+url,{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json',...headers},body:JSON.stringify(data)});
 assert.equal((await raw(route,{login:'alice'})).status,401);
 const auth=await raw('/api/session',{token:app.launchToken}),Cookie=auth.headers.get('set-cookie').split(';')[0],request=(url,data)=>raw(url,data,{Cookie});
 assert.equal((await raw(route,{login:'alice'},{Cookie,Origin:'https://attacker.invalid'})).status,403);
 const selecting=request(route,{login:'alice'});await waiting;
 for(const url of ['/api/github-connection/start','/api/publishing/connect','/api/publishing/deploy','/api/deployment-jobs/start','/api/repository-setup/start'])assert.equal((await (await request(url,{})).json()).code,'GITHUB_PUBLICATION_BUSY',url);
 release();const result=await (await selecting).json();assert.equal(result.selected.login,'alice');assert.ok(!JSON.stringify(result).includes('synthetic_token'));
 await request('/api/access/lock',{});const locked=await request('/api/github-connection/status',{});assert.notEqual(locked.status,200);assert.equal(connections.cache.size,0);
});
