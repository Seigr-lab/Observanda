const exact=(value,keys)=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join()===keys.split(',').sort().join();
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value),positive=value=>Number.isSafeInteger(value)&&value>0;
export const PDF_ARCHIVAL_VALIDATOR_SHA256='4c8acbaeb16405456c8d6d76deac8cf40d94618cb4e33aedf44e51ee1b68be91';
export function validPdfArchivalReceipt(value){return exact(value,'version,profile,sha256,validator,validatorVersion,validatorSha256,passedRules,passedChecks')&&value.version===1&&value.profile==='pdfa-2u'&&hash(value.sha256)&&value.validator==='veraPDF'&&value.validatorVersion==='1.30.3'&&value.validatorSha256===PDF_ARCHIVAL_VALIDATOR_SHA256&&positive(value.passedRules)&&positive(value.passedChecks);}
