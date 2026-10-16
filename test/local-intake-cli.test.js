import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {intakeFixture} from './fixtures/local-intake.js';
import {createAccess,takeCreatedVault} from '../src/access.js';
import {initializeLocation} from '../src/locations.js';
import {clearVault} from '../src/encryption.js';
import {startServer} from '../src/server.js';
const cli=(args,password)=>new Promise((resolve,reject)=>{
 const processChild=spawn(process.execPath,['src/cli.js','intake',...args],{windowsHide:true,stdio:['pipe','pipe','pipe']}),timer=setTimeout(()=>{processChild.kill();reject(Error('Intake CLI timed out'));},60000);let stdout='',stderr='';
 processChild.stdout.on('data',b=>stdout+=b);processChild.stderr.on('data',b=>stderr+=b);processChild.once('error',reject);processChild.once('close',code=>{clearTimeout(timer);resolve({code,stdout,stderr});});processChild.stdin.end(password+'\n');
});
test('real local CLI emits parseable versioned receipts and replay never duplicates material',async t=>{
 const f=await intakeFixture(t),password='Synthetic CLI intake password',access=await createAccess('',password),vault=takeCreatedVault(access),root=path.join(f.directory,'cli-workspace');
 t.after(()=>clearVault(vault));await initializeLocation(root,(await f.ws.read()).book,access,vault);
 const base=['--workspace',root,'--workspace-id',f.book.id,'--record-id',f.record.id,'--password-stdin','--preferences',path.join(f.directory,'cli-preferences.json')];
 const preview=await cli([...base,'--action','preview','--source',f.source],password);assert.equal(preview.code,0,preview.stdout+preview.stderr);const pin=JSON.parse(preview.stdout).result.pin;
 const parameters=[...base,'--id',f.manifest.id,'--pin',pin];
 const stage=await cli([...parameters,'--action','stage','--source',f.source,'--wait'],password);assert.equal(stage.code,0,stage.stdout+stage.stderr);assert.equal(JSON.parse(stage.stdout).result.state,'prepared');
 const apply=await cli([...parameters,'--action','apply','--wait'],password);assert.equal(apply.code,0,apply.stdout+apply.stderr);const applied=JSON.parse(apply.stdout).result;assert.equal(applied.state,'completed',apply.stdout);const receipt=applied.receipt;assert.equal(receipt.files.length,1);
 const replay=await cli([...parameters,'--action','apply','--wait'],password);assert.deepEqual(JSON.parse(replay.stdout).result.receipt,receipt);
 const denied=await cli([...base,'--action','status','--id',f.manifest.id],'wrong password');assert.equal(denied.code,1);assert.equal(JSON.parse(denied.stdout).error.code,'ACCESS_DENIED');assert.ok(![preview,stage,apply,replay,denied].some(v=>(v.stdout+v.stderr).includes(password)));
});
test('versioned HTTP intake retains local session, origin, workspace and revision boundaries',async t=>{
 const f=await intakeFixture(t),app=await startServer({root:f.ws.root,port:0,deviceStore:f.deviceStore,preferencesFile:path.join(f.directory,'preferences.json')});t.after(()=>app.close());
 const endpoint=app.origin+'/api/v1/intake/preview',payload={version:1,...f.command};
 assert.equal((await fetch(endpoint,{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json'},body:JSON.stringify(payload)})).status,401);
 const auth=await fetch(app.origin+'/api/session',{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json'},body:JSON.stringify({token:app.launchToken})}),cookie=auth.headers.get('set-cookie').split(';')[0];
 const headers={Origin:app.origin,'Content-Type':'application/json',Cookie:cookie},request=(data,origin=app.origin)=>fetch(endpoint,{method:'POST',headers:{...headers,Origin:origin},body:JSON.stringify(data)});
 assert.equal((await request(payload,'https://hostile.invalid')).status,403);
 const metadata=await (await fetch(app.origin+'/api/storage',{headers})).json();if(metadata.contextId)headers['x-observanda-workspace']=metadata.contextId;
 const preview=await request(payload);assert.equal(preview.status,200,await preview.clone().text());assert.equal((await preview.json()).version,1);
 const invalid=await request({...payload,version:99});assert.equal(invalid.status,422);assert.equal((await invalid.json()).code,'INTAKE_INVALID');
 await fetch(app.origin+'/api/access/lock',{method:'POST',headers,body:'{}'});assert.equal((await request(payload)).status,401);
});
