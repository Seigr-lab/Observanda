import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const require=createRequire(new URL('../node_modules/app-builder-lib/package.json',import.meta.url));
test('the Electron packaging downloader works through its overridden proxy agent and directly',async t=>{
 const get=require('@electron/get'),local=createRequire(require.resolve('@electron/get'));
 const {GotDownloader}=local('./GotDownloader.js');
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-build-download-')),seen=[];
 const server=createServer((req,res)=>{seen.push(req.url);res.end('Synthetic runtime download');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});});
 const old={...process.env};process.env.GLOBAL_AGENT_HTTP_PROXY='http://127.0.0.1:'+server.address().port;process.env.GLOBAL_AGENT_HTTPS_PROXY=process.env.GLOBAL_AGENT_HTTP_PROXY;delete process.env.GLOBAL_AGENT_NO_PROXY;
 get.initializeProxy();
 try{
  assert.equal(typeof global.GLOBAL_AGENT,'object');
  await new GotDownloader().download('http://synthetic.invalid/runtime.zip',path.join(directory,'proxied'),{quiet:true,retry:0});
  assert.equal(seen[0],'http://synthetic.invalid/runtime.zip');assert.equal(await readFile(path.join(directory,'proxied'),'utf8'),'Synthetic runtime download');
  global.GLOBAL_AGENT.NO_PROXY='127.0.0.1';await new GotDownloader().download('http://127.0.0.1:'+server.address().port+'/direct.zip',path.join(directory,'direct'),{quiet:true,retry:0});
  assert.equal(seen[1],'/direct.zip');assert.equal(await readFile(path.join(directory,'direct'),'utf8'),'Synthetic runtime download');
 }finally{global.GLOBAL_AGENT.HTTP_PROXY=null;global.GLOBAL_AGENT.HTTPS_PROXY=null;for(const name of ['GLOBAL_AGENT_HTTP_PROXY','GLOBAL_AGENT_HTTPS_PROXY','GLOBAL_AGENT_NO_PROXY']){if(old[name]===undefined)delete process.env[name];else process.env[name]=old[name];}}
});
