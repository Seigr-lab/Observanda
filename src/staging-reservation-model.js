import {AppError} from './errors.js';
import {SEGMENTED_HEADER_BYTES,SEGMENTED_BLOCK_BYTES,SEGMENTED_CHUNK_OVERHEAD} from './segmented-file-format.js';

export const STAGING_PROGRESS_BYTES=8*1024*1024;
export const STAGING_FREE_BYTES=256*1024*1024;
export const STAGING_ACTIVE_LIMIT=32;
export const STAGING_PRINCIPAL_LIMIT=8;
const amount=value=>{if(!Number.isSafeInteger(value)||value<0)throw new AppError('INVALID');return value;};

// The signed declaration fixes total clear bytes and entry count before any
// payload. Split-file rounding can add at most one extra chunk per entry.
// This reserves stored ciphertext, not a ceiling on retained project data.
export function declaredStagingBytes(bytes,entries){
 amount(bytes);if(!Number.isSafeInteger(entries)||entries<1)throw new AppError('INVALID');
 const chunks=bytes?Math.ceil(bytes/SEGMENTED_BLOCK_BYTES)+entries-1:0,value=bytes+entries*SEGMENTED_HEADER_BYTES+chunks*SEGMENTED_CHUNK_OVERHEAD;
 if(!Number.isSafeInteger(value))throw new AppError('LIMIT');return value;
}
export function stagingRemaining(claim){
 amount(claim.expectedBytes);amount(claim.writtenBytes);if(claim.writtenBytes>claim.expectedBytes)throw new AppError('COLLABORATION_DAMAGED');return claim.expectedBytes-claim.writtenBytes;
}
export function admitStagingClaim(claims,next,{activeLimit=STAGING_ACTIVE_LIMIT,principalLimit=STAGING_PRINCIPAL_LIMIT}={}){
 if(!Number.isSafeInteger(activeLimit)||activeLimit<1||!Number.isSafeInteger(principalLimit)||principalLimit<1)throw new AppError('INVALID');
 if(claims.length>=activeLimit||claims.filter(claim=>claim.principalId===next.principalId).length>=principalLimit)throw new AppError('WORKLOAD_BUSY');
 if(claims.some(claim=>claim.id===next.id))throw new AppError('CONFLICT');let remaining=stagingRemaining(next);
 for(const claim of claims){remaining+=stagingRemaining(claim);if(!Number.isSafeInteger(remaining))throw new AppError('STORAGE_FULL');}return remaining;
}
