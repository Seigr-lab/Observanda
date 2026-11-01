import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {mkdtemp,mkdir,readFile,writeFile,rename,rm} from 'node:fs/promises';
import {setTimeout as pause} from 'node:timers/promises';
import {createServer} from 'node:net';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {acquireWindowsPostgresRuntimeGuard} from '../src/windows-postgres-runtime-guard.js';
import {postgresRuntimeFiles} from '../src/postgres-runtime-files.js';

const options={skip:process.platform!=='win32',timeout:90000};
async function fixture(t){
 const base=path.resolve(os.tmpdir()),root=await mkdtemp(path.join(base,'observanda-runtime-guard-')),guards=[];
 t.after(async()=>{for(const guard of guards)await guard.close().catch(()=>{});assert.equal(path.dirname(root),base);assert.ok(path.basename(root).startsWith('observanda-runtime-guard-'));await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const acquire=async directory=>{const guard=await acquireWindowsPostgresRuntimeGuard({directory});guards.push(guard);return guard;};return {root,acquire};
}
async function eventually(check){const until=Date.now()+15000;while(!await check()){if(Date.now()>until)assert.fail('Guarded process did not exit');await pause(25);}}
async function port(){const server=createServer();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const value=server.address().port;await new Promise(resolve=>server.close(resolve));return value;}

test('guarded private runtime pins its ancestors while allowing atomic child publication',options,async t=>{
 const f=await fixture(t),parent=path.join(f.root,'selected');await mkdir(parent);const directory=path.join(parent,'runtime'),guard=await f.acquire(directory),files=postgresRuntimeFiles(guard);
 await files.write(path.join(directory,'state'),'first');await files.write(path.join(directory,'state'),'second');assert.equal(await files.read(path.join(directory,'state'),{encoding:'utf8'}),'second');
 await guard.run(process.execPath,['--input-type=module','-e','import {mkdirSync,writeFileSync} from "node:fs";mkdirSync(process.argv[1]);writeFileSync(process.argv[1]+"/file","data");',path.join(directory,'stage')]);
 await files.rename(path.join(directory,'stage'),path.join(directory,'data'));await files.removeTree(path.join(directory,'data'));
 await assert.rejects(rename(directory,path.join(parent,'moved')));await assert.rejects(rename(parent,path.join(f.root,'exchanged')));
 await assert.rejects(writeFile(path.join(directory,'owner.lock'),'replacement'));
 assert.match(await guard.run(process.execPath,['--version'],{capture:true}),/^v[0-9]+\./);
 await guard.close();await rename(parent,path.join(f.root,'exchanged'));
});

test('guard helper failure rejects every subsequent filesystem mutation',options,async t=>{
 const f=await fixture(t),directory=path.join(f.root,'runtime'),guard=await f.acquire(directory),files=postgresRuntimeFiles(guard);await files.write(path.join(directory,'state'),'original');
 process.kill(guard.processId,'SIGKILL');await guard.close().catch(error=>{assert.equal(error.code,'DATABASE_GUARD_UNAVAILABLE');});await rename(directory,path.join(f.root,'retained'));await mkdir(directory);await writeFile(path.join(directory,'state'),'replacement');
 for(const operation of [()=>files.write(path.join(directory,'state'),'changed'),()=>files.unlink(path.join(directory,'state')),()=>files.removeTree(directory),()=>files.rename(path.join(directory,'state'),path.join(directory,'moved'))])await assert.rejects(async()=>operation());
 assert.equal(await readFile(path.join(directory,'state'),'utf8'),'replacement');assert.equal(await readFile(path.join(f.root,'retained','state'),'utf8'),'original');
});

test('native private admission denies writes from a restricted Windows token',options,async t=>{
 const f=await fixture(t),directory=path.join(f.root,'runtime');await f.acquire(directory);
 const {stdout}=await promisify(execFile)(path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoLogo','-NoProfile','-NonInteractive','-File',fileURLToPath(new URL('./fixtures/runtime-guard-restricted-token.ps1',import.meta.url)),'-Container',f.root,'-Runtime',directory],{windowsHide:true,timeout:30000});
 assert.match(stdout,/control allowed; guarded mutations denied/);assert.equal(await readFile(path.join(f.root,'control'),'utf8'),'allowed');
});

test('native runtime pin prevents in-place junction conversion',options,async t=>{
 const f=await fixture(t),directory=path.join(f.root,'runtime'),outside=path.join(f.root,'outside'),control=path.join(f.root,'control');await mkdir(outside);await mkdir(control);await writeFile(path.join(outside,'retained'),'unchanged');await f.acquire(directory);
 const {stdout}=await promisify(execFile)(path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoLogo','-NoProfile','-NonInteractive','-File',fileURLToPath(new URL('./fixtures/runtime-guard-junction.ps1',import.meta.url)),'-Runtime',directory,'-Outside',outside,'-Control',control],{windowsHide:true,timeout:30000});
 assert.match(stdout,/control=0/);assert.match(stdout,/guarded=145/);assert.equal(await readFile(path.join(outside,'retained'),'utf8'),'unchanged');
});

test('nonempty untrusted runtime is preserved and cannot be admitted by tightening its ACL',options,async t=>{
 const f=await fixture(t),directory=path.join(f.root,'runtime');await mkdir(directory);await writeFile(path.join(directory,'retained'),'retained');
 // Temporary-directory permissions on some hosts are already private. Only
 // assert rejection when read-only classification establishes the prerequisite.
 const {inspectWindowsPostgresRuntimeStorage}=await import('../src/windows-postgres-runtime-guard.js');const before=await inspectWindowsPostgresRuntimeStorage(directory);
 if(before.rootPermissions==='admissible'){t.skip('Host temporary directory already has private access controls');return;}
 await assert.rejects(f.acquire(directory),{code:'DATABASE_GUARD_STORAGE',reason:'nonprivate-runtime-requires-migration'});assert.equal(await readFile(path.join(directory,'retained'),'utf8'),'retained');
});

test('native job ownership stops actual PostgreSQL descendants when the guard helper dies',{...options,skip:process.platform!=='win32'||!process.env.OBSERVANDA_TEST_POSTGRES_BIN},async t=>{
 const f=await fixture(t),directory=path.join(f.root,'runtime'),guard=await f.acquire(directory),bin=process.env.OBSERVANDA_TEST_POSTGRES_BIN,data=path.join(directory,'data'),number=await port();
 await guard.run(path.join(bin,'initdb.exe'),['-D',data,'-U','guard_test','--auth=trust','--encoding=UTF8','--no-locale']);
 await guard.run(path.join(bin,'pg_ctl.exe'),['-D',data,'-l',path.join(directory,'postgresql.log'),'-o','-h 127.0.0.1 -p '+number+' -c shared_buffers=16MB -c max_connections=10','-w','-t','30','start']);
 const pid=Number((await readFile(path.join(data,'postmaster.pid'),'utf8')).split('\n')[0]);assert.ok(pid>0);await assert.rejects(rename(directory,path.join(f.root,'moved')));
 process.kill(guard.processId,'SIGKILL');await guard.close().catch(error=>{assert.equal(error.code,'DATABASE_GUARD_UNAVAILABLE');});await eventually(()=>{try{process.kill(pid,0);return false;}catch(error){if(error.code==='ESRCH')return true;throw error;}});
 await rename(directory,path.join(f.root,'moved'));assert.match((await readFile(path.join(f.root,'moved','data','PG_VERSION'),'utf8')).trim(),/^(16|17|18)$/);
});
