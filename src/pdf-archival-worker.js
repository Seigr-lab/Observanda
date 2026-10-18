import {parentPort,workerData} from 'node:worker_threads';
import {PDFDocument} from '@cantoo/pdf-lib';
try{
 const {bytes,maxBytes}=workerData,document=await PDFDocument.load(bytes,{forIncrementalUpdate:true,updateMetadata:false,throwOnInvalidObject:true});document.convertToPDFA({conformance:'2U'});
 const output=await document.save({useObjectStreams:false,addDefaultPage:false,updateFieldAppearances:false});if(output.length>maxBytes)throw Object.assign(new Error('PDF_CAPACITY'),{code:'PDF_CAPACITY'});
 if(output.length<=bytes.length||!Buffer.from(output.buffer,output.byteOffset,bytes.length).equals(Buffer.from(bytes)))throw new Error('Incremental preservation failed');parentPort.postMessage({bytes:output},[output.buffer]);
}catch(error){parentPort.postMessage({error:error?.code==='PDF_CAPACITY'?'PDF_CAPACITY':'PDF_ARCHIVAL_FAILED'});}
