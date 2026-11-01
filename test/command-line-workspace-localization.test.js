import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import {defaultPreferences} from '../src/preferences.js';
import {commandLineLocalization} from '../src/command-line-localization.js';
import {readAccess,verifyAccess} from '../src/access.js';
import {clearVault} from '../src/encryption.js';
import {Workspace} from '../src/storage.js';

function cli(args,password){return new Promise((resolve,reject)=>{
 const child=spawn(process.execPath,['src/cli.js',...args],{windowsHide:true,stdio:['pipe','pipe','pipe']}),timer=setTimeout(()=>{child.kill();reject(Error('Workspace CLI localization timed out'));},60000);let stdout='',stderr='';
 child.stdout.on('data',value=>stdout+=value);child.stderr.on('data',value=>stderr+=value);child.on('error',reject);child.on('close',code=>{clearTimeout(timer);resolve({code,stdout,stderr});});child.stdin.end(password+'\n');
});}
test('CLI creation and validation localize human reports while keeping workspace content and preferences unchanged',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-cli-workspace-language-')),root=path.join(directory,'Authored workspace'),preferences=path.join(directory,'preferences.json'),password='synthetic localization passphrase',args=['--workspace',root,'--preferences',preferences,'--password-stdin'];let vault;
 try{
  await writeFile(preferences,JSON.stringify({...defaultPreferences(),language:'es'}));const created=await cli(['init',...args],password);assert.equal(created.code,0,created.stderr);assert.ok(created.stdout.includes(commandLineLocalization(preferences).text('created')));assert.ok(!created.stdout.includes(password));
  const access=await readAccess(root);vault=await verifyAccess(access,access.value.username,password);const outline=await new Workspace(root,vault).outline();assert.equal(outline.metadata.title,'Authored workspace');const original=await readFile(path.join(root,'workspace.observanda'));
  for(const language of ['en','ca','es','nb','nn']){
   const value=JSON.stringify({...defaultPreferences(),language});await writeFile(preferences,value);const localization=commandLineLocalization(preferences),checked=await cli(['validate',...args],password);
   assert.equal(checked.code,0,checked.stderr);assert.ok(checked.stdout.includes(localization.text('validated',{entries:outline.recordCount,revision:outline.metadata.revision})));assert.ok(checked.stderr.includes(localization.translate('storageProgress','verify-copy')));assert.ok(!checked.stderr.includes(password));assert.equal(await readFile(preferences,'utf8'),value);assert.deepEqual(await readFile(path.join(root,'workspace.observanda')),original);
  }
 }finally{await clearVault(vault);await rm(directory,{recursive:true,force:true,maxRetries:3});}
});
