import {browserHash} from './evidence-fingerprint.js';
import {revisionText} from './revision-model.js';

// Retry the same submitted recipe with its acknowledged command identity.
// When a submitted recipe is edited, preserve an explicit correction target
// and allocate a fresh result identity for an independent new result.
export async function scientificCommandIdentity(identity,input){
 const key=await browserHash(revisionText(input));
 if(!identity.key||identity.key===key)return {...identity,key};
 return {id:identity.expectedRevision===null?crypto.randomUUID():identity.id,expectedRevision:identity.expectedRevision,jobId:crypto.randomUUID(),key};
}
