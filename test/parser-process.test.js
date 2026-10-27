import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,lstat} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {parserEnvironment,parserExecutable,parserProcess} from '../src/parser-process.js';
const run=promisify(execFile);

test('parser environment excludes credentials, proxies and loader options while isolating home and temporary paths',()=>{
 const directory=path.resolve('synthetic-parser'),env={PATH:'untrusted',OBSERVANDA_DATABASE_URL:'private-sentinel',GITHUB_TOKEN:'private-sentinel',NODE_OPTIONS:'--import=private-sentinel',HTTP_PROXY:'private-sentinel',LD_PRELOAD:'private-sentinel',FFREPORT:'private-sentinel',SystemRoot:process.env.SystemRoot};
 const value=parserEnvironment(process.execPath,directory,{env});assert.doesNotMatch(JSON.stringify(value),/private-sentinel|untrusted/);assert.equal(value.PATH,path.dirname(process.execPath));for(const field of ['HOME','USERPROFILE','TMP','TEMP','TMPDIR'])assert.equal(value[field],directory);
});
test('executable discovery ignores current and relative directories and never invokes a command shell',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-parser-path-'));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(path.join(root,'bin'));
 const name=process.platform==='win32'?'ffprobe.exe':'ffprobe',file=path.join(root,'bin',name);await writeFile(file,'synthetic executable',{mode:0o700});
 await assert.rejects(parserExecutable('ffprobe',{env:{PATH:['','relative'].join(path.delimiter)}}),{code:'MEDIA_TOOL'});
 assert.equal(await parserExecutable('ffprobe',{env:{PATH:['','relative',path.join(root,'bin')].join(path.delimiter)}}),file);
 for(const command of ['ffprobe && echo unsafe','./ffprobe','ffprobe.cmd'])await assert.rejects(parserExecutable(command),{code:'MEDIA_TOOL'});
});
test('a launched parser receives only its private working environment and cleanup removes that directory',async()=>{
 const previous=process.env.OBSERVANDA_PARSER_SECRET_SENTINEL;process.env.OBSERVANDA_PARSER_SECRET_SENTINEL='must-not-inherit';let parser;
 try{
  parser=await parserProcess(process.execPath);const {stdout}=await run(parser.executable,['-e','process.stdout.write(JSON.stringify({secret:process.env.OBSERVANDA_PARSER_SECRET_SENTINEL??null,cwd:process.cwd(),home:process.env.HOME,temp:process.env.TMPDIR}))'],{cwd:parser.cwd,env:parser.env,windowsHide:true});
  const value=JSON.parse(stdout);assert.equal(value.secret,null);assert.equal(value.cwd,parser.cwd);assert.equal(value.home,parser.cwd);assert.equal(value.temp,parser.cwd);
 }finally{if(previous===undefined)delete process.env.OBSERVANDA_PARSER_SECRET_SENTINEL;else process.env.OBSERVANDA_PARSER_SECRET_SENTINEL=previous;await parser?.close();}
 await assert.rejects(lstat(parser.cwd),{code:'ENOENT'});await parser.close();
});
