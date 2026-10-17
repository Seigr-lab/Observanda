import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import os from 'node:os';
import {nativeTestArguments} from '../scripts/test-selection.js';
const exec=promisify(execFile);
async function fixture(t){const root=await mkdtemp(path.join(os.tmpdir(),'observanda-test-selection-'));t.after(async()=>{assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('observanda-test-selection-'));await rm(root,{recursive:true,force:true});});await mkdir(path.join(root,'test'));await writeFile(path.join(root,'test','present.test.js'),'');return {cwd:root};}

test('an existing test cannot hide another missing file or unmatched pattern',async t=>{
 const options=await fixture(t);
 for(const missing of ['test/missing.test.js','test/absent-*.test.js'])await assert.rejects(nativeTestArguments(['test/present.test.js',missing],options),error=>error.message==='No test files match: '+missing);
 assert.deepEqual(await nativeTestArguments(['test/*.test.js'],options),['test/*.test.js']);
 await mkdir(path.join(options.cwd,'node_modules','dependency'),{recursive:true});await writeFile(path.join(options.cwd,'node_modules','dependency','present.test.js'),'');
 for(const selector of ['node_modules/dependency/present.test.js','node_modules/dependency/*.test.js','test/../node_modules/dependency/present.test.js'])await assert.rejects(nativeTestArguments(['test/present.test.js',selector],options),/No test files match/);
 const named='test/caf\u00e9 sample.test.js';await writeFile(path.join(options.cwd,named),'');
 for(const selector of [named,path.resolve(options.cwd,named),path.join('test','*.test.js')])assert.deepEqual(await nativeTestArguments([selector],options),[selector]);
});
test('test filters retain their values and default discovery stays inside the public suite',async t=>{
 const options=await fixture(t);
 for(const args of [[],['--test-name-pattern','case with spaces'],['--test-shard=1/8'],['--test-reporter','tap','--test-timeout','5000']])assert.deepEqual(await nativeTestArguments(args,options),[...args,'test/*.test.js']);
 const args=['--test-name-pattern','missing.test.js','--test-skip-pattern=ignored','test/present.test.js'];assert.deepEqual(await nativeTestArguments(args,options),args);
 assert.deepEqual(await nativeTestArguments(['--','test/present.test.js'],options),['--','test/present.test.js']);
});
test('missing explicit tests fail before temporary database setup',async()=>{
 const run=await exec(process.execPath,['scripts/test.js','test/module-domain-plan.test.js','test/absent-selection-regression.test.js'],{windowsHide:true,env:{...process.env,OBSERVANDA_TEST_DATABASE_URL:'',OBSERVANDA_TEST_POSTGRES_BIN:'unavailable-test-runtime'}}).then(()=>assert.fail('Missing selection succeeded'),error=>error);
 assert.equal(run.code,1);assert.match(run.stderr,/No test files match: test\/absent-selection-regression\.test\.js/);assert.equal(run.stdout,'');
});
