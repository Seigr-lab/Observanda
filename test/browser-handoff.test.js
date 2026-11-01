import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,stat,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {browserHandoff,browserLaunchCommand} from '../src/browser-handoff.js';

test('browser launcher arguments contain only a private expiring file, never the session capability',async t=>{
 const parent=path.resolve(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-browser-handoff-'));t.after(async()=>{assert.equal(path.dirname(directory),parent);assert.ok(path.basename(directory).startsWith('observanda-browser-handoff-'));await rm(directory,{recursive:true,force:true});});
 const token='a'.repeat(64),url='http://127.0.0.1:4173/#'+token,handoff=await browserHandoff(url,path.join(directory,'preferences'));
 t.after(()=>handoff.close());const file=fileURLToPath(handoff.url),html=await readFile(file,'utf8');assert.match(html,/location.replace/);assert.ok(html.includes(url));assert.match(html,/content="no-referrer"/);assert.match(html,/script-src 'sha256-/);
 for(const platform of ['win32','darwin','linux']){const command=browserLaunchCommand(handoff.url,platform);assert.ok(command.args.includes(handoff.url));assert.equal(JSON.stringify(command).includes(token),false);assert.throws(()=>browserLaunchCommand(url,platform),{code:'INVALID'});}
 if(process.platform!=='win32'){assert.equal((await stat(file)).mode&0o777,0o600);assert.equal((await stat(path.dirname(file))).mode&0o777,0o700);}
 await handoff.close();await handoff.close();await assert.rejects(stat(file),{code:'ENOENT'});
 const expires=await browserHandoff(url,path.join(directory,'preferences'),{lifetime:15});t.after(()=>expires.close());await new Promise(resolve=>setTimeout(resolve,100));await assert.rejects(stat(fileURLToPath(expires.url)),{code:'ENOENT'});
});
