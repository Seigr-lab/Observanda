import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {GithubConnections} from '../src/github/connections.js';
import {AppError} from '../src/errors.js';
import {Publisher} from '../src/publishing.js';

const accounts={alice:{id:1,login:'alice',token:'synthetic_alice_1234567890'},bob:{id:2,login:'bob',token:'synthetic_bob_1234567890'}};
async function fixture(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-github-'));t.after(()=>rm(directory,{recursive:true,force:true}));const file=path.join(directory,'connections.json'),store=new Map();
 const helper={available:async()=>true,accounts:async()=>[...store.keys()],credential:async(login,{interactive,signal}={})=>{signal?.throwIfAborted();const token=interactive?accounts.alice.token:store.get(login);if(!token)throw new AppError('GITHUB_RECONNECT');return {login:login??'alice',token};},store:async({login,token})=>{store.set(login,token);},forget:async(login)=>store.delete(login)};
 const request=async(url,{headers})=>{assert.equal(url,'https://api.github.com/user');const account=Object.values(accounts).find(a=>'Bearer '+a.token===headers.Authorization);return new Response(JSON.stringify(account?{id:account.id,login:account.login}:{}),{status:account?200:401});};
 const connections=new GithubConnections({file,helper,request});return {directory,file,helper,store,request,connections,root:path.join(directory,'workspace')};
}
test('browser authorization binds verified identity, persists only identity, and reconnects after restart',async t=>{
 const f=await fixture(t);await f.connections.start(f.root);await f.connections.pending.promise;const status=await f.connections.status(f.root);
 assert.equal(status.signIn.state,'completed');assert.equal(status.selected.login,'alice');assert.equal(status.connected,true);assert.equal(await f.connections.token(f.root),accounts.alice.token);
 const disk=await readFile(f.file,'utf8');assert.ok(!disk.includes(accounts.alice.token));assert.ok(!JSON.stringify(status).includes(accounts.alice.token));
 const restarted=new GithubConnections(f);assert.equal(await restarted.token(f.root),accounts.alice.token);
 f.store.set('bob',accounts.bob.token);await restarted.choose(f.root,'bob');assert.equal(await restarted.token(f.root),accounts.bob.token);
 await restarted.disconnect(f.root);assert.deepEqual([...f.store.keys()],['alice','bob']);await assert.rejects(restarted.token(f.root),{code:'GITHUB_RECONNECT'});
 await restarted.choose(f.root,'alice');await restarted.choose(f.root+'-other','alice');await restarted.disconnect(f.root,{forget:true});assert.equal(f.store.has('alice'),false);assert.equal((await restarted.status(f.root+'-other')).selected,null);assert.equal(f.store.has('bob'),true);
});
test('cancel and lock reject late authorization without storing or replacing the previous account',async t=>{
 const f=await fixture(t);f.store.set('alice',accounts.alice.token);await f.connections.choose(f.root,'alice');let release;
 f.helper.credential=async()=>{await new Promise(resolve=>{release=resolve;});return accounts.bob;};
 await f.connections.start(f.root);await new Promise(resolve=>setImmediate(resolve));await assert.rejects(f.connections.start(f.root),{code:'GITHUB_SIGNIN_BUSY'});
 const cancel=f.connections.cancel(f.root);release();await cancel;assert.equal(f.connections.pending.state,'cancelled');assert.equal(f.store.has('bob'),false);assert.equal((await f.connections.status(f.root)).selected.login,'alice');
 await f.connections.start(f.root);await new Promise(resolve=>setImmediate(resolve));const clear=f.connections.clear();release();await clear;assert.equal(f.connections.cache.size,0);assert.equal(f.store.has('bob'),false);
});
test('mismatched identity, revoked authorization, and storage failure cannot report connected',async t=>{
 const f=await fixture(t);f.helper.credential=async()=>({login:'alice',token:accounts.bob.token});await f.connections.start(f.root);await f.connections.pending.promise;assert.equal(f.connections.pending.error,'GITHUB_CREDENTIALS');assert.equal(f.store.size,0);
 f.helper.credential=async()=>accounts.alice;f.helper.store=async()=>{throw new AppError('GITHUB_CREDENTIALS');};await f.connections.start(f.root);await f.connections.pending.promise;assert.equal((await f.connections.status(f.root)).connected,false);
 f.store.set('alice',accounts.alice.token);await f.connections.choose(f.root,'alice');const publisher=new Publisher(f.root,{connection:f.connections.forWorkspace(f.root),request:async()=>new Response('{}',{status:401})});
 await assert.rejects(publisher.github('/user'),{code:'GITHUB_RECONNECT'});assert.equal((await f.connections.status(f.root)).connected,false);await assert.rejects(f.connections.token(f.root),{code:'GITHUB_RECONNECT'});
});
test('disconnect wins against a delayed account selection or credential retrieval',async t=>{
 const f=await fixture(t);f.store.set('alice',accounts.alice.token);await f.connections.choose(f.root,'alice');let release;f.helper.credential=async()=>{await new Promise(resolve=>{release=resolve;});return accounts.bob;};
 const choosing=f.connections.choose(f.root,'bob');const rejected=assert.rejects(choosing,{code:'GITHUB_SIGNIN_CANCELLED'});await new Promise(resolve=>setImmediate(resolve));const disconnect=f.connections.disconnect(f.root);release();await Promise.all([disconnect,rejected]);assert.equal((await f.connections.status(f.root)).selected,null);assert.equal(f.connections.cache.size,0);
 f.helper.credential=async()=>accounts.alice;await f.connections.choose(f.root,'alice');f.connections.cache.clear();f.helper.credential=async()=>{await new Promise(resolve=>{release=resolve;});return accounts.alice;};
 const retrieving=f.connections.token(f.root),noCredential=assert.rejects(retrieving,{code:'GITHUB_RECONNECT'});while(!release)await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setTimeout(resolve,10));await f.connections.clear();release();await noCredential;assert.equal(f.connections.cache.size,0);
});
test('organization approval, denied access and rate limits produce distinct recovery instructions',async t=>{
 const f=await fixture(t);f.store.set('alice',accounts.alice.token);await f.connections.choose(f.root,'alice');
 for(const [headers,code] of [[{'X-GitHub-SSO':'required; url=https://github.com/orgs/example/sso'},'GITHUB_ORGANIZATION_AUTH'],[{'X-RateLimit-Remaining':'0'},'GITHUB_RATE_LIMIT'],[{},'GITHUB_PERMISSION']]){
  const publisher=new Publisher(f.root,{connection:f.connections.forWorkspace(f.root),request:async()=>new Response('{}',{status:403,headers})});await assert.rejects(publisher.github('/user'),{code});assert.equal((await f.connections.status(f.root)).connected,true);
 }
});
test('native helper failures never expose raw diagnostics or unknown UI error keys',async t=>{
 const f=await fixture(t),error=Object.assign(Error('secret diagnostic '+accounts.alice.token),{code:'ENOENT'});
 f.helper.accounts=async()=>{throw error;};f.helper.credential=async()=>{throw error;};await f.connections.start(f.root);await f.connections.pending.promise;
 const status=await f.connections.status(f.root);assert.equal(status.error,'GITHUB_CREDENTIALS');assert.equal(status.signIn.error,'GITHUB_CREDENTIALS');assert.equal(status.signIn.state,'failed');assert.ok(!JSON.stringify(status).includes(accounts.alice.token));
});
test('device challenge is session-only, disappears on completion, and ignores late cancelled callbacks',async t=>{
 const f=await fixture(t);let finish,announce;
 f.helper.credential=async(_login,{onVerification})=>{announce=onVerification;return new Promise(resolve=>{finish=()=>resolve(accounts.alice);});};
 await f.connections.start(f.root);while(!announce)await new Promise(resolve=>setImmediate(resolve));
 announce({url:'https://attacker.invalid',code:'ABCD-1234'});assert.equal((await f.connections.status(f.root)).signIn.verification,undefined);
 announce({url:'https://github.com/login/device',code:'ABCD-5678'});assert.equal((await f.connections.status(f.root)).signIn.verification.code,'ABCD-5678');
 finish();await f.connections.pending.promise;assert.equal((await f.connections.status(f.root)).signIn.verification,undefined);assert.ok(!(await readFile(f.file,'utf8')).includes('ABCD-5678'));
 await f.connections.start(f.root);await new Promise(resolve=>setImmediate(resolve));const cancel=f.connections.cancel(f.root);announce({url:'https://github.com/login/device',code:'LATE-1234'});finish();await cancel;
 assert.equal((await f.connections.status(f.root)).signIn.verification,undefined);assert.equal(f.connections.pending.verification,undefined);
});
