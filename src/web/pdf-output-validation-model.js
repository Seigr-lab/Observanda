import {validPdfArchivalReceipt,PDF_ARCHIVAL_VALIDATOR_SHA256} from './pdf-archival-model.js';
export const validPdfOutputProfile=value=>['pdfa-2u','pdfua-1'].includes(value);
export function validPdfAccessibilityReceipt(value){
 return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join()==='automatedOnly,passedChecks,passedRules,profile,sha256,validator,validatorSha256,validatorVersion,version'&&value.version===1&&value.profile==='pdfua-1'&&value.automatedOnly===true&&typeof value.sha256==='string'&&/^[a-f0-9]{64}$/.test(value.sha256)&&value.validator==='veraPDF'&&value.validatorVersion==='1.30.3'&&value.validatorSha256===PDF_ARCHIVAL_VALIDATOR_SHA256&&[value.passedRules,value.passedChecks].every(n=>Number.isSafeInteger(n)&&n>0);
}
export const validPdfOutputValidation=value=>validPdfArchivalReceipt(value)||validPdfAccessibilityReceipt(value);
