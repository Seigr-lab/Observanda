import {validPdfArchivalReceipt,PDF_ARCHIVAL_VALIDATOR_SHA256} from './web/pdf-archival-model.js';
const fail=()=>Object.assign(new Error('PDF_ARCHIVAL_FAILED'),{code:'PDF_ARCHIVAL_FAILED'});
export function pdfArchivalReceipt(text,{sha256,bytes}){
 try{
  if(typeof text!=='string'||Buffer.byteLength(text)>2*1024*1024)throw fail();const report=JSON.parse(text).report,batch=report.batchSummary,jobs=report.jobs,summary=batch.validationSummary;
  if(!Array.isArray(jobs)||jobs.length!==1||batch.multiJob!==false||batch.totalJobs!==1||['outOfMemory','veraExceptions','failedParsingJobs','failedEncryptedJobs'].some(key=>batch[key]!==0)||summary.totalJobCount!==1||summary.failedJobCount!==0||summary.nonCompliantPdfaCount!==0||summary.successfulJobCount!==1||summary.compliantPdfaCount!==1)throw fail();
  if(!Array.isArray(report.buildInformation.releaseDetails)||report.buildInformation.releaseDetails.length!==3)throw fail();
  for(const id of ['core','validation-model','apps'])if(report.buildInformation.releaseDetails.filter(row=>row.id===id&&row.version==='1.30.3').length!==1)throw fail();
  const job=jobs[0];if(job.itemDetails.size!==bytes||!Array.isArray(job.validationResult)||job.validationResult.length!==1)throw fail();const result=job.validationResult[0],details=result.details;
  if(result.jobEndStatus!=='normal'||result.profileName!=='PDF/A-2u validation profile'||result.compliant!==true||details.failedRules!==0||details.failedChecks!==0||!Array.isArray(details.ruleSummaries)||details.ruleSummaries.length)throw fail();
  const receipt={version:1,profile:'pdfa-2u',sha256,validator:'veraPDF',validatorVersion:'1.30.3',validatorSha256:PDF_ARCHIVAL_VALIDATOR_SHA256,passedRules:details.passedRules,passedChecks:details.passedChecks};if(!validPdfArchivalReceipt(receipt))throw fail();return receipt;
 }catch{throw fail();}
}
