import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,lstat} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {promisify} from 'node:util';
import {preparePdfValidationRuntime} from '../scripts/pdf-validation-runtime.js';
import {pdfJavaArtifacts,pdfJavaSources,pdfValidatorArtifact,pdfValidatorLicense} from '../src/pdf-validation-dependencies.js';
import {resolvePdfValidationRuntime,applyPdfArchival} from '../src/pdf-archival.js';
import {applyPdfPressGeometry} from '../src/pdf-press-geometry.js';
import {applyPdfAccessibilityOutput,validatePdfAccessibilityOutput} from '../src/pdf-accessibility-output.js';
import {pdfAccessibilityLayout} from '../src/pdf-accessibility-layout.js';
import {pdfLayoutPreset} from '../src/web/pdf-layout-model.js';
import {validPdfArchivalReceipt} from '../src/web/pdf-archival-model.js';
const cache=process.env.OBSERVANDA_TEST_PDF_VALIDATION_CACHE,input=process.env.OBSERVANDA_TEST_PDF_VALIDATION_INPUT,hash=bytes=>createHash('sha256').update(bytes).digest('hex');

// Opt-in platform qualification uses a synthetic tagged Chromium input and
// previously downloaded pinned artifacts. This test never downloads or installs.
test('platform packaging runs offline PDF workers and the pinned validator with exact receipts and cancellation cleanup',{skip:!cache||!input,timeout:180000},async t=>{
 const parent=path.resolve(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-pdf-platform-')),execute=promisify(childProcess.execFile),artifact=pdfJavaArtifacts[process.platform+'-'+process.arch];assert.ok(artifact);
 try{
  const expected=new Map([artifact,pdfValidatorArtifact,pdfValidatorLicense].map(row=>[row.name,row])),prepared=await preparePdfValidationRuntime({out:directory,cache:path.join(directory,'scratch'),download:async(name,url,sha256)=>{assert.equal(expected.get(name)?.url,url);assert.equal(expected.get(name)?.sha256,sha256);return path.join(cache,name);},run:async(command,args)=>{await execute(command,args,{windowsHide:true,timeout:90000,maxBuffer:1024*1024});}}),runtime=await resolvePdfValidationRuntime({directory:prepared.directory});
  const sources=JSON.parse(await readFile(path.join(prepared.directory,'SOURCES.json'),'utf8'));assert.equal(sources.validator.license,'MPL-2.0');assert.ok(sources.validator.components.length>0);assert.ok((await lstat(path.join(prepared.directory,'licenses','META-INF','LICENSE.txt'))).isFile());
  assert.equal(sources.java.version,artifact.version);assert.equal(sources.java.source,pdfJavaSources[artifact.version]);
  const version=await execute(runtime.java,['-version'],{windowsHide:true,timeout:30000,maxBuffer:65536});assert.ok(version.stderr.includes('(build '+artifact.version));
  const manifestFile=path.join(prepared.directory,'runtime.json'),manifest=await readFile(manifestFile,'utf8');
  await writeFile(manifestFile,JSON.stringify({...JSON.parse(manifest),javaVersion:'0.0.0'}));await assert.rejects(resolvePdfValidationRuntime({directory:prepared.directory}),{code:'PDF_ARCHIVAL_UNAVAILABLE'});await writeFile(manifestFile,manifest);
  const original=await readFile(input);assert.equal(original.subarray(0,5).toString(),'%PDF-');
  const press=await applyPdfPressGeometry(original,{version:1,bleedMm:3,cropMarks:true}),archival=await applyPdfArchival(press,{runtime});assert.ok(press.subarray(0,original.length).equals(original));assert.ok(archival.bytes.subarray(0,press.length).equals(press));assert.equal(validPdfArchivalReceipt(archival.validation),true);assert.equal(archival.validation.sha256,hash(archival.bytes));assert.equal(archival.validation.validatorSha256,pdfValidatorArtifact.sha256);
  const accessible=await applyPdfAccessibilityOutput(original,{identifyPdfUa:true,accessibilityLayout:pdfAccessibilityLayout([{value:pdfLayoutPreset(),sectionTitle:'Observed values'}])}),report=await validatePdfAccessibilityOutput(accessible,{runtime});assert.ok(accessible.subarray(0,original.length).equals(original));assert.equal(report.compliant,true);assert.equal(report.automatedOnly,true);assert.equal(report.sha256,hash(accessible));assert.equal(report.validatorSha256,pdfValidatorArtifact.sha256);
  const controller=new AbortController(),spawn=childProcess.spawn;let spawned=false,closed=false,temporary;
  childProcess.spawn=function(file,args,options){const child=spawn.call(this,file,args,options);if(args.includes('--flavour')){spawned=true;temporary=path.dirname(args.at(-1));child.once('close',()=>{closed=true;});child.once('spawn',()=>controller.abort(new Error('Stop platform validator')));}return child;};syncBuiltinESMExports();
  try{await assert.rejects(applyPdfArchival(original,{runtime,signal:controller.signal}),/Stop platform validator/);}finally{childProcess.spawn=spawn;syncBuiltinESMExports();}
  assert.equal(spawned,true);assert.equal(closed,true);await assert.rejects(lstat(temporary),{code:'ENOENT'});
  t.diagnostic(JSON.stringify({platform:process.platform,arch:process.arch,node:process.versions.node,runtimeFiles:prepared.files,archivalRules:archival.validation.passedRules,archivalChecks:archival.validation.passedChecks,accessibilityRules:report.passedRules,accessibilityChecks:report.passedChecks,cancellationClosed:true}));
 }finally{assert.equal(path.dirname(directory),parent);assert.ok(path.basename(directory).startsWith('observanda-pdf-platform-'));await rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});
