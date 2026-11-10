import {EVIDENCE_CHUNK} from '../../src/research-materials.js';

export async function retainDatasetOriginal(materials,recordId,name,size,chunks){
 const upload=await materials.startImport({recordId,name,size});
 let buffer=Buffer.allocUnsafe(EVIDENCE_CHUNK),used=0,part=0;
 for await(const chunk of chunks){
  for(let start=0;start<chunk.length;){
   const take=Math.min(EVIDENCE_CHUNK-used,chunk.length-start);
   chunk.copy(buffer,used,start,start+take);used+=take;start+=take;
   if(used===EVIDENCE_CHUNK){
    await materials.appendImport(upload.id,part++,[buffer]);
    buffer=Buffer.allocUnsafe(EVIDENCE_CHUNK);used=0;
   }
  }
 }
 if(used)await materials.appendImport(upload.id,part,[buffer.subarray(0,used)]);
 return materials.finishImport(upload.id);
}
