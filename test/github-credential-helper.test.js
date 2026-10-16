import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {mkdtemp,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {GithubCredentialHelper} from '../src/github/credential-helper.js';
test('credential helper isolates configuration and keeps secrets off arguments and diagnostic output',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-credential-pipe-'));t.after(()=>rm(directory,{recursive:true,force:true}));const calls=[],token='synthetic_token_1234567890';
 const spawnProcess=(executable,args,options)=>{const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();let input='';child.stdin=new Writable({write(chunk,encoding,done){input+=chunk;done();},final(done){calls.push({executable,args,options,input});queueMicrotask(()=>{child.stdout.end('protocol=https\nhost=github.com\nusername=alice\npassword='+token+'\n');child.emit('close',0);});done();}});return child;};
 const helper=new GithubCredentialHelper({directory,namespace:'observanda-test',runtime:async()=>({executable:'/private/helper',gitPath:'/private/git/bin/git'}),platform:'win32',spawnProcess});
 assert.deepEqual(await helper.credential(undefined,{interactive:true}),{login:'alice',token});await helper.store({login:'alice',token});
 for(const call of calls){assert.equal(call.options.shell,false);assert.equal(call.options.windowsHide,true);assert.equal(call.options.env.GCM_NAMESPACE,'observanda-test');assert.equal(call.options.env.GCM_TRACE_SECRETS,'0');assert.ok(!JSON.stringify(call.args).includes(token));}
 assert.equal(calls[0].options.env.GCM_CREDENTIAL_STORE,'none');assert.equal(calls[0].options.env.GCM_GITHUB_AUTHMODES,'browser');assert.equal(calls[1].options.env.GCM_CREDENTIAL_STORE,'wincredman');assert.ok(calls[1].input.includes(token));
 await assert.rejects(helper.credential('alice\nhost=evil.invalid'),{code:'INVALID'});
});
test('bundled helper stores and retrieves credentials in an isolated native namespace without external Git', {skip:!process.env.OBSERVANDA_GITHUB_HELPER||!process.env.OBSERVANDA_GITHUB_GIT},async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-native-github-')),token='synthetic_native_1234567890';
 const helper=new GithubCredentialHelper({directory,namespace:'observanda-test-'+randomUUID()});t.after(async()=>{await helper.forget('observanda-synthetic');await rm(directory,{recursive:true,force:true});});
 assert.equal(await helper.available(),true);assert.deepEqual(await helper.accounts(),[]);await helper.store({login:'observanda-synthetic',token});assert.deepEqual(await helper.accounts(),['observanda-synthetic']);
 const restarted=new GithubCredentialHelper({directory,namespace:helper.namespace});assert.deepEqual(await restarted.credential('observanda-synthetic'),{login:'observanda-synthetic',token});await restarted.forget('observanda-synthetic');assert.deepEqual(await restarted.accounts(),[]);
});
