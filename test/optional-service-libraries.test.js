import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {X509Certificate,createPrivateKey} from 'node:crypto';
import {liveCertificate} from '../src/collaboration/live-certificate.js';

test('ordinary service import leaves optional publication and certificate libraries unloaded',async()=>{
 const {stdout}=await promisify(execFile)(process.execPath,['--input-type=module','-e',`
  import assert from 'node:assert/strict';
  import {registerHooks} from 'node:module';
  const loaded=[];
  const hooks=registerHooks({load(url,context,next){loaded.push(url);return next(url,context);}});
  await import('./src/server.js');
  hooks.deregister();
  for(const name of ['fontkit','qrcode','katex','reflect-metadata','@peculiar/x509']){
   assert.equal(loaded.some(url=>url.includes('/node_modules/'+name+'/')),false,name+' loaded before use');
  }
  console.log('passed');
 `],{cwd:process.cwd(),windowsHide:true,timeout:120000});
 assert.equal(stdout.trim(),'passed');
});

test('first collaboration certificate creation and reuse preserve the pinned key pair',async()=>{
 let saved,writes=0;
 const workspace={withLock:operation=>operation(),readMetadata:async()=>saved,writeMetadata:async(file,value)=>{saved=value;writes++;}};
 const first=await liveCertificate(workspace),certificate=new X509Certificate(first.cert);
 assert.equal(certificate.checkPrivateKey(createPrivateKey(first.key)),true);
 assert.equal(certificate.checkHost('observanda.local'),'observanda.local');
 assert.deepEqual(await liveCertificate(workspace),first);
 assert.equal(writes,1);
});
