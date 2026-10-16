// Physical owner handoffs must not race source retirement in another registry.
// Ordinary project reads and record/domain writes do not acquire this lease.
import path from 'node:path';
import {privateDirectory,assertRegular} from './storage.js';
import {withWriterLease} from './writer-lease.js';
import {researchId} from './web/research-reference.js';
import {AppError} from './errors.js';
export async function withProjectRetentionLease(storage,operation){
 if(!researchId(storage?.projectId)||typeof operation!=='function')throw new AppError('INVALID');
 await assertRegular(storage.root,{directory:true});const directory=await privateDirectory(storage.root,'.observanda');
 return withWriterLease(path.join(directory,'project-retention.lock'),operation);
}
