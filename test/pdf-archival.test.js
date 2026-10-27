import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {validPdfArchivalReceipt,PDF_ARCHIVAL_VALIDATOR_SHA256} from '../src/web/pdf-archival-model.js';
import {pdfArchivalReceipt} from '../src/pdf-archival-validation.js';
import {pdfArchivalAvailable,resolvePdfValidationRuntime,applyPdfArchival} from '../src/pdf-archival.js';
import {pdfValidationFiles} from '../src/pdf-archival-runtime.js';
import {pdfJavaArtifacts,pdfValidatorArtifact,PDF_VALIDATOR_SHA256} from '../src/pdf-validation-dependencies.js';
import {preparePdfValidationRuntime,pdfValidationRuntimeFiles} from '../scripts/pdf-validation-runtime.js';
const sha256='a'.repeat(64),bytes=1234;
const receipt={version:1,profile:'pdfa-2u',sha256,validator:'veraPDF',validatorVersion:'1.30.3',validatorSha256:PDF_ARCHIVAL_VALIDATOR_SHA256,passedRules:146,passedChecks:1000};
function report(){return {report:{buildInformation:{releaseDetails:['core','validation-model','apps'].map(id=>({id,version:'1.30.3'}))},jobs:[{itemDetails:{size:bytes},validationResult:[{details:{passedRules:146,failedRules:0,passedChecks:1000,failedChecks:0,ruleSummaries:[]},jobEndStatus:'normal',profileName:'PDF/A-2u validation profile',compliant:true}]}],batchSummary:{totalJobs:1,multiJob:false,outOfMemory:0,veraExceptions:0,failedParsingJobs:0,failedEncryptedJobs:0,validationSummary:{totalJobCount:1,failedJobCount:0,nonCompliantPdfaCount:0,successfulJobCount:1,compliantPdfaCount:1}}}};}
async function temporary(operation){const parent=path.resolve(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-pdf-archival-test-'));try{return await operation(directory);}finally{if(path.dirname(directory)!==parent||!path.basename(directory).startsWith('observanda-pdf-archival-test-'))throw Error('Unexpected test directory');await rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:100});}}
test('archival receipt is exact, hash-bound and names the independently pinned validator',()=>{
 assert.equal(validPdfArchivalReceipt(receipt),true);assert.equal(PDF_VALIDATOR_SHA256,PDF_ARCHIVAL_VALIDATOR_SHA256);assert.equal(pdfValidatorArtifact.sha256,PDF_VALIDATOR_SHA256);
 for(const value of [null,undefined,{}, {...receipt,profile:'pdfa-2b'},{...receipt,validatorVersion:'1.30.2'},{...receipt,validatorSha256:'b'.repeat(64)},{...receipt,sha256:'bad'},{...receipt,passedRules:0},{...receipt,passedChecks:1.2},{...receipt,report:'raw report'}])assert.equal(validPdfArchivalReceipt(value),false);
 assert.deepEqual(pdfArchivalReceipt(JSON.stringify(report()),{sha256,bytes}),receipt);
});
test('validator admission refuses noncompliance, wrong profile, partial reports and wrong output identity',()=>{
 const changes=[r=>r.report.jobs.push(r.report.jobs[0]),r=>r.report.jobs[0].validationResult.push(r.report.jobs[0].validationResult[0]),r=>r.report.batchSummary.totalJobs=2,r=>r.report.batchSummary.multiJob=true,r=>r.report.batchSummary.failedParsingJobs=1,r=>r.report.batchSummary.outOfMemory=1,r=>r.report.batchSummary.veraExceptions=1,r=>r.report.batchSummary.failedEncryptedJobs=1,r=>r.report.batchSummary.validationSummary.nonCompliantPdfaCount=1,r=>r.report.jobs[0].itemDetails.size++,r=>r.report.jobs[0].validationResult[0].compliant=false,r=>r.report.jobs[0].validationResult[0].profileName='PDF/A-2b validation profile',r=>r.report.jobs[0].validationResult[0].jobEndStatus='aborted',r=>r.report.jobs[0].validationResult[0].details.failedRules=1,r=>r.report.jobs[0].validationResult[0].details.failedChecks=1,r=>r.report.jobs[0].validationResult[0].details.ruleSummaries.push({failed:1}),r=>r.report.buildInformation.releaseDetails[0].version='unknown',r=>r.report.buildInformation.releaseDetails.push({id:'core',version:'1.30.3'})];
 for(const change of changes){const value=report();change(value);assert.throws(()=>pdfArchivalReceipt(JSON.stringify(value),{sha256,bytes}),{code:'PDF_ARCHIVAL_FAILED'});}
 for(const text of ['', '{}', 'x'.repeat(2*1024*1024+1)])assert.throws(()=>pdfArchivalReceipt(text,{sha256,bytes}),{code:'PDF_ARCHIVAL_FAILED'});
 assert.throws(()=>pdfArchivalReceipt(JSON.stringify(report()),{sha256:'wrong',bytes}),{code:'PDF_ARCHIVAL_FAILED'});
});
test('runtime has no PATH fallback and rejects missing, malformed and forged validator payloads',async()=>temporary(async directory=>{
 assert.equal(await pdfArchivalAvailable({directory}),false);await assert.rejects(resolvePdfValidationRuntime({directory}),{code:'PDF_ARCHIVAL_UNAVAILABLE'});
 await writeFile(path.join(directory,'runtime.json'),'{}');assert.equal(await pdfArchivalAvailable({directory}),false);await mkdir(path.join(directory,'java','bin'),{recursive:true});await writeFile(path.join(directory,'java','bin','java'+(process.platform==='win32'?'.exe':'')),'fake');await writeFile(path.join(directory,'verapdf-cli.jar'),'fake');
 const manifest={version:1,platform:process.platform,arch:process.arch,validatorVersion:'1.30.3',validatorSha256:PDF_VALIDATOR_SHA256,javaVersion:pdfJavaArtifacts[process.platform+'-'+process.arch].version,javaArchiveSha256:pdfJavaArtifacts[process.platform+'-'+process.arch].sha256,java:'java/bin/java'+(process.platform==='win32'?'.exe':''),jar:'verapdf-cli.jar',files:await pdfValidationFiles(directory)};await writeFile(path.join(directory,'runtime.json'),JSON.stringify(manifest));assert.equal(await pdfArchivalAvailable({directory}),false);
 await assert.rejects(applyPdfArchival(Buffer.from('%PDF-1.7'),{runtime:{directory}}),{code:'PDF_ARCHIVAL_UNAVAILABLE'});
}));
test('archival capacity and pre-cancellation settle before any runtime process starts',async()=>{
 await assert.rejects(applyPdfArchival(Buffer.alloc(2),{maxBytes:1}),{code:'PDF_CAPACITY'});await assert.rejects(applyPdfArchival('not bytes'),{code:'PDF_ARCHIVAL_FAILED'});
 const controller=new AbortController();controller.abort(new Error('Cancelled before archival'));await assert.rejects(applyPdfArchival(Buffer.from('PDF'),{signal:controller.signal}),/Cancelled before archival/);await assert.rejects(pdfArchivalAvailable({signal:controller.signal}),/Cancelled before archival/);
});
test('packaging checks pinned archives itself and leaves no partial runtime on failure',async()=>temporary(async directory=>{
 const file=path.join(directory,'wrong.zip');await writeFile(file,'wrong archive');await assert.rejects(preparePdfValidationRuntime({out:path.join(directory,'out'),cache:path.join(directory,'cache'),download:async()=>file,run:async()=>assert.fail('must not extract unauthenticated bytes')}),/checksum mismatch/);
 assert.ok(pdfValidationRuntimeFiles('win32').includes('pdf-validation/java/bin/java.exe'));assert.ok(pdfValidationRuntimeFiles('darwin').includes('pdf-validation/java/bin/java'));
}));
