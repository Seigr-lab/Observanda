import {createHash} from 'node:crypto';
import {AppError} from './errors.js';
import {operationStage,operationAdvance} from './operation-progress.js';
import {validMaterialReference} from './web/material-reference.js';
import {ARTIFACT_DIGESTS,validArtifactDigestCommand,normalizedDigest} from './web/artifact-digest-model.js';

// Compute a checksum of a retained original and, when the author supplies the
// published value, compare them. One authenticated pass also recomputes the
// SHA-256 recorded at intake, so a match is never reported for bytes that
// differ from the retained original. Nothing is written.
export async function artifactDigest(materials,command,{signal}={}){
 if(!validArtifactDigestCommand(command)||!validMaterialReference(command.ref)||command.ref.kind!=='artifact')throw new AppError('MATERIAL_INVALID');
 const {doc,content}=await materials.artifact(command.ref,{signal,verification:'descriptor'});
 const size=doc.content.size,algorithm=ARTIFACT_DIGESTS[command.algorithm];
 const requested=createHash(algorithm.hash),retained=createHash('sha256');let read=0;
 await operationStage('checksum-file',{total:size,unit:'bytes',item:doc.content.name},async()=>{
  try{
   for await(const chunk of content.readChunks(0,size-1,{signal})){
    signal?.throwIfAborted();read+=chunk.length;requested.update(chunk);retained.update(chunk);operationAdvance(chunk.length);
   }
  }catch(error){if(error.code==='MEDIA_INVALID')throw new AppError('MATERIAL_MISSING');throw error;}
 });
 if(read!==size||retained.digest('hex')!==doc.content.sha256)throw new AppError('MATERIAL_MISSING');
 const digest=requested.digest('hex'),expected=command.expected===undefined?null:normalizedDigest(command.expected);
 return {ref:command.ref,name:doc.content.name,size,algorithm:command.algorithm,digest,retainedSha256:doc.content.sha256,expected,matches:expected===null?null:expected===digest};
}
