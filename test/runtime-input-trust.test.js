import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,rmdir,symlink,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {sealPreparedRuntime,assertRuntimeAdmission,admitMatchingRuntime,copyAdmittedRuntime,runtimeTree} from '../scripts/runtime-input-trust.js';
import {runtimeProbeEnvironment} from '../scripts/runtime-probe-environment.js';
import {prepareMediaRuntime} from '../scripts/media-runtime.js';
import {prepareGithubRuntime,verifyLinuxRuntime} from '../scripts/github-runtime.js';

const put=async(root,name,bytes)=>{const file=path.join(root,name);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,bytes);return file;};
async function fixture(t){const root=await mkdtemp(path.join(os.tmpdir(),'observanda-runtime-trust-'));t.after(()=>rm(root,{recursive:true,force:true}));return root;}

test('runtime admission binds the complete copied tree and rejects subsequent library changes',async t=>{
 const root=await fixture(t),source=path.join(root,'source'),destination=path.join(root,'destination');
 await put(source,'bin/program','Synthetic program');await put(source,'lib/helper','Synthetic library');await mkdir(path.join(source,'empty'));
 const admission=await sealPreparedRuntime(source);
 const copied=await copyAdmittedRuntime(source,destination,admission);await assertRuntimeAdmission(destination,copied);
 await assert.rejects(assertRuntimeAdmission(source,copied),/pre-execution admission/);
 await put(destination,'lib/helper','Changed library');await assert.rejects(assertRuntimeAdmission(destination,copied),/changed after admission/);
 await put(source,'bin/program','Changed program');await assert.rejects(copyAdmittedRuntime(source,path.join(root,'second'),admission),/changed after admission/);
 await assert.rejects(stat(path.join(root,'second')),{code:'ENOENT'});
});

test('matching runtime inputs reject extra files, empty directories and changed content',async t=>{
 const root=await fixture(t),reference=path.join(root,'reference'),source=path.join(root,'source');
 await put(reference,'bin/program','Reviewed executable');await put(source,'bin/program','Reviewed executable');
 const admission=await sealPreparedRuntime(reference);await admitMatchingRuntime(source,reference,admission);
 await put(source,'bin/injected.dll','Unreviewed loader input');await assert.rejects(admitMatchingRuntime(source,reference,admission),/pinned upstream/);await rm(path.join(source,'bin/injected.dll'));
 await mkdir(path.join(source,'extra'));await assert.rejects(admitMatchingRuntime(source,reference,admission),/pinned upstream/);await rmdir(path.join(source,'extra'));
 await put(source,'bin/program','Unreviewed executable');await assert.rejects(admitMatchingRuntime(source,reference,admission),/pinned upstream/);
});

test('runtime admission refuses external directory links',async t=>{
 const root=await fixture(t),source=path.join(root,'source'),external=path.join(root,'external');await mkdir(source);await mkdir(external);
 await symlink(external,path.join(source,'outside'),process.platform==='win32'?'junction':'dir');
 await assert.rejects(runtimeTree(source),/Unsafe native runtime link/);
});

test('unreviewed Git input and unadmitted ELF probes cannot invoke subprocesses',async t=>{
 const root=await fixture(t),git=path.join(root,'git');await put(git,'bin/git','Unreviewed executable');
 const forbidden=()=>assert.fail('Untrusted input must not reach a native program');
 await assert.rejects(prepareGithubRuntime({out:path.join(root,'out'),gitRuntime:git,platform:'linux',arch:'x64',download:forbidden,run:forbidden,verifyGit:forbidden}),/No reviewed git runtime/);
 await assert.rejects(verifyLinuxRuntime(git,{execute:forbidden}),/pre-execution admission/);
});

test('native probe environment excludes developer secrets, loaders and global configuration',()=>{
 const env=runtimeProbeEnvironment('synthetic-scratch',{platform:'linux',environment:{PATH:'untrusted-search-path',HOME:'private-home',SSH_AUTH_SOCK:'secret-agent',GITHUB_TOKEN:'secret-token',AWS_SECRET_ACCESS_KEY:'secret-key',LD_PRELOAD:'injected-library',NODE_OPTIONS:'--require injected',JAVA_TOOL_OPTIONS:'injected',GIT_CONFIG_GLOBAL:'private-config'}});
 assert.equal(env.PATH,'/usr/bin:/bin');assert.equal(env.HOME,'synthetic-scratch');assert.equal(env.GIT_CONFIG_GLOBAL,'/dev/null');assert.equal(env.NODE_OPTIONS,'');
 for(const key of ['SSH_AUTH_SOCK','GITHUB_TOKEN','AWS_SECRET_ACCESS_KEY','LD_PRELOAD'])assert.equal(env[key],undefined);
 assert.doesNotMatch(JSON.stringify(env),/secret|private|injected|untrusted/);
});

async function mediaFixture(t){
 const root=await fixture(t),cache=path.join(root,'cache'),out=path.join(root,'out');await mkdir(cache);await mkdir(out);
 const bytes=Buffer.from('Synthetic authenticated archive'),archive=await put(cache,'media.7z',bytes),release={name:'media.7z',root:'reviewed-media',url:'https://upstream.invalid/media.7z',sha256:createHash('sha256').update(bytes).digest('hex')};
 const content={'bin/ffmpeg.exe':'Synthetic encoder','bin/ffprobe.exe':'Synthetic probe','LICENSE':'Synthetic license'},calls=[];
 const execute=async(file,args,options)=>{
  calls.push({file,args,options});assert.equal(path.win32.basename(file),'tar.exe');assert.notEqual(options.cwd,out);
  if(args[0]==='-tf')return {stdout:Object.keys(content).map(name=>release.root+'/'+name).join('\n')};
  assert.equal(args[0],'-xf');for(const [name,value] of Object.entries(content))await put(path.join(args[3],release.root),name,value);return {stdout:''};
 };
 return {root,archive,content,calls,options:{out,cache,platform:'win32',arch:'x64',release,execute,download:async()=>archive}};
}

test('media preparation checks the upstream archive before extraction and copies only admitted bytes',async t=>{
 const f=await mediaFixture(t),admission=await prepareMediaRuntime(f.options),destination=path.join(f.options.out,'media');
 await assertRuntimeAdmission(destination,admission);assert.equal(f.calls.length,2);assert.equal(await readFile(path.join(destination,'bin/ffmpeg.exe'),'utf8'),f.content['bin/ffmpeg.exe']);
 for(const call of f.calls)await assert.rejects(stat(call.options.cwd),{code:'ENOENT'});
 await writeFile(f.archive,'Tampered archive');f.calls.length=0;
 await assert.rejects(prepareMediaRuntime(f.options),/archive checksum mismatch/);assert.equal(f.calls.length,0);
});

test('supplied media must match the independently authenticated reference, including loader inputs',async t=>{
 const f=await mediaFixture(t),media=path.join(f.root,'supplied');
 for(const [name,value] of Object.entries(f.content))await put(media,name,value);
 await put(media,'bin/unreviewed.dll','Unreviewed library');
 await assert.rejects(prepareMediaRuntime({...f.options,media}),/pinned upstream archive/);
 await assert.rejects(stat(path.join(f.options.out,'media')),{code:'ENOENT'});
 await rm(path.join(media,'bin/unreviewed.dll'));
 const admission=await prepareMediaRuntime({...f.options,media});await assertRuntimeAdmission(path.join(f.options.out,'media'),admission);
});
