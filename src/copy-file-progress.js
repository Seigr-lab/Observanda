import {createHash} from 'node:crypto';
import {open} from 'node:fs/promises';
import {AppError} from './errors.js';
import {operationStage,operationAdvance,operationWork} from './operation-progress.js';

// Exclusive destination and fixed memory, including multi-gigabyte originals.
// Sync copied bytes before the caller checks the destination hash.
export function copyFileProgress(source,target,{size,name,onBytes,checksum=false}){
 return operationStage('copy-file',{total:size,unit:'bytes',item:name},async()=>{
  const input=await open(source,'r');let output;
  try{
   const before=await input.stat();if(!before.isFile()||before.nlink!==1||before.size!==size)throw new AppError('STORAGE_COPY');
   output=await open(target,'wx',0o600);const buffer=Buffer.allocUnsafe(1024*1024),hash=checksum?createHash('sha256'):null;let bytes=0;
   for(;;){
    const {bytesRead}=await input.read(buffer);if(!bytesRead)break;
    let written=0;while(written<bytesRead){const result=await output.write(buffer,written,bytesRead-written);if(!result.bytesWritten)throw new AppError('IO');written+=result.bytesWritten;}
    hash?.update(buffer.subarray(0,bytesRead));bytes+=bytesRead;onBytes?.(bytesRead);operationAdvance(bytesRead);operationWork({bytes:bytesRead});
   }
   const after=await input.stat();if(bytes!==size||after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs)throw new AppError('STORAGE_COPY');
   await output.sync();return {bytes,...(hash?{sha256:hash.digest('hex')}:{})};
  }finally{await output?.close();await input.close();}
 });
}
