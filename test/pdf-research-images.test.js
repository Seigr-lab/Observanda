import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile);

test('PDF entry points load independently before research or catalogue modules',async()=>{
 for(const [file,name] of [['pdf-document-requests.js','executePdfRequest'],['pdf-document-store.js','PdfDocumentStore'],['pdf-research-images.js','verifyPdfResearchImages']]){
  const url=new URL('../src/'+file,import.meta.url),script='const entry=await import('+JSON.stringify(url.href)+');if(typeof entry['+JSON.stringify(name)+']!=="function")throw Error("Missing PDF entry point");';
  const result=await run(process.execPath,['--input-type=module','-e',script],{windowsHide:true,timeout:30000});assert.equal(result.stdout,'');assert.equal(result.stderr,'');
 }
});
