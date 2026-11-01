import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,readdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import {commandLineLocalization} from '../src/command-line-localization.js';
import {validateCatalogue} from '../src/web/i18n/runtime.js';
import {withConsoleProgress} from '../src/operation-progress-console.js';
import {operationStage,operationAdvance} from '../src/operation-progress.js';
import {migrationFixture} from './migration-fixture.js';

const locales=['en','ca','es','nb','nn'];
const catalogue=(locale,name)=>readFile(new URL('../src/web/locales/'+locale+'/'+name+'.json',import.meta.url),'utf8').then(JSON.parse);
const cli=(args)=>new Promise((resolve,reject)=>{
 const child=spawn(process.execPath,['src/cli.js',...args],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,OBSERVANDA_DATABASE_URL:'invalid database must not be used',OBSERVANDA_POSTGRES_BIN:'missing'}}),timer=setTimeout(()=>{child.kill();reject(Error('CLI localization timed out'));},20000);let stdout='',stderr='';
 child.stdout.on('data',value=>stdout+=value);child.stderr.on('data',value=>stderr+=value);child.on('error',reject);child.on('close',code=>{clearTimeout(timer);resolve({code,stdout,stderr});});
});
async function fixture(t){const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-cli-language-'));t.after(()=>rm(directory,{recursive:true,force:true,maxRetries:3}));return {directory,preferences:path.join(directory,'preferences.json')};}

test('CLI help reads the selected preferences language without starting databases or changing settings',async t=>{
 const {directory,preferences}=await fixture(t),reference=await catalogue('en','commandLine');let commandLines;
 for(const locale of locales){
  const messages=await catalogue(locale,'commandLine');assert.deepEqual(Object.keys(messages).sort(),Object.keys(reference).sort());validateCatalogue(messages,reference);
  const original=JSON.stringify({formatVersion:1,language:locale,sentinel:'authored preference'});await writeFile(preferences,original);
  const result=await cli(['--preferences',preferences,'--help']);assert.equal(result.code,0,result.stderr);assert.equal(result.stderr,'');assert.ok(result.stdout.startsWith(messages.heading+'\n'));assert.ok(result.stdout.includes(messages.helpDatabase));assert.ok(result.stdout.includes((await catalogue(locale,'localIntake')).cliHelp));
  const syntax=result.stdout.split('\n').filter(line=>/^  (npm|node) /.test(line));if(commandLines)assert.deepEqual(syntax,commandLines);else commandLines=syntax;
  for(const token of ['--password-stdin','OBSERVANDA_DATABASE_TLS=verify-full','OBSERVANDA_DATABASE_CA','OBSERVANDA_POSTGRES_BIN','apt/dnf/Homebrew'])assert.ok(result.stdout.includes(token),token);
  assert.equal(await readFile(preferences,'utf8'),original);assert.deepEqual(await readdir(directory),['preferences.json']);
  const failed=await cli(['inventory','--preferences',preferences]);assert.equal(failed.code,1);assert.equal(failed.stdout,'');assert.equal(failed.stderr,'INVENTORY_INVALID: '+(await catalogue(locale,'errors')).INVENTORY_INVALID+'\n');
 }
});

test('CLI inventory keeps its JSON contract while its human report follows the saved language',async t=>{
 const {directory,preferences}=await fixture(t),source=path.join(directory,'source');await migrationFixture(source,{creative:true});let reference;
 for(const locale of locales){
  await writeFile(preferences,JSON.stringify({formatVersion:1,language:locale}));
  const json=await cli(['inventory','--source',source,'--preferences',preferences,'--json']);assert.equal(json.code,0,json.stderr);const report=JSON.parse(json.stdout);assert.equal(report.complete,true);
  // Capture time and duration are measured on each invocation; the contract and source
  // data, including English machine diagnostics, are otherwise unchanged.
  assert.ok(Number.isFinite(Date.parse(report.capturedAt)));const stable=structuredClone(report);delete stable.inspection;delete stable.capturedAt;if(reference)assert.deepEqual(stable,reference);else reference=stable;
  const human=await cli(['inventory','--source',source,'--preferences',preferences]);assert.equal(human.code,0,human.stderr);assert.equal(human.stdout,commandLineLocalization(preferences).inventory(report)+'\n');assert.equal(human.stderr,'');
 }
});

test('CLI translators stay immutable and tolerate unavailable or malformed display preferences',async t=>{
 const {preferences}=await fixture(t);assert.equal(commandLineLocalization(preferences).language,'en');
 await writeFile(preferences,JSON.stringify({formatVersion:1,language:'ca'}));const captured=commandLineLocalization(preferences),expected=captured.text('created');
 await writeFile(preferences,JSON.stringify({formatVersion:1,language:'es'}));assert.equal(captured.text('created'),expected);assert.equal(commandLineLocalization(preferences).language,'es');
 for(const original of ['{',JSON.stringify({formatVersion:1,language:'../es'}),JSON.stringify({formatVersion:2,language:'ca'}),' '.repeat(1048577)]){await writeFile(preferences,original);assert.equal(commandLineLocalization(preferences).language,'en');assert.equal(await readFile(preferences,'utf8'),original);}
});

test('console progress uses the captured language without changing measured counts or byte units',async t=>{
 const {preferences}=await fixture(t);
 for(const locale of locales){
  await writeFile(preferences,JSON.stringify({formatVersion:1,language:locale}));const localization=commandLineLocalization(preferences),lines=[];
  await withConsoleProgress(()=>operationStage('verify-history',{total:10,unit:'bytes'},async()=>operationAdvance(3)),{translate:localization.translate,write:line=>lines.push(line)});
  const progress=await catalogue(locale,'operationProgress'),storage=await catalogue(locale,'storageProgress');
  assert.ok(lines.at(-1).startsWith(storage['verify-history']+': '));assert.ok(lines.at(-1).includes(progress.countTotal.replace('{count}','3').replace('{total}','10').replace('{unit}',progress.bytes)));
 }
});
