import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,stat} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import {encrypted} from '../src/encryption.js';

function cli(args,password='',env=process.env){
 return new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,['src/cli.js',...args],{windowsHide:true,stdio:['pipe','pipe','pipe'],env});
  let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);child.once('error',reject);
  child.once('close',code=>resolve({code,output}));child.stdin.end(password?password+'\\n':'');
 });
}
test('CLI creates and validates portable encryption using standard input only',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'observanda-cli-')),root=path.join(dir,'Private CLI sentinel'),preferences=path.join(dir,'preferences.json');
 const options=['--workspace',root,'--preferences',preferences,'--password-stdin'],password='synthetic portable CLI passphrase';
 const created=await cli(['init',...options,'--title','Private CLI sentinel'],password);assert.equal(created.code,0,created.output);
 const bytes=await readFile(path.join(root,'workspace.observanda'));assert.ok(encrypted(bytes));assert.ok(!bytes.includes(Buffer.from('Private CLI sentinel')));
 const checked=await cli(['validate',...options],password);assert.equal(checked.code,0,checked.output);assert.ok(!checked.output.includes(password));assert.match(checked.output,/Verifying workspace/);assert.match(checked.output,/Objects read:/);
 const refused=await cli(['validate',...options],'wrong password');assert.notEqual(refused.code,0);assert.match(refused.output,/ACCESS_DENIED/);
});
test('CLI can reopen OS-protected work in a new process without an app password',{skip:process.platform!=='win32'},async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'observanda-cli-device-')),root=path.join(dir,'work'),options=['--workspace',root,'--preferences',path.join(dir,'preferences.json')];
 const created=await cli(['init',...options]);assert.equal(created.code,0,created.output);
 assert.ok(encrypted(await readFile(path.join(root,'workspace.observanda'))));
 const checked=await cli(['validate',...options]);assert.equal(checked.code,0,checked.output);
});


test('CLI automatically initializes PostgreSQL and reopens the same encrypted workspace on its next launch',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'observanda-cli-managed-')),root=path.join(dir,'Retained managed workspace'),preferences=path.join(dir,'preferences.json');
 t.after(()=>rm(dir,{recursive:true,force:true}));
 const env={...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN??''};delete env.OBSERVANDA_DATABASE_URL;
 const options=['--workspace',root,'--preferences',preferences,'--password-stdin'],password='synthetic managed CLI passphrase';
 const created=await cli(['init',...options,'--title','Retained managed workspace'],password,env);assert.equal(created.code,0,created.output);
 const descriptor=await readFile(path.join(root,'workspace.observanda'));
 await stat(path.join(root,'.observanda','postgresql','data','PG_VERSION'));
 assert.equal(JSON.parse(await readFile(path.join(root,'.observanda','research.observanda'),'utf8')).placement,'workspace');
 assert.match(created.output,/Preparing your private database/);assert.ok(encrypted(descriptor));
 await assert.rejects(stat(path.join(dir,'postgresql','data','postmaster.pid')),{code:'ENOENT'});
 await assert.rejects(stat(path.join(root,'.observanda','postgresql','data','postmaster.pid')),{code:'ENOENT'});
 const validated=await cli(['validate',...options],password,env);assert.equal(validated.code,0,validated.output);
 assert.match(validated.output,/Workspace valid/);assert.doesNotMatch(validated.output,/Preparing your private database/);
 assert.deepEqual(await readFile(path.join(root,'workspace.observanda')),descriptor);
 assert.equal(validated.output.includes(password),false);
 await assert.rejects(stat(path.join(dir,'postgresql','data','postmaster.pid')),{code:'ENOENT'});
 const misplaced=await cli(['validate','--workspace',root,'--preferences',path.join(root,'.observanda','internal','preferences.json'),'--password-stdin'],password,env);
 assert.notEqual(misplaced.code,0);assert.match(misplaced.output,/DATABASE_LOCATION/);
 await assert.rejects(stat(path.join(root,'.observanda','internal')),{code:'ENOENT'});
 assert.deepEqual(await readFile(path.join(root,'workspace.observanda')),descriptor);
});
